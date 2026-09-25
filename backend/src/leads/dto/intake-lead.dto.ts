import {
  IsBoolean,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';

/** Refuse un objet de réponses trop nombreux ou trop long — en disant lequel des deux. */
function MaxAnswers(maxCles: number, maxLongueur: number, options?: ValidationOptions) {
  return (objet: object, propriete: string) =>
    registerDecorator({
      name: 'maxAnswers',
      target: objet.constructor,
      propertyName: propriete,
      options,
      validator: {
        validate(valeur: unknown) {
          if (valeur === undefined || valeur === null) return true;
          if (typeof valeur !== 'object' || Array.isArray(valeur)) return false;
          const entrees = Object.entries(valeur as Record<string, unknown>);
          if (entrees.length > maxCles) return false;
          // Une réponse est une VALEUR : texte, nombre ou booléen. Un objet imbriqué passait la borne de longueur
          // (`String({…})` vaut « [object Object] », quinze caractères) avec soixante kilo-octets dedans.
          // Et un nom de réponse est un identifiant court, en ASCII : un nom de soixante kilo-octets passait aussi.
          return entrees.every(
            ([k, v]) =>
              /^[A-Za-z0-9_]{1,64}$/.test(k) &&
              ['string', 'number', 'boolean'].includes(typeof v) &&
              String(v).length <= maxLongueur,
          );
        },
        defaultMessage: () =>
          `answers : ${maxCles} réponses au maximum, noms en [A-Za-z0-9_] (64 caractères), valeurs simples de ` +
          `${maxLongueur} caractères au plus`,
      },
    });
}

/**
 * Une longueur comptée en UNITÉS UTF-16, comme la base et `clip` la comptent.
 *
 * `@MaxLength` compte un emoji pour un caractère et `clip` pour deux : un consentement de 1 998 caractères avec des
 * emoji passait la validation puis était TRONQUÉ en base — le seul texte dont la raison d'être est d'être verbatim.
 * Et c'est ce compte-là qui borne la taille du corps : six octets par unité au pire (`\uXXXX`), donc le plus gros
 * corps permis tient sous les 100 ko du parseur, ce que le compte en caractères ne garantissait pas (juré r4 :
 * 108 851 octets).
 */
function MaxUnits(max: number, options?: ValidationOptions) {
  return (objet: object, propriete: string) =>
    registerDecorator({
      name: 'maxUnits',
      target: objet.constructor,
      propertyName: propriete,
      options,
      validator: {
        validate: (valeur: unknown) => valeur === undefined || valeur === null || (typeof valeur === 'string' && valeur.length <= max),
        defaultMessage: () => `${propriete} : ${max} unités UTF-16 au plus (un emoji en compte deux)`,
      },
    });
}

/** Refuse une date postérieure à maintenant : une visite datée du futur échappe à la purge pour toujours. */
function NotInTheFuture(options?: ValidationOptions) {
  return (objet: object, propriete: string) =>
    registerDecorator({
      name: 'notInTheFuture',
      target: objet.constructor,
      propertyName: propriete,
      options,
      validator: {
        validate(valeur: unknown) {
          if (valeur === undefined || valeur === null) return true;
          const quand = new Date(String(valeur));
          // Illisible : REFUSÉE. Laissée passer, elle retombait en silence sur « maintenant » dans le service.
          if (Number.isNaN(quand.getTime())) return false;
          // Une minute de tolérance : les horloges des serveurs ne sont pas synchronisées à la seconde, et
          // refuser un lead pour trente secondes d'avance serait perdre un vrai lead pour rien.
          return quand.getTime() <= Date.now() + 60_000;
        },
        defaultMessage: () => 'capturedAt ne peut pas être dans le futur',
      },
    });
}

/**
 * Un lead capté sur un site qui n'est pas le nôtre.
 *
 * Jusqu'ici, un lead ne pouvait naître que d'une CONVERSION, et une conversion exigeait un clic déjà connu du
 * tracker : un formulaire rempli sur un autre site n'avait aucune porte d'entrée — `Click not found`. Cette
 * porte-là en ouvre une, sans rien changer à la suite : on fabrique la visite qui manque, puis on passe par le
 * chemin normal. Tout ce qui a été construit derrière — effacement, rétention, export, preuve de consentement,
 * refus de recréer une personne effacée — s'applique sans une ligne de plus.
 */
export class IntakeLeadDto {
  /**
   * Le site d'origine, tel qu'on veut le voir dans les rapports : « monsite.com ».
   *
   * FACULTATIF, et vérifié plutôt que cru : le site est celui que la clé d'API désigne (`IntakeKeyGuard`). Envoyé
   * quand même, il doit s'accorder avec la clé — sinon la requête est refusée, pour que le partenaire apprenne
   * que sa déclaration est fausse au lieu de voir ses leads rangés silencieusement ailleurs.
   */
  @IsOptional()
  @IsString()
  @MaxUnits(120)
  source?: string;

  /**
   * L'identifiant du lead CHEZ EUX. C'est lui qui rend l'appel rejouable : deux envois du même lead ne font
   * qu'une visite et qu'une ligne. Sans lui, un doublon est indiscernable d'un second formulaire.
   */
  @IsOptional()
  @IsString()
  @MaxUnits(120)
  externalId?: string;

  @IsOptional() @IsString() @MaxUnits(120) firstName?: string;
  @IsOptional() @IsString() @MaxUnits(120) lastName?: string;
  @IsOptional() @IsString() @MaxUnits(200) email?: string;
  @IsOptional() @IsString() @MaxUnits(40) phone?: string;

  /**
   * Le pays de la personne (ISO 3166, deux lettres : « FR », « GB », « US »), s'il est connu. Il dit comment lire un
   * `phone` écrit sans indicatif (« 0612345678 » est +33 6 12 34 56 78 en France) ; absent, c'est le pays du site
   * (configuré avec la clé) ; aucun des deux, le numéro reste tel qu'écrit. Jamais deviné.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\s*[A-Za-z]{2}\s*$/, { message: 'country : un code pays ISO à deux lettres, par exemple FR' })
  country?: string;
  @IsOptional() @IsString() @MaxUnits(20) zip?: string;
  @IsOptional() @IsString() @MaxUnits(80) state?: string;

  /**
   * Les réponses d'un questionnaire, telles quelles — mais bornées.
   *
   * Sans borne, un partenaire construit des métadonnées de plusieurs mégaoctets : la limite d'Express rend alors
   * un 413 que personne n'a documenté, et ce qui passe sous la limite gonfle la base d'un contenu que rien ne
   * lit. Cinquante réponses, c'est déjà deux fois le plus long questionnaire qu'on ait vu.
   */
  @IsOptional()
  @IsObject()
  // 50 × 500, et non 50 × 2000 : le parseur JSON refuse tout corps au-delà de 100 ko, et 50 réponses de 2 000
  // caractères dépassaient à elles seules cette limite — un partenaire qui respectait les bornes documentées
  // recevait un 413. À 500 caractères, même en caractères accentués (jusqu'à 3 octets), le plus gros corps
  // permis reste sous la limite.
  // 200 : c'est ce que le lead garde (`clip(answer, 200)`), et c'est ce qui fait tenir le PIRE corps permis sous
  // les 100 ko du parseur même quand la bibliothèque du partenaire échappe l'Unicode en `\uXXXX` (six octets
  // par caractère) — le réglage par défaut de Python et de PHP. À 500, un corps conforme recevait un 413.
  @MaxAnswers(50, 200)
  answers?: Record<string, unknown>;

  /**
   * Le texte de consentement TEL QU'IL A ÉTÉ AFFICHÉ à la personne. C'est la seule preuve qu'un appel était
   * autorisé ; sans lui, le lead est stocké mais on ne pourra jamais démontrer qu'on avait le droit d'appeler.
   */
  // 2 000 et non 4 000 : c'est ce que la base garde (`clip(meta.consent, 2000)`). Annoncer 4 000 puis tronquer
  // en silence détruit la fin du seul texte dont la raison d'être est d'être VERBATIM — et personne ne s'en
  // aperçoit avant d'avoir à le produire. Un refus explicite laisse le partenaire raccourcir lui-même.
  @IsOptional() @IsString() @MaxUnits(2000) consentText?: string;

  /** L'URL de la page où le formulaire a été rempli, et l'IP/le navigateur de la personne s'ils sont connus. */
  @IsOptional() @IsString() @MaxUnits(500) pageUrl?: string;
  @IsOptional() @IsString() @MaxUnits(60) ip?: string;
  @IsOptional() @IsString() @MaxUnits(500) userAgent?: string;

  /**
   * Quand le lead a été capté CHEZ EUX, s'il n'arrive pas en temps réel. Une date, pas une chaîne quelconque :
   * `@IsString` laissait passer « hier », qui retombait silencieusement sur maintenant.
   *
   * Et jamais dans le futur : une visite datée de 2099 n'atteindrait JAMAIS sa date de purge, donc les données
   * personnelles de cette personne resteraient pour toujours. Une horloge mal réglée chez un partenaire suffit.
   */
  // LA FORME ÉTENDUE, AVEC L'HEURE ET UN FUSEAU. `@IsISO8601` seul acceptait `20260801T140311Z`, `2026-W31-4`,
  // `2026-213` — que `new Date` ne sait pas lire, donc datés de « maintenant » sans rien dire — et `2026-02-30`,
  // lu comme le 2 mars. Une heure sans fuseau se lit dans le fuseau du SERVEUR : décalée de quatre à dix heures.
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i, {
    message: 'capturedAt : ISO 8601 étendu avec heure et fuseau, par exemple 2026-09-17T14:03:11Z',
  })
  @NotInTheFuture()
  capturedAt?: string;

  @IsOptional() @IsBoolean() isTest?: boolean;
}
