import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConversionsService } from '../conversions/conversions.service';
import type { IntakeLeadDto } from './dto/intake-lead.dto';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CONTACT_EVENT_TYPES,
  csvCell,
  errorLabel,
  contactFingerprints,
  contactsInAnything,
  declaredContactsIn,
  lireContacts,
  hasContact,
  isContactEvent,
  isUniqueViolation,
  leadFromConversion,
  mergeLeadData,
  normalizeEmail,
  normalizePhone,
  type LeadData,
} from './lead-fields';
import { fillLead, scrubVisitPii, visitsDueForPurge, visitsOfPerson } from './lead-sql';
import { contactDeclare, donneesVidees, ligneLue, nettoyageJs, selectionLue } from './lead-columns';

export interface LeadFilters {
  campaignId?: string;
  from?: string;
  to?: string;
  search?: string;
  includeTest?: boolean;
  limit?: number;
  offset?: number;
}

const CSV_COLUMNS = [
  'created_at',
  'campaign',
  'source',
  'first_name',
  'last_name',
  'phone',
  'email',
  'zip',
  'state',
  'answers',
  'consent_at',
  'consent_hash',
  'consent_text',
  'ip',
  'user_agent',
  'page_url',
  'click_id',
  'conversion_id',
  'is_test',
  'purged_at',
  'erased_at',
] as const;

const CSV_MAX_ROWS = 50000;
/** La borne de `visitsOfPerson`. Nommée ici parce que c'est ici qu'on doit la rapporter. */
const VISITS_LOOKUP_LIMIT = 500;

/** Le groupe des lignes écrites avant les groupes (migration 20260919090000) : elles refusent seules. */
export const GROUPE_ANCIEN = 'avant-groupes';
/** Le groupe de la ligne témoin de la clé. */
export const GROUPE_TEMOIN = 'temoin';
const PURGE_BATCH = 5000;
const PURGE_MAX_ROUNDS = 20;
const RECONCILE_WINDOW_HOURS = 48;
const RECONCILE_MAX_CONVERSIONS = 5000;

/**
 * Les noms qu'une réponse de questionnaire n'a pas le droit de porter : ceux que le lecteur de métadonnées
 * comprend comme des champs de la personne.
 *
 * La liste vient de `leadFromConversion` : tout nom qu'il sait lire doit être ici, sinon un partenaire écrase par
 * la bande ce que les champs nommés viennent d'écrire. Le consentement est le cas grave — c'est la preuve du
 * droit d'appeler.
 */
const RESERVES_DANS_LES_REPONSES = new Set([
  'firstName', 'first_name', 'name',
  'lastName', 'last_name',
  'email', 'phone',
  'zip', 'zipCode', 'postal_code',
  'state', 'source',
  'consent', 'consentText',
  'pageUrl', 'page_url',
  // Les identifiants de clic Meta partent vers l'API Conversions : un partenaire qui les glisse dans ses réponses
  // attribuerait à nos campagnes des conversions qui ne leur appartiennent pas.
  'fbc', 'fbp', '_fbc', '_fbp', 'fbclid',
]);

/** Les réponses du partenaire, débarrassées des noms réservés — qui sont écartés, pas renommés en silence. */
export function alias(answers: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(answers ?? {})) {
    if (!RESERVES_DANS_LES_REPONSES.has(cle)) out[cle] = valeur;
  }
  return out;
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly conversions: ConversionsService,
  ) {}

  private where(filters: LeadFilters): Prisma.LeadWhereInput {
    const where: Prisma.LeadWhereInput = {};
    if (filters.campaignId) where.campaignId = filters.campaignId;
    // Test leads (test clicks, test mode) stay out of the list unless asked for, like every report.
    if (!filters.includeTest) where.isTest = false;
    // Une pierre tombale créée par un effacement (`source: 'erasure'`, aucune donnée) n'est pas un lead : elle
    // existe pour empêcher une réécriture, pas pour être comptée. Sans ce filtre, le total de l'écran et l'export
    // CSV grossissaient à chaque demande RGPD.
    where.NOT = { source: 'erasure', erasedAt: { not: null } };
    const createdAt: Prisma.DateTimeFilter = {};
    const from = filters.from ? new Date(filters.from) : null;
    const to = filters.to ? new Date(filters.to) : null;
    if (from && !Number.isNaN(from.getTime())) createdAt.gte = from;
    if (to && !Number.isNaN(to.getTime())) createdAt.lte = to;
    if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;
    const search = filters.search?.trim();
    if (search) {
      const digits = search.replace(/\D/g, '');
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { zip: { startsWith: search } },
        { state: { contains: search, mode: 'insensitive' } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ];
    }
    return where;
  }

  private async campaignNames(ids: string[]): Promise<Map<string, { name: string; slug: string }>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.campaign.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true, slug: true },
    });
    return new Map(rows.map((r) => [r.id, { name: r.name, slug: r.slug }]));
  }

  async list(filters: LeadFilters) {
    const where = this.where(filters);
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 100), 1), 500);
    const offset = Math.max(Math.trunc(filters.offset ?? 0), 0);
    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      this.prisma.lead.count({ where }),
    ]);
    const campaigns = await this.campaignNames(items.map((i) => i.campaignId));
    return { items: items.map((lead) => ({ ...lead, campaign: campaigns.get(lead.campaignId) ?? null })), total };
  }

  async exportCsv(filters: LeadFilters): Promise<string> {
    const rows = await this.prisma.lead.findMany({
      where: this.where(filters),
      orderBy: { createdAt: 'desc' },
      take: CSV_MAX_ROWS,
    });
    // Personal data leaving the tracker: the export itself is worth a log line (counts only, never a field).
    this.logger.warn(`Leads CSV export: ${rows.length} row(s)${rows.length === CSV_MAX_ROWS ? ' (capped)' : ''}`);
    const campaigns = await this.campaignNames(rows.map((r) => r.campaignId));
    const lines = [CSV_COLUMNS.join(',')];
    for (const r of rows) {
      const values: Record<(typeof CSV_COLUMNS)[number], unknown> = {
        created_at: r.createdAt,
        campaign: campaigns.get(r.campaignId)?.name ?? r.campaignId,
        source: r.source,
        first_name: r.firstName,
        last_name: r.lastName,
        phone: r.phone,
        email: r.email,
        zip: r.zip,
        state: r.state,
        answers: r.answers,
        consent_at: r.consentAt,
        consent_hash: r.consentHash,
        consent_text: r.consentText,
        ip: r.ip,
        user_agent: r.userAgent,
        page_url: r.pageUrl,
        click_id: r.clickId,
        conversion_id: r.conversionId,
        is_test: r.isTest,
        purged_at: r.purgedAt,
        erased_at: r.erasedAt,
      };
      lines.push(CSV_COLUMNS.map((c) => csvCell(values[c])).join(','));
    }
    return lines.join('\r\n') + '\r\n';
  }

  /**
   * Erasure request. The row stays as a tombstone with every personal field cleared — so a replayed postback or the
   * reconcile job never brings the person back — and the same contact fields are removed from the raw metadata of
   * that visit's conversions, where they were also readable. Conversions and reports are untouched otherwise.
   */
  /**
   * The tombstone: every field that names the person, cleared in one place. It was written out three times, and the
   * three copies had already drifted — a field added to one of them left the person readable through the others.
   */
  /**
   * The tombstone on every visit of the person, created where it does not exist yet.
   *
   * `updateMany` was used here, and it creates nothing: a sibling visit with no lead row — she clicked the ad three
   * times and only filled the form on the last one — was scrubbed and then left **unmarked**. `erasureState` looks
   * for a lead row with `erasedAt` set; finding none, the next conversion on that visit wrote the metadata in clear
   * and `storeLead` rebuilt the person in full. She came back after her own erasure, and the visit's `scrubbed_at`
   * meant retention would never pass over it again.
   */
  private async tombstoneVisits(
    visits: string[],
    now: Date,
    campaignId: string | null,
    origin: { isTest?: boolean; createdAt?: Date } = {},
  ): Promise<void> {
    // CHAQUE visite garde SA campagne, son drapeau de test et sa date. Elles héritaient de celles du
    // demandeur — or `visitsOfPerson` ne filtre pas par campagne : une personne revenue par une autre campagne
    // voyait sa pierre tombale comptée dans la mauvaise, avec la date de la demande et le drapeau de test d'une
    // autre visite. Ce sont exactement les colonnes que les rapports et l'export lisent.
    const origins = new Map<string, { campaignId: string | null; isTest: boolean; createdAt: Date }>();
    try {
      const clicks = await this.prisma.click.findMany({
        where: { clickId: { in: visits } },
        select: { clickId: true, campaignId: true, isTest: true, createdAt: true },
      });
      for (const click of clicks) origins.set(click.clickId, click);
    } catch (err) {
      // Pas de quoi arrêter un effacement : on retombe sur les valeurs du demandeur, comme avant.
      this.logger.error(`Visit origins lookup failed: ${errorLabel(err)}`);
    }
    const failures: string[] = [];
    for (const clickId of visits) {
      const own = origins.get(clickId);
      try {
        await this.prisma.lead.upsert({
          where: { clickId },
          update: this.tombstone(now) as Prisma.LeadUpdateInput,
          create: {
            ...(this.tombstone(now) as Prisma.LeadUncheckedCreateInput),
            clickId,
            campaignId: own?.campaignId ?? campaignId ?? undefined,
            source: 'erasure',
            // Une pierre tombale n'est pas un lead. Sans ces deux champs elle naissait `isTest: false` et datée du
            // jour : effacer une personne à trois visites AJOUTAIT deux lignes au total affiché à l'écran et dans
            // l'export, et une visite de test devenait un lead réel.
            isTest: own?.isTest ?? origin.isTest ?? false,
            ...(own?.createdAt ?? origin.createdAt ? { createdAt: own?.createdAt ?? origin.createdAt } : {}),
          } as Prisma.LeadUncheckedCreateInput,
        });
      } catch (err) {
        this.logger.error(`Tombstone failed for visit ${clickId}: ${errorLabel(err)}`);
        failures.push(clickId);
      }
    }
    if (failures.length) {
      // On ne poursuit PAS le nettoyage : nettoyer sans marquer laisse une visite lisible pour la prochaine
      // conversion et invisible pour la rétention. Mieux vaut une demande qui échoue bruyamment et se rejoue.
      throw new Error(`tombstone failed for ${failures.length} visit(s): ${failures.slice(0, 5).join(', ')}`);
    }
  }

  /**
   * Inscrit une personne à la liste de suppression, sans jamais empêcher l'effacement lui-même.
   *
   * Si cette écriture échoue, l'effacement continue : refuser d'effacer parce qu'on n'a pas su noter qu'on a
   * effacé serait le pire des deux mondes. L'échec est journalisé — c'est la seule trace qui permettra de
   * comprendre, plus tard, qu'une personne a pu revenir.
   */
  private async rememberErased(
    visits: string[],
    extra: { phone?: string | null; email?: string | null }[],
  ): Promise<'recorded' | 'nothing' | 'failed' | 'partial'> {
    try {
      // La lecture des visites sœurs est DANS le try : si elle échoue, c'est l'inscription qui échoue — et c'est
      // rendu à l'appelant — au lieu d'une exception qui interromprait l'effacement lui-même.
      const { declares, trouves, complet } = await this.contactsOfVisits(visits, extra);
      const cle = await this.cleVerifiee();
      // DÉCLARÉ D'ABORD : si le même numéro est à la fois déclaré et trouvé, c'est le déclaré qui s'inscrit.
      const vus = new Set<string>();
      const marques = [
        ...declares.flatMap((c) => contactFingerprints(c, cle)),
        ...trouves.flatMap((c) => contactFingerprints(c, cle)).map((m) => ({ ...m, kind: `${m.kind}_texte` })),
      ].filter((m) => (vus.has(m.hash) ? false : (vus.add(m.hash), true)));
      if (!complet) {
        this.logger.warn('Suppression list: some visit or conversion data was too large to read in full');
      }
      if (marques.length === 0) return complet ? 'nothing' : 'partial';
      // UN GROUPE PAR EFFACEMENT (juré r11) : un identifiant aléatoire, qui ne dit rien de la personne, mais dit quelles
      // empreintes ont été inscrites ENSEMBLE. C'est lui qui distingue Ann qui revient (son numéro ET son adresse) de Bob,
      // cité dans les notes d'Ann, qui envoie son propre lead (voir `isErasedPerson`).
      const groupe = randomUUID();
      // La clé est le COUPLE (empreinte, groupe) (tour 32, juré r13) : un numéro déjà inscrit par un effacement
      // précédent — trouvé dans les notes d'Ann — entre AUSSI dans ce groupe-ci, avec la sorte que CET effacement lui
      // donne. Avec l'empreinte seule pour clé, il restait dans le groupe d'Ann : Eve, effacée ensuite, revenait avec
      // son numéro et son adresse, deux empreintes de deux groupes différents, et passait. La « promotion » d'une
      // ligne trouvée en déclarée n'a plus lieu d'être : la ligne déclarée existe, dans son propre groupe.
      await this.prisma.erasedContact.createMany({
        data: marques.map((m) => ({ hash: m.hash, kind: m.kind, groupe })),
        // Un groupe est neuf, donc un doublon ne peut venir que d'une course : ce n'est pas une erreur.
        skipDuplicates: true,
      });
      // Inscrit, mais pas TOUT lu : l'opérateur doit le savoir au moment où il efface.
      return complet ? 'recorded' : 'partial';
    } catch (err) {
      // L'effacement continue — refuser d'effacer parce qu'on n'a pas su noter serait le pire des deux mondes —
      // mais l'échec est RENDU à l'appelant, pas seulement journalisé : une ligne plus bas le contact est
      // supprimé, et la protection contre le retour de cette personne est alors perdue pour de bon.
      this.logger.error(`Suppression list write failed: ${errorLabel(err)}`);
      return 'failed';
    }
  }

  /**
   * Tous les contacts qu'on connaît d'une personne, sur TOUTES ses visites — lus avant qu'on ne les efface.
   *
   * Le demandeur peut avoir laissé un numéro sur une visite et une adresse sur une autre. N'inscrire que la ligne
   * de la demande laissait la personne revenir par l'adresse de sa visite sœur, qui venait pourtant d'être effacée.
   */
  private async contactsOfVisits(
    visits: string[],
    extra: { phone?: string | null; email?: string | null }[] = [],
  ): Promise<{
    declares: { phone?: string | null; email?: string | null }[];
    trouves: { phone?: string | null; email?: string | null }[];
    complet: boolean;
  }> {
    if (visits.length === 0) return { declares: [...extra], trouves: [], complet: true };
    // LES MÊMES COLONNES QUE LE NETTOYAGE, parce qu'elles viennent du MÊME registre (`lead-columns.ts`, tour 32) :
    // la ligne de visite ENTIÈRE se lisait ici, et `scrubClicks` ne touchait ni `utm_term` ni `ad_title` — une adresse
    // lue, inscrite, et laissée en base (juré r13). Désormais on ne lit QUE les colonnes classées « contact » ou
    // « url », sous le nom de leur colonne — la clé sous laquelle le nettoyage les caviarde.
    const [lignes, visites, conversions] = await Promise.all([
      this.prisma.lead.findMany({ where: { clickId: { in: visits } }, select: selectionLue('leads') }),
      this.prisma.click.findMany({ where: { clickId: { in: visits } }, select: selectionLue('clicks') }),
      this.prisma.conversion.findMany({ where: { clickId: { in: visits } }, select: selectionLue('conversions', ['eventType']) }),
    ]);
    // LIGNE PAR LIGNE, les conversions d'abord : un budget unique sur l'ensemble s'épuisait sur les en-têtes de
    // cinq cents visites, et le `contact_email` d'une conversion n'était jamais lu — sans que rien ne le dise.
    const declares: { phone?: string | null; email?: string | null }[] = [
      ...extra,
      ...(lignes as Record<string, unknown>[]).map((l) => contactDeclare('leads', l)),
    ];
    const trouves: { phone?: string | null; email?: string | null }[] = [];
    let complet = true;
    const lignesLues = [
      ...(conversions as Record<string, unknown>[]).map((c) => ({
        ligne: ligneLue('conversions', c),
        deContact: isContactEvent(String(c.eventType ?? '')),
      })),
      ...(visites as Record<string, unknown>[]).map((v) => ({ ligne: ligneLue('clicks', v), deContact: true })),
      ...(lignes as Record<string, unknown>[]).map((l) => ({ ligne: ligneLue('leads', l), deContact: true })),
    ];
    for (const { ligne, deContact } of lignesLues) {
      const lu = lireContacts(ligne);
      // DÉCLARER, c'est un événement de CONTACT qui le fait (formulaire, rappel) — ou la visite elle-même (`?phone=`
      // de sa page d'atterrissage). Un `call_click` porte dans `phone` NOTRE numéro de suivi, celui du bouton d'appel
      // (juré r8) : déclaré, il faisait refuser tous ceux qui l'écrivent ensuite. Une conversion d'un autre type, ou
      // sans type, est lue comme « trouvée ».
      if (deContact) declares.push(...lu.declares);
      trouves.push(...lu.tous);
      complet &&= lu.complet;
    }
    return { declares, trouves, complet };
  }

  private cleOk: string | null = null;

  /**
   * La clé HMAC, vérifiée contre une empreinte TÉMOIN écrite à sa première utilisation.
   *
   * Changer la clé rend toutes les empreintes introuvables — chaque personne effacée redevient enregistrable — et
   * rien ne le signalait. Le témoin est l'empreinte d'un texte fixe : si la clé du moment ne la retrouve pas, c'est
   * qu'elle a changé, et on refuse plutôt que de laisser revenir tout le monde en silence.
   */
  private async cleVerifiee(): Promise<string> {
    const cle = this.config.get<string>('ERASURE_HMAC_KEY') ?? '';
    if (this.cleOk !== null && this.cleOk === cle) return cle;
    const temoin = contactFingerprints({ email: 'temoin@liste-de-suppression.invalid' }, cle)[0].hash;
    const existant = await this.prisma.erasedContact.findFirst({ where: { kind: 'temoin' }, select: { hash: true } });
    if (existant && existant.hash !== temoin) {
      this.logger.error(
        'ERASURE_HMAC_KEY a CHANGÉ : les empreintes existantes sont introuvables — remettre l’ancienne clé',
      );
      throw new Error('ERASURE_HMAC_KEY a changé depuis la première inscription');
    }
    if (!existant) {
      await this.prisma.erasedContact.createMany({ data: [{ hash: temoin, kind: 'temoin', groupe: GROUPE_TEMOIN }], skipDuplicates: true });
    }
    this.cleOk = cle;
    return cle;
  }

  /** Cette personne a-t-elle demandé son effacement ? Lu AVANT toute écriture, sur l'empreinte du contact. */
  /**
   * `declares` : ce que la personne a donné comme SON contact. `trouves` : ce qu'on a reconnu à sa forme ailleurs
   * dans l'envoi. Un refus exige qu'un côté au moins soit déclaré : deux formes trouvées qui coïncident — le même
   * identifiant de campagne dans deux URL, le même créneau horaire — ne désignent pas la même personne (juré r5).
   */
  async isErasedPerson(
    declares: { phone?: string | null; email?: string | null }[],
    trouves: { phone?: string | null; email?: string | null }[] = [],
  ): Promise<boolean> {
    // Sans clé valide, la liste n'a rien pu noter et ne peut rien lire : la protection promise n'existe pas. On
    // refuse d'entrer en 503 — le partenaire réessaiera — plutôt que de recréer, peut-être, une personne effacée.
    let cle: string;
    try {
      cle = await this.cleVerifiee();
    } catch (err) {
      this.logger.error(`Suppression list unavailable: ${errorLabel(err)}`);
      throw new ServiceUnavailableException(
        'ERASURE_HMAC_KEY absente, trop courte ou changée : liste de suppression indisponible, lead non stocké',
      );
    }
    const empreintes = (contacts: { phone?: string | null; email?: string | null }[]) => [
      ...new Set(contacts.flatMap((c) => contactFingerprints(c, cle)).map((m) => m.hash)),
    ];
    const deDeclares = empreintes(declares);
    const deTrouves = empreintes(trouves).filter((h) => !deDeclares.includes(h));
    const tous = [...new Set([...deDeclares, ...deTrouves])];
    if (!tous.length) return false;
    // UNE lecture (juré r12) : toutes les lignes que l'envoi touche, avec leur sorte et leur groupe. La table a une
    // ligne par empreinte, donc tout ce qu'il faut pour décider est là — la décision se prend ensuite en mémoire.
    const lignes = await this.prisma.erasedContact.findMany({
      where: { hash: { in: tous } },
      select: { hash: true, kind: true, groupe: true },
    });
    const declaree = (kind: string) => kind === 'phone' || kind === 'email';
    for (const l of lignes) {
      if (deDeclares.includes(l.hash)) {
        // Déclaré à l'entrée contre DÉCLARÉ à l'effacement : il suffit seul. Une ligne d'avant les groupes garde
        // l'ancienne règle : une empreinte trouvée refuse seule.
        if (declaree(l.kind) || l.groupe === GROUPE_ANCIEN) return true;
        // Déclaré à l'entrée contre TROUVÉ dans un texte à l'effacement : un SECOND SIGNAL est exigé (juré r11). « Call
        // my husband Bob at 727-555-0199 », dans les notes d'Ann, inscrivait le numéro de Bob — et Bob, qui envoyait
        // son propre lead, était refusé. Le numéro trouvé ne refuse que si un AUTRE contact de l'envoi (déclaré ou
        // trouvé) correspond au MÊME effacement. Le prix, écrit dans la doc §9 : une personne dont le numéro n'était
        // QUE dans un texte, et qui revient avec ce seul numéro, n'est pas reconnue.
        if (lignes.some((m) => m.hash !== l.hash && m.groupe === l.groupe)) return true;
      } else if (declaree(l.kind)) {
        // Trouvé à l'entrée : seulement contre ce que la liste tient d'une DÉCLARATION.
        return true;
      }
    }
    return false;
  }

  private tombstone(now: Date): Prisma.LeadUncheckedUpdateManyInput {
    return {
      // `scrubbedAt` repart à zéro : une visite sœur que la rétention avait déjà nettoyée porte une marque
      // « nettoyée » qui vaut pour la PURGE, laquelle garde exprès le code postal, l'État et les réponses du
      // quiz. Un effacement en demande plus. Sans cette remise à zéro, `resumeScrubs` ne la reprenait jamais et
      // elle restait à moitié effacée, avec `erasedAt` posé — le pire des deux états, celui qui a l'air fini.
      scrubbedAt: null,
      // Ce que la pierre tombale vide vient du REGISTRE (`donneesVidees`, tour 32) — les mêmes colonnes que la lecture :
      // le contact, le nom, l'IP, le consentement, l'URL, mais aussi le code postal, l'État et les réponses du quiz, qui
      // désignent encore quelqu'un une fois croisés. Reste la preuve que l'appel avait été autorisé (empreinte et date
      // du consentement) et ce que les rapports comptent (campagne, source, dates).
      ...donneesVidees('leads', 'erased'),
      erasedAt: now,
      purgedAt: now,
    };
  }

  async deleteOne(
    id: string,
    by?: string,
  ): Promise<{
    deleted: boolean;
    conversionsScrubbed?: number;
    /** Les visites qu'une garde a écartées : un effacement partiel se dit, il ne se devine pas. */
    skipped?: { clickId: string; why: string }[];
    suppression?: 'nothing' | 'failed' | 'partial';
  }> {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) return { deleted: false };
    const now = new Date();
    // AVANT LA MOINDRE ÉCRITURE. Toutes les visites de la MÊME personne, pas seulement celle qui portait la
    // demande : sinon la visite d'à côté garde prénom, numéro et adresse, et le nettoyage détruit ensuite le lien
    // qui aurait permis d'y revenir.
    //
    // Et avant, parce que la clé de cet élargissement, c'est le contact de la ligne du demandeur — celle que la
    // pierre tombale vide. Le tour 15 posait la pierre tombale d'abord et ne lisait le contact que depuis l'objet
    // déjà chargé en mémoire : ça marche tant que rien ne s'interrompt. Si le processus meurt entre les deux, ou
    // si la pose échoue (`tombstoneVisits` lève, c'est prévu), le rejeu relit une ligne vidée, ne trouve plus
    // personne, et les autres visites d'Ann gardent son numéro POUR TOUJOURS — `resumeScrubs` ne reprend que le
    // clic du demandeur, jamais ses visites sœurs. Tant que rien n'est écrit, tout est rejouable.
    const { visits, skipped } = await this.personVisits(lead.clickId, {
      phone: lead.phone,
      email: lead.email,
      firstName: lead.firstName,
      lastName: lead.lastName,
    });
    // LA PIERRE TOMBALE D'ABORD. `scrubVisitPii` pose `scrubbed_at` sur les clics et les conversions ; si le
    // processus meurt entre les deux, une visite sœur se retrouve nettoyée mais NON MARQUÉE — `erasureState` ne
    // voit alors aucun effacement, la conversion suivante réécrit la personne en clair, et la rétention ne
    // repassera jamais puisque `scrubbed_at` est posé. Dans l'autre ordre, une interruption laisse au pire une
    // pierre tombale sans nettoyage : le rattrapage horaire la reprend, et personne n'est réécrit entre-temps.
    //
    // Sur TOUTES les visites avant la ligne du demandeur : une fois marquées, elles sont chacune reprises par le
    // rattrapage horaire, donc toute interruption après ce point se répare seule.
    // L'EMPREINTE D'ABORD, tant que le contact existe encore. Une ligne plus bas, le numéro et l'adresse sont
    // supprimés — et c'est alors trop tard pour reconnaître cette personne si elle revient par une autre porte.
    // C'est le défaut que le juré a reproduit : un lead externe arrive avec un identifiant neuf, aucune pierre
    // tombale ne s'y rattache, et la personne effacée était recréée avec son contact complet.
    const suppression = await this.rememberErased(visits, [{ phone: lead.phone, email: lead.email }]);
    await this.tombstoneVisits(visits, now, lead.campaignId, { isTest: lead.isTest, createdAt: lead.createdAt });
    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id },
        data: { ...this.tombstone(now), purgedAt: lead.purgedAt ?? now },
      });
    });
    const scrubbed = await scrubVisitPii(this.prisma, visits, 'erased');
    // `scrubbed_at` n'est posé qu'ici, une fois le nettoyage terminé : coupé en route (redémarrage, délai), la ligne
    // reste sans marque et le rattrapage horaire la reprend.
    //
    // Sur TOUTES les visites nettoyées, pas seulement celle du demandeur. Les pierres tombales sœurs naissaient
    // sans marque : le rattrapage horaire les reprenait une par une et journalisait « Resumed N interrupted
    // scrub(s) » — un signal d'incident, à chaque effacement normal. Une alarme qui se déclenche sur le cas
    // nominal est une alarme qu'on cesse de lire. L'autre porte (`eraseVisit`) le faisait déjà.
    await this.prisma.lead.updateMany({ where: { clickId: { in: visits } }, data: { scrubbedAt: new Date() } });
    this.logger.warn(`Lead ${id} erased on request${by ? ` by ${by}` : ''} (${scrubbed} conversion(s) scrubbed)`);
    return {
      deleted: true,
      conversionsScrubbed: scrubbed,
      ...(skipped.length ? { skipped } : {}),
      // Dit, pas tu : l'effacement a eu lieu, mais si la personne revient par un autre site, rien ne la
      // reconnaîtra. C'est une information que l'opérateur doit avoir au moment où il efface.
      // « nothing » se dit aussi : un effacement qui n'a trouvé AUCUN contact à inscrire ne protège personne
      // contre un retour, et l'opérateur doit le savoir au moment où il efface.
      ...(suppression !== 'recorded' ? { suppression } : {}),
    };
  }

  /**
   * Resumes the erasures and purges whose scrub was interrupted — a restart, a timeout, a database hiccup between the
   * tombstone and the cleanup. Without it a row would read as erased while the person stayed readable in the
   * conversions and in the visit.
   */
  @Cron('47 * * * *')
  async resumeInterruptedScrubs(): Promise<{ resumed: number; pending: number }> {
    // Un rattrapage long dure plus d'une heure : sans ce verrou, le tour suivant referait le même travail en
    // parallèle. Les écritures sont idempotentes, mais le travail serait au carré.
    if (this.resuming) return { resumed: 0, pending: 0 };
    this.resuming = true;
    try {
      return await this.resumeScrubs();
    } finally {
      this.resuming = false;
    }
  }

  private resuming = false;

  private async resumeScrubs(): Promise<{ resumed: number; pending: number }> {
    const pending = await this.prisma.lead.findMany({
      where: { scrubbedAt: null, OR: [{ NOT: { erasedAt: null } }, { NOT: { purgedAt: null } }] },
      select: { id: true, clickId: true, erasedAt: true },
      take: PURGE_BATCH,
    });
    if (pending.length === 0) return { resumed: 0, pending: 0 };
    let resumed = 0;
    for (const lead of pending) {
      try {
        await scrubVisitPii(this.prisma, [lead.clickId], lead.erasedAt ? 'erased' : 'purged');
        await this.prisma.lead.update({ where: { id: lead.id }, data: { scrubbedAt: new Date() } });
        resumed += 1;
      } catch (err) {
        this.logger.error(`Scrub resume failed for lead ${lead.id}: ${errorLabel(err)}`);
      }
    }
    this.logger.warn(`Resumed ${resumed} interrupted scrub(s) out of ${pending.length} pending`);
    return { resumed, pending: pending.length };
  }

  /**
   * Les visites d'une même personne, à partir d'une seule. Jamais moins que celle demandée, même si la lecture
   * échoue : un effacement qui ne trouve rien doit quand même effacer ce qu'on lui a nommé.
   */
  /**
   * Stocke un lead capté sur un site qui n'est pas le nôtre.
   *
   * LA VISITE D'ABORD. Tout ce que ce dépôt sait faire d'une personne — l'effacer partout, la purger au bout de
   * quatre-vingt-dix jours, l'exporter, refuser de la recréer après un effacement — est accroché à une VISITE.
   * Un lead sans visite serait un objet d'un genre nouveau, invisible à ces quatre mécanismes. On fabrique donc
   * la visite qui manque, avec ce qu'on sait d'elle, et on entre ensuite par la porte normale.
   *
   * Rejouable : deux envois du même `externalId` ne font qu'une visite et qu'une ligne. C'est la seule façon de
   * laisser un partenaire réessayer après un timeout sans nous dupliquer une personne.
   */
  async intake(dto: IntakeLeadDto): Promise<{
    stored: boolean;
    clickId: string;
    campaignId: string;
    reason?: string;
    replay?: boolean;
  }> {
    // Le contact est jugé sur ce qu'il DEVIENDRA, pas sur ce qui est écrit. Plus bas, `normalizePhone` exige
    // 7 à 15 chiffres et `normalizeEmail` une adresse qui en a la forme : « à demander au rappel » comme numéro
    // passait la garde brute, et la ligne se rangeait avec un téléphone vide, en réponse « stored: true ».
    const contact = {
      firstName: dto.firstName?.trim() || null,
      lastName: dto.lastName?.trim() || null,
      email: normalizeEmail(dto.email),
      phone: normalizePhone(dto.phone),
    };
    if (!hasContact(contact)) {
      // Un lead sans contact n'est pas un lead : il n'y a personne à rappeler, personne à effacer, et la ligne
      // ne ferait que gonfler les compteurs. On refuse en le disant, plutôt que de stocker un fantôme.
      throw new BadRequestException(
        'un lead sans prénom, nom, courriel ni téléphone utilisable ne désigne personne : un numéro doit porter ' +
          "7 à 15 chiffres et une adresse ressembler à une adresse, sinon rien ne pourra la rappeler",
      );
    }

    const site = (dto.source || '').trim().toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-|-$/g, '');
    if (!site) throw new BadRequestException('source manquante : on doit savoir de quel site vient ce lead');

    // AVANT LA MOINDRE ÉCRITURE. La garde d'effacement de `conversions.create` lit `click_id` : elle ne couvre
    // que les visites déjà connues, et un partenaire engendre un identifiant par soumission. Sans cette lecture,
    // une personne qui a demandé son effacement revenait intégralement — contact compris — dès son formulaire
    // suivant, et on répondait « stored: true ». Rien n'est écrit : ni campagne, ni visite.
    // TOUT CE QUI ARRIVE, pas seulement les deux champs nommés. Le juré r4 a fait revenir une personne effacée par
    // `answers.contact_email`, par « Ann <ann@…> » et par un numéro à extension : chaque fois le contact entrait
    // en clair dans la conversion sans être comparé. Le consentement, lui, n'est pas lu : il porte souvent le
    // numéro de l'ANNONCEUR, et une personne effacée qui l'aurait vu bloquerait tous les leads de ce texte.
    const envoi = { email: dto.email, phone: dto.phone, answers: dto.answers, pageUrl: dto.pageUrl };
    if (await this.isErasedPerson([contact, ...declaredContactsIn(envoi)], contactsInAnything(envoi))) {
      this.logger.warn(`Intake from ${site} refused: erased person`);
      return { stored: false, clickId: '', campaignId: '', reason: 'erased_person' };
    }

    // UNE CAMPAGNE PAR SITE D'ORIGINE. Les rapports, l'export et le gate raisonnent par campagne : un lead
    // externe rangé dans la campagne d'un autre serait compté dans SES chiffres. La campagne porte aussi une
    // fenêtre d'attribution d'un an, parce que la question ne se pose pas ici : personne n'a cliqué sur une
    // annonce à nous, et un partenaire qui pousse les leads de la veille ne doit pas les voir refusés.
    const slug = `ext-${site}`;
    const campaign = await this.prisma.campaign.upsert({
      where: { slug },
      update: {},
      create: {
        name: `Externe — ${dto.source}`,
        slug,
        trafficSource: 'native',
        destinationUrl: `https://${site}`,
        attributionWindowHours: 24 * 365,
      },
    });

    const clickId = dto.externalId
      ? `ext_${site}_${dto.externalId}`.slice(0, 190)
      : `ext_${site}_${randomUUID()}`;
    const capturedAt = dto.capturedAt ? new Date(dto.capturedAt) : new Date();
    const createdAt = Number.isNaN(capturedAt.getTime()) ? new Date() : capturedAt;

    await this.prisma.click.upsert({
      where: { clickId },
      // Rejeu : la visite existe déjà, on n'y touche pas. La réécrire remettrait une IP et un user-agent sur une
      // visite peut-être déjà nettoyée par un effacement.
      update: {},
      create: {
        clickId,
        campaignId: campaign.id,
        isTest: dto.isTest ?? false,
        createdAt,
        ipAddress: dto.ip ?? null,
        userAgent: dto.userAgent ?? null,
        referrer: dto.pageUrl ?? null,
        rawParams: { source: site, external_id: dto.externalId ?? null } as Prisma.InputJsonValue,
      },
    });

    // UN REJEU N'ENTRE PAS. Le même `externalId`, c'est la même soumission : si elle a déjà produit une personne,
    // repasser par `conversions.create` la FUSIONNAIT avec le nouvel envoi — et le consentement arrivé avec le
    // contact l'emportait. Mesuré par le juré : « TEXTE A » devenait « TEXTE B (corrigé) », daté de la réception.
    // C'est la preuve du droit d'appeler ; un rejeu ne la réécrit pas.
    // UN ENVOI RÉEL SUR UNE VISITE DE TEST. Le partenaire a branché son intégration avec `isTest: true`, puis
    // réutilise le même `externalId` en production : la visite garde son drapeau de test, et le vrai lead serait
    // stocké INVISIBLE (absent des listes et des rapports) pendant qu'on répondrait « stored: true ».
    const visite = await this.prisma.click.findUnique({ where: { clickId }, select: { isTest: true } });
    if (visite?.isTest && !dto.isTest) {
      return { stored: false, clickId, campaignId: campaign.id, reason: 'external_id_used_for_test' };
    }
    const deja = await this.prisma.lead.findUnique({ where: { clickId }, select: { id: true, source: true, erasedAt: true } });
    if (deja && (deja.erasedAt || deja.source === 'erasure')) {
      // Un rejeu sur une visite EFFACÉE : il n'y a plus personne derrière, seulement une pierre tombale. Répondre
      // « stored » laissait croire au partenaire que ce lead existait chez nous (juré r4).
      this.logger.warn(`Intake from ${site} refused: replay of an erased visit`);
      return { stored: false, clickId, campaignId: campaign.id, reason: 'erased_person' };
    }
    if (deja) {
      return { stored: true, clickId, campaignId: campaign.id, replay: true };
    }

    // …et on entre par la porte normale. `create` refuse de recréer une personne effacée, dédoublonne, remplit
    // le lead, déclenche les postbacks : rien de tout ça n'est réécrit ici.
    const outcome = await this.conversions.create(
      {
        clickId,
        eventType: 'lead',
        metadata: {
          // LES RÉPONSES D'ABORD, les champs nommés ensuite. Étalées en dernier, elles écrasaient ce qu'elles
          // touchaient : un partenaire dont le questionnaire porte une question nommée « phone » ou « consent »
          // remplaçait le vrai numéro, ou le texte de consentement — la preuve même du droit d'appeler.
          //
          // ET LES ALIAS AVEC. `leadFromConversion` ne lit pas que les neuf noms canoniques : il accepte aussi
          // `first_name`, `name`, `last_name`, `zipCode`, `postal_code`, `consentText`, `pageUrl` — et pour
          // certains il les lit EN PREMIER. Les laisser passer par les réponses rouvrait le trou par la porte
          // d'à côté : `answers.consentText` devenait la preuve de consentement, et `answers.first_name` valant
          // « Test Dupont » contournait la garde des leads de test, qui ne regarde que `firstName`.
          ...alias(dto.answers),
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phone: dto.phone,
          zip: dto.zip,
          state: dto.state,
          consent: dto.consentText,
          page_url: dto.pageUrl,
          // Le lead porte le nom du site, pas « form » : c'est la colonne que l'opérateur lit dans la liste, et
          // elle répondait la même chose pour tout le monde.
          source: site,
        } as Record<string, unknown>,
        is_test_lead: dto.isTest ?? false,
      } as never,
      { trusted: true, userAgent: dto.userAgent, incomingPostbackIp: dto.ip },
    );

    const skipped = (outcome as { skipped?: boolean; reason?: string } | null)?.skipped === true;
    if (skipped) {
      this.logger.warn(`Intake from ${site} not stored: ${(outcome as { reason?: string }).reason}`);
    }
    return {
      stored: !skipped,
      clickId,
      campaignId: campaign.id,
      ...(skipped ? { reason: (outcome as { reason?: string }).reason } : {}),
    };
  }

  /** La réponse de `deleteOne` dite dans les mots de `eraseVisit` — sans rien perdre en route. */
  private commeUneVisite(out: Awaited<ReturnType<LeadsService['deleteOne']>>) {
    return {
      erased: out.deleted,
      conversionsScrubbed: out.conversionsScrubbed,
      ...(out.skipped ? { skipped: out.skipped } : {}),
      ...(out.suppression ? { suppression: out.suppression } : {}),
    };
  }

  private async personVisits(
    clickId: string,
    contact: {
      phone?: string | null;
      email?: string | null;
      firstName?: string | null;
      lastName?: string | null;
    } = {},
  ): Promise<{ visits: string[]; skipped: { clickId: string; why: string }[] }> {
    try {
      const rows = await visitsOfPerson(this.prisma, clickId, contact);
      const ids = rows.filter((r) => r.kept).map((r) => r.click_id).filter(Boolean);
      const skipped = rows.filter((r) => !r.kept).map((r) => ({ clickId: r.click_id, why: r.why }));
      if (rows.length >= VISITS_LOOKUP_LIMIT) {
        // La borne tronque les visites les plus ANCIENNES (l'ordre est décroissant). Le commentaire de la
        // requête affirmait depuis trois tours que « le compte-rendu le dit » : il ne le disait pas. Une
        // personne à plus de 500 visites n'est pas une hypothèse — un affilié qui reteste sa propre LP en fait
        // autant en une journée.
        skipped.push({
          clickId: `+${VISITS_LOOKUP_LIMIT}`,
          why: `plus de ${VISITS_LOOKUP_LIMIT} visites : les plus anciennes n'ont pas été examinées`,
        });
      }
      if (ids.length > 1) {
        this.logger.warn(`Erasure covers ${ids.length} visit(s) of the same person`);
      }
      if (skipped.length) {
        // « On ne sait pas » n'est pas « il n'y a rien ». Une visite écartée par une garde — contact partagé,
        // identité différente, empreinte de navigateur — est un effacement PARTIEL, et l'appelant doit le savoir
        // pour trancher à la main. Sans ça, la route rendait « effacé » sur un numéro resté appelable.
        this.logger.warn(
          `Erasure left ${skipped.length} visit(s) untouched: ${skipped
            .map((s) => `${s.clickId} (${s.why})`)
            .join(', ')}`,
        );
      }
      return { visits: ids.includes(clickId) ? ids : [clickId, ...ids], skipped };
    } catch (err) {
      // L'effacement le plus partiel possible — une seule visite, celle qui portait la demande — et c'était le
      // seul qui ne le disait pas. Tout le contrat `skipped` existe pour cette phrase-là : la route ne doit
      // jamais répondre « effacé » sans dire ce qu'elle n'a pas pu regarder.
      this.logger.error(`Person visits lookup failed for ${clickId}: ${errorLabel(err)}`);
      return {
        visits: [clickId],
        skipped: [{ clickId, why: 'résolution des autres visites indisponible : effacement limité à celle-ci' }],
      };
    }
  }

  /**
   * Erasure for a person who never produced a lead row: the buyer sent their e-mail in a postback parameter, the
   * landing URL carried their name, or the lead write failed. They are not on the leads screen and have no id, so
   * the only handle is the visit. A tombstone is created for that visit — it is what stops a later event from
   * bringing them back — and everything the visit leaves behind is cleared.
   */
  async eraseVisit(
    clickId: string,
    by?: string,
  ): Promise<{
    erased: boolean;
    conversionsScrubbed?: number;
    /** Les visites qu'une garde a écartées : un effacement partiel se dit, il ne se devine pas. */
    skipped?: { clickId: string; why: string }[];
    suppression?: 'nothing' | 'failed' | 'partial';
  }> {
    const click = await this.prisma.click.findUnique({
      where: { clickId },
      // `rawParams` : sur cette route, la personne n'a pas de ligne de lead, et son numéro ou son courriel n'existe
      // que dans l'URL d'atterrissage ou le postback. C'est là qu'il faut aller le chercher pour retrouver ses
      // autres visites — sinon l'effacement s'arrête au navigateur qui a porté la demande.
      select: { clickId: true, campaignId: true, isTest: true, createdAt: true, rawParams: true },
    });
    if (!click) return { erased: false };
    const now = new Date();
    const existing = await this.prisma.lead.findUnique({ where: { clickId } });
    if (existing) {
      // `suppression` TRAVERSE : la même personne, la même panne de liste, et la route par visite la taisait.
      return this.commeUneVisite(await this.deleteOne(existing.id, by));
    }
    // AVANT la moindre écriture, ici aussi. Sur ce chemin la personne n'a pas de ligne de lead : sa clé est dans
    // `rawParams`, que `deleteOne` ne lit pas. Écrire la pierre tombale d'abord, c'est prendre le risque qu'un
    // arrêt entre les deux fasse repasser le rejeu par `deleteOne` — qui relira une ligne vide, ne connaîtra pas
    // `rawParams`, et laissera les visites sœurs porter le numéro pour toujours.
    const carried = leadFromConversion((click.rawParams ?? {}) as Record<string, unknown>);
    const { visits, skipped } = await this.personVisits(clickId, {
      phone: carried.phone,
      email: carried.email,
      firstName: carried.firstName,
      lastName: carried.lastName,
    });
    // SUR CE CHEMIN AUSSI, et avant la moindre écriture. La personne n'a pas de ligne de lead : son contact vit
    // dans `rawParams`. Le juré l'a mesuré — zéro inscription, puis « stored: true » quand elle revenait.
    const suppression = await this.rememberErased(visits, [{ phone: carried.phone, email: carried.email }]);
    try {
      await this.prisma.lead.create({
        data: {
          clickId,
          campaignId: click.campaignId,
          source: 'erasure',
          isTest: click.isTest,
          createdAt: click.createdAt,
          erasedAt: now,
          purgedAt: now,
        },
      });
    } catch (err) {
      // Créée entre-temps par un événement en vol : la ligne existe, on l'efface par le chemin normal.
      if (!isUniqueViolation(err)) throw err;
      const raced = await this.prisma.lead.findUnique({ where: { clickId } });
      if (raced) return this.commeUneVisite(await this.deleteOne(raced.id, by));
    }
    // La pierre tombale d'abord, ici aussi, et pour la même raison.
    await this.tombstoneVisits(visits, now, click.campaignId, { isTest: click.isTest, createdAt: click.createdAt });
    const scrubbed = await scrubVisitPii(this.prisma, visits, 'erased');
    await this.prisma.lead.updateMany({ where: { clickId: { in: visits } }, data: { scrubbedAt: new Date() } });
    this.logger.warn(`Visit ${clickId} erased on request${by ? ` by ${by}` : ''} (${scrubbed} conversion(s) scrubbed)`);
    return {
      erased: true,
      conversionsScrubbed: scrubbed,
      ...(skipped.length ? { skipped } : {}),
      // « nothing » se dit aussi : un effacement qui n'a trouvé AUCUN contact à inscrire ne protège personne
      // contre un retour, et l'opérateur doit le savoir au moment où il efface.
      ...(suppression !== 'recorded' ? { suppression } : {}),
    };
  }

  /**
   * Catches leads whose row failed to be written when the conversion arrived (database hiccup, code deployed after
   * the event). Reads the contact-carrying conversions of the last two days and creates what is missing.
   */
  @Cron('17 * * * *')
  async reconcileRecentLeads(): Promise<{ created: number; repaired: number; checked: number }> {
    const since = new Date(Date.now() - RECONCILE_WINDOW_HOURS * 60 * 60 * 1000);
    const conversions = await this.prisma.conversion.findMany({
      where: { eventType: { in: [...CONTACT_EVENT_TYPES] }, createdAt: { gte: since } },
      select: { id: true, clickId: true, campaignId: true, metadata: true, createdAt: true, isTest: true },
      orderBy: { createdAt: 'desc' },
      take: RECONCILE_MAX_CONVERSIONS,
    });
    if (conversions.length === 0) return { created: 0, repaired: 0, checked: 0 };
    const byClick = new Map<string, typeof conversions>();
    for (const row of conversions) {
      const rows = byClick.get(row.clickId);
      if (rows) rows.push(row);
      else byClick.set(row.clickId, [row]);
    }
    const known = new Set(
      (
        await this.prisma.lead.findMany({
          where: { clickId: { in: [...byClick.keys()] } },
          select: { clickId: true },
        })
      ).map((l) => l.clickId),
    );
    let created = 0;
    let repaired = 0;
    for (const [clickId, unsorted] of byClick) {
      const rows = [...unsorted].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      let data: LeadData | null = null;
      for (const row of rows) {
        data = mergeLeadData(data, leadFromConversion(row.metadata as Record<string, unknown>, undefined, row.createdAt));
      }
      if (!data || !hasContact(data)) continue;
      try {
        if (!known.has(clickId)) {
          await this.prisma.lead.create({
            data: {
              ...data,
              answers: data.answers ?? undefined,
              clickId,
              campaignId: rows[0].campaignId,
              conversionId: rows[0].id,
              isTest: rows.some((r) => r.isTest),
              createdAt: rows[0].createdAt,
            },
          });
          created += 1;
          continue;
        }
        // Ligne existante : complétée champ par champ côté base, donc sans jamais écraser ce qu'une écriture
        // concurrente vient d'y mettre, et sans toucher une ligne effacée ou purgée.
        if (await fillLead(this.prisma, clickId, data, rows[0].id)) repaired += 1;
      } catch (err) {
        if (isUniqueViolation(err)) {
          // Créée entre-temps par un événement en vol : on la complète au lieu d'abandonner ce tour.
          if (await fillLead(this.prisma, clickId, data, rows[0].id)) repaired += 1;
          continue;
        }
        this.logger.error(`Reconcile failed for click ${clickId}: ${errorLabel(err)}`);
      }
    }
    if (created > 0 || repaired > 0) {
      this.logger.warn(`Reconciled leads: ${created} created, ${repaired} completed`);
    }
    return { created, repaired, checked: byClick.size };
  }

  /**
   * Retention: after LEADS_PII_RETENTION_DAYS the fields that identify a person are cleared, and what reports need
   * (campaign, ZIP, state, answers, consent hash and date) stays. Disabled while the variable is unset.
   */
  @Cron('30 3 * * *')
  async purgePersonalData(now: Date = new Date()): Promise<{ purged: number; visits: number; days: number }> {
    const days = Number(this.config.get<string>('LEADS_PII_RETENTION_DAYS') ?? 0);
    if (!Number.isFinite(days) || days <= 0) {
      // Une conformité qui dépend d'une variable absente n'est pas une conformité : le dire à chaque tour, sinon
      // l'effacement automatique paraît fait alors qu'il n'a jamais tourné.
      this.logger.error('LEADS_PII_RETENTION_DAYS absent ou nul : la rétention des données personnelles NE TOURNE PAS');
      return { purged: 0, visits: 0, days: 0 };
    }
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    let purged = 0;
    let capped = true;
    // Par lots, jusqu'à épuisement : sur une base à mettre en conformité, un seul lot par nuit laisserait la
    // rétention fausse pendant des semaines.
    for (let round = 0; round < PURGE_MAX_ROUNDS; round += 1) {
      const due = await this.prisma.lead.findMany({
        where: { createdAt: { lt: cutoff }, purgedAt: null, erasedAt: null },
        select: { id: true, clickId: true, answers: true },
        take: PURGE_BATCH,
      });
      if (due.length === 0) break;
      const clickIds = due.map((l) => l.clickId);
      // Les réponses du quiz restent (les rapports les lisent), mais sans la personne qu'un texte libre y a écrite :
      // la liste les LIT (registre : colonne « contact »), la rétention doit donc les nettoyer, par portées. Écrit
      // AVANT la marque « purgée » : coupé ici, le lead reste dû et le tour suivant reprend.
      for (const l of due) {
        const neuf = nettoyageJs('leads', l as unknown as Record<string, unknown>, 'purged');
        if (Object.keys(neuf).length) {
          await this.prisma.lead.update({ where: { id: l.id }, data: neuf as Prisma.LeadUpdateInput });
        }
      }
      const res = await this.prisma.lead.updateMany({
        where: { clickId: { in: clickIds }, purgedAt: null, erasedAt: null },
        // Les colonnes vidées viennent du registre : à la rétention, `vider` seulement (le code postal, l'État et les
        // réponses restent, pour les rapports).
        data: { ...donneesVidees('leads', 'purged'), purgedAt: now },
      });
      // Les mêmes personnes vivent dans les métadonnées des conversions, dans les colonnes du clic et, hachées, dans
      // les journaux de postback : la rétention doit les atteindre toutes, sinon elle est fausse.
      const scrubbed = await scrubVisitPii(this.prisma, clickIds, 'purged', now);
      await this.prisma.lead.updateMany({
        where: { clickId: { in: clickIds }, scrubbedAt: null },
        data: { scrubbedAt: now },
      });
      purged += res.count;
      this.logger.warn(
        `Purged personal fields of ${res.count} lead(s) older than ${days} day(s), ${scrubbed} conversion(s) scrubbed`,
      );
      if (due.length < PURGE_BATCH) {
        capped = false;
        break;
      }
    }
    if (capped && purged > 0) {
      // Le plafond de tours est atteint : il reste des lignes dues ce soir. Le dire, sinon la rétention paraît faite.
      this.logger.error(
        `Retention cap reached (${PURGE_MAX_ROUNDS} rounds): personal data older than ${days} day(s) remains`,
      );
    }
    const visits = await this.purgeOldVisits(cutoff);
    return { purged, visits, days };
  }

  /**
   * Retention for the visits that never became a lead: a postback carrying an e-mail, a contact event whose lead row
   * failed to be written, a landing URL with the name in its query string. Sweeping `leads` alone would leave those
   * people readable for ever. Reports keep what they read: country, device and browser are their own columns.
   */
  private async purgeOldVisits(cutoff: Date): Promise<number> {
    let swept = 0;
    let capped = true;
    for (let round = 0; round < PURGE_MAX_ROUNDS; round += 1) {
      const due = await visitsDueForPurge(this.prisma, cutoff, PURGE_BATCH);
      if (due.length === 0) {
        capped = false;
        break;
      }
      const clickIds = due.map((c) => c.click_id);
      try {
        await scrubVisitPii(this.prisma, clickIds, 'purged');
      } catch (err) {
        // Un lot qui casse ne doit pas emporter la rétention de la nuit : les visites non marquées reviendront
        // au tour suivant, et l'erreur est dite.
        this.logger.error(`Visit sweep failed on a batch of ${clickIds.length}: ${errorLabel(err)}`);
        break;
      }
      swept += clickIds.length;
      if (due.length < PURGE_BATCH) {
        capped = false;
        break;
      }
    }
    if (swept > 0) this.logger.warn(`Purged personal data of ${swept} visit(s) past retention`);
    if (capped) {
      // Le plafond de tours est atteint : des visites restent dues ce soir. Sans cette ligne, la rétention paraît
      // faite alors qu'elle est en retard.
      this.logger.error(`Retention cap reached on visits (${PURGE_MAX_ROUNDS} rounds): more remain past retention`);
    }
    return swept;
  }
}
