import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { codePays, paysAvecRegle } from './lead-fields';

/**
 * La clé qui ouvre la porte d'entrée des leads externes — et RIEN D'AUTRE.
 *
 * `ApiKeyGuard` garde toutes les routes d'administration avec `ADMIN_API_KEY` : la liste des leads, l'export, la
 * suppression. Poser cette clé-là sur la porte d'entrée obligerait à la confier à chaque site partenaire, donc à
 * leur donner la base entière pour qu'ils puissent y déposer une ligne. Cette porte a donc sa propre clé.
 *
 * UNE CLÉ PAR SITE, et le site vient DE LA CLÉ, pas du corps de la requête :
 *
 *     INTAKE_API_KEYS="monsite.com:aBc…,autresite.fr:dEf…:FR"
 *
 * (Le « :FR » final, facultatif, est le pays du site : voir `parseIntakeKeys`.)
 *
 * Deux conséquences, et ce sont les deux raisons de ce fichier : on révoque un partenaire sans couper les autres,
 * et un partenaire ne peut pas déposer des leads en se faisant passer pour un autre — ce qui fausserait les
 * chiffres de l'autre, et lui enverrait des personnes qu'il n'a jamais captées.
 *
 * Variable absente = porte fermée. Un repli silencieux sur `ADMIN_API_KEY` rouvrirait exactement le trou que
 * cette classe existe pour boucher, et personne ne s'en apercevrait puisque tout continuerait de marcher.
 */
@Injectable()
export class IntakeKeyGuard implements CanActivate {
  private readonly logger = new Logger(IntakeKeyGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { intakeSite?: string }>();
    const header = request.headers['x-api-key'];
    const presented = Array.isArray(header) ? header[0] : header;
    const entries = parseIntakeKeys(this.config.get<string>('INTAKE_API_KEYS'));

    if (entries.length === 0) {
      // Refuser, la boucle plus bas le ferait déjà. Ce qu'elle ne ferait pas, c'est le DIRE : sans cette ligne,
      // un déploiement où la variable manque rend des 401 que le partenaire lit comme « ma clé est mauvaise », et
      // les deux côtés cherchent au mauvais endroit. La réponse, elle, reste la même pour tout le monde — dire à
      // un inconnu que la porte n'est pas configurée lui apprend quelque chose sur nous.
      this.logger.error('INTAKE_API_KEYS absente : la porte des leads externes refuse tout');
      throw new UnauthorizedException('Invalid intake key');
    }
    const doublons = duplicateIntakeKeys(this.config.get<string>('INTAKE_API_KEYS'));
    if (doublons.length) {
      this.logger.error(
        `INTAKE_API_KEYS : même clé sur plusieurs sites (${doublons.join(', ')}) — le dernier gagne, et les ` +
          'leads du premier lui sont attribués',
      );
    }
    const douteux = paysDouteux(this.config.get<string>('INTAKE_API_KEYS'));
    if (douteux.length) this.logger.error(`INTAKE_API_KEYS : pays sans effet — ${douteux.join(', ')}`);
    if (!presented) {
      this.refus(request, 'aucune clé présentée');
      throw new UnauthorizedException('Invalid intake key');
    }

    // On compare TOUTES les entrées, sans court-circuit : s'arrêter à la première qui correspond ferait du temps
    // de réponse une mesure du rang de la clé dans la liste.
    let site: string | null = null;
    for (const entry of entries) {
      if (safeEqual(presented, entry.key)) site = entry.site;
    }
    if (site === null) {
      // SANS CETTE LIGNE, ON NE VOIT RIEN. La documentation promet au partenaire « dis-le nous, on le voit
      // immédiatement dans nos journaux » — ce qui était faux : seule l'absence de configuration était
      // journalisée. Un martèlement de clés était donc parfaitement silencieux.
      this.refus(request, 'clé inconnue');
      throw new UnauthorizedException('Invalid intake key');
    }

    const claimed = slugSite((request.body as { source?: unknown } | undefined)?.source);
    if (claimed && claimed !== site) {
      // Le lead dirait venir d'ailleurs que là où la clé a le droit de parler. On refuse plutôt que de le ranger
      // d'office chez le porteur de la clé : un partenaire doit apprendre que son `source` est faux.
      throw new ForbiddenException(`cette clé dépose les leads de « ${site} », pas de « ${claimed} »`);
    }
    request.intakeSite = site;
    return true;
  }

  /** Dit un refus au journal — le site visé et l'adresse — sans jamais écrire la clé présentée. */
  private refus(request: Request & { intakeSite?: string }, pourquoi: string): void {
    const declare = slugSite((request.body as { source?: unknown } | undefined)?.source) || 'site non déclaré';
    const ip = request.ip || (request.socket && request.socket.remoteAddress) || 'ip inconnue';
    this.logger.warn(`Intake refusé (${pourquoi}) — ${declare} depuis ${ip}`);
  }
}

/**
 * Les clés en double. Deux sites qui portent la même clé, c'est une faute de copier-coller de l'opérateur — et
 * elle réattribue SILENCIEUSEMENT les leads d'un partenaire à un autre, puisque la dernière entrée gagne.
 */
export function duplicateIntakeKeys(raw: string | undefined): string[] {
  const vues = new Map<string, string[]>();
  for (const e of parseIntakeKeys(raw)) vues.set(e.key, [...(vues.get(e.key) ?? []), e.site]);
  return [...vues.values()].filter((sites) => sites.length > 1).map((sites) => sites.join(" + "));
}

/**
 * « site:clé,site:clé », et, facultatif, le pays du site : « site:clé:FR ». Une entrée sans les deux moitiés n'existe
 * pas : une clé vide ouvrirait la porte.
 *
 * LE PAYS (défaut du 20/09) : un lead qui écrit « 0612345678 » sans indicatif ne dit pas de quel pays il est, et la
 * liste de suppression ne le rapprochait pas de « +33 6 12 34 56 78 ». Le pays du site le dit. Il se lit sur un
 * dernier « :XX » de deux lettres ; sans lui, rien ne change (l'ancien format reste valable). Une clé ne se termine
 * donc jamais par « : » suivi de deux lettres — `openssl rand -hex 32` n'en produit pas.
 */
export function parseIntakeKeys(raw: string | undefined): { site: string; key: string; pays?: string }[] {
  return (raw ?? '')
    .split(',')
    .map((chunk) => {
      const at = chunk.indexOf(':');
      // `<= 0` plutôt que `< 0` : « :clé » n'a pas de site. Le filet en dessous (`site && key`) le rattraperait —
      // c'est dit ici pour que personne ne prenne ces deux lignes pour deux protections là où il y en a une.
      if (at <= 0) return null;
      const site = slugSite(chunk.slice(0, at));
      const reste = chunk.slice(at + 1).trim();
      const avecPays = /^(.*\S)\s*:\s*([A-Za-z]{2})$/.exec(reste);
      const key = avecPays ? avecPays[1] : reste;
      const pays = avecPays ? codePays(avecPays[2]) : null;
      if (!site || !key) return null;
      return pays ? { site, key, pays } : { site, key };
    })
    .filter((e): e is { site: string; key: string; pays?: string } => e !== null);
}

/**
 * Le pays d'un site partenaire, tel que `INTAKE_API_KEYS` le déclare — ou null. Deux entrées du même site (une clé
 * en rotation) qui déclarent deux pays différents ne désignent AUCUN pays : on ne choisit pas au hasard.
 */
export function paysDuSite(raw: string | undefined, site: string): string | null {
  const nom = slugSite(site);
  const pays = new Set(parseIntakeKeys(raw).filter((e) => e.site === nom && e.pays).map((e) => e.pays as string));
  return pays.size === 1 ? [...pays][0] : null;
}

/** Les pays déclarés dans `INTAKE_API_KEYS` qu'aucune règle ne sait lire, et les sites qui en déclarent deux. */
export function paysDouteux(raw: string | undefined): string[] {
  const entrees = parseIntakeKeys(raw);
  const inconnus = entrees.filter((e) => e.pays && !paysAvecRegle(e.pays)).map((e) => `${e.site} (${e.pays} : pas de règle, numéros laissés tels qu'écrits)`);
  const sites = [...new Set(entrees.map((e) => e.site))];
  const contradictoires = sites
    .filter((s) => new Set(entrees.filter((e) => e.site === s && e.pays).map((e) => e.pays)).size > 1)
    .map((s) => `${s} (deux pays : aucun n'est appliqué)`);
  return [...inconnus, ...contradictoires];
}

/** Le nom du site, réduit à ce qui peut servir de repère : « MonSite.com » et « monsite.com » sont le même. */
export function slugSite(raw: unknown): string {
  return typeof raw === 'string'
    ? raw.trim().toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '')
    : '';
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // `timingSafeEqual` jette sur des longueurs différentes ; la longueur se compare donc d'abord.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
