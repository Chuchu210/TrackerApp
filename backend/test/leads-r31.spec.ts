// Tour 31 (juré r12 : 7,5) — UN détecteur. Ce que la liste inscrit, le nettoyage le retire : les tests de ce fichier
// tiennent ce que les preuves du juré ne couvrent pas (lecture groupée, noms ajoutés à la liste blanche, clé ⇔ valeur).
import { LeadsService } from '../src/leads/leads.service';
import {
  contactFingerprints,
  declaredContactsIn,
  porteesLues,
  redactPersonal,
  referrerSansPersonne,
  sanitizeUrlPii,
  withoutContact,
} from '../src/leads/lead-fields';

const CLE = 'cle-tour-31-0123456789abcdef-0123456789';
const TEMOIN = contactFingerprints({ email: 'temoin@liste-de-suppression.invalid' }, CLE)[0].hash;
const cfg = { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE : undefined)) };

describe('R12-5 — la liste de suppression se lit en UNE requête', () => {
  it('quatre contacts à l’entrée : un seul findMany (le témoin, lui, est lu une fois par clé)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const findFirst = jest.fn().mockResolvedValue({ hash: TEMOIN });
    const service = new LeadsService(cfg as never, { erasedContact: { findFirst, findMany, createMany: jest.fn() } } as never, {} as never);
    const refuse = await service.isErasedPerson(
      [{ phone: '813-555-0142', email: 'ann@example.com' }],
      [{ phone: '727-555-0199' }, { email: 'bob@example.org' }],
    );
    expect(refuse).toBe(false);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where.hash.in).toHaveLength(4);
    expect(findFirst.mock.calls.every(([a]: [{ where: { kind?: string } }]) => a.where.kind === 'temoin')).toBe(true);
  });
});

describe('noms de la liste blanche : DÉCLARÉS à la lecture, donc RETIRÉS par clé au nettoyage', () => {
  it.each(['callback_number', 'daytime_phone', 'landline', 'home_number', 'cellular', 'sms_number', 'whatsapp', 'cell_phone', 'phone2'])(
    '%s',
    (cle) => {
      expect(declaredContactsIn({ [cle]: '813 555 0142' })).toEqual([{ phone: '8135550142' }]);
      expect(withoutContact({ [cle]: '813 555 0142', zip: '33610' }, 'purged')).toEqual({ zip: '33610' });
      expect(sanitizeUrlPii(`https://lp.example/q?${cle}=813%C2%A0555%C2%A00142&utm_source=fb`, 'purged')).toBe(
        `https://lp.example/q?${cle}=***&utm_source=fb`,
      );
    },
  );
});

describe('la clé suffit : un champ de contact part entier, même quand sa valeur ne se lit pas comme un numéro', () => {
  it('`whatsapp: "same as above"`, `phone: "415"` : la clé dit « contact », la valeur part', () => {
    expect(withoutContact({ whatsapp: 'same as above', phone: '415', zip: '33610' }, 'purged')).toEqual({ zip: '33610' });
  });

  it('`field_data: [{ name, values }]` : la valeur se juge sous le NOM du champ, au nettoyage comme à la lecture', () => {
    const v = { field_data: [{ name: 'full_name', values: ['Ann Dupont'] }, { name: 'zip_code', values: ['33610'] }] };
    // Tour 32 (juré r13) : l'ÉTIQUETTE d'un champ décrit reste — sans elle, un effacement ultérieur relisait la valeur
    // sans son nom (un `ttclid` devenait un numéro). La valeur de la personne part, elle.
    expect(withoutContact(v, 'purged')).toEqual({ field_data: [{ name: 'full_name' }, { name: 'zip_code', values: ['33610'] }] });
    // Hors d'un champ décrit, `name` reste une donnée personnelle, retirée.
    expect(withoutContact({ name: 'Ann Dupont', zip: '33610' }, 'purged')).toEqual({ zip: '33610' });
  });
});

describe('balayage long du tour 31 (120 graines) : les cas trouvés, gardés mot pour mot', () => {
  it.each([
    // graine 83 : « - » entouré d'espaces n'ouvre pas une forme nord-américaine après un bloc non séparé
    ['192.168.1.25 0044 7309 354156 - 2024', ['447309354156']],
    // graine 89 : « 00 » après une virgule de prix n'est pas un indicatif (et le ZIP+4 reste un ZIP+4)
    [',\u200b+1 423 442 9552 $9,004.61 75581-7905', ['4234429552']],
    // graine 10 : « +4 12731-5136 » n'a la longueur d'aucun pays
    ['mobile=233+840-8018+ext.+4 12731-5136', ['2338408018']],
    // graine 16
    ['$6,003.51 95969-0106 on 09/17/2026 *+1.476.951.2063* - at 5', ['4769512063']],
  ])('« %s »', (texte, numeros) => {
    expect(porteesLues({ note: texte }).map((p) => p.phone).filter(Boolean).sort()).toEqual([...new Set(numeros)].sort());
  });

  it('« 813 - 555-0142 » (tiret entouré d’espaces puis tiret) reste un numéro', () => {
    expect(porteesLues({ note: 'call 813 - 555-0142' }).map((p) => p.phone)).toEqual(['8135550142']);
  });
});

describe('banc de mutation du tour 31 : ce que les autres preuves ne couvraient pas', () => {
  it.each([
    ['call 925.760.5334ext.21', '9257605334'],
    ['call (555)823-6705x.12 tonight', '5558236705'],
  ])('un poste collé au numéro, dans un texte libre : « %s » ⇒ lu, et retiré', (texte, numero) => {
    expect(porteesLues({ note: texte }).map((p) => p.phone)).toEqual([numero]);
    expect(redactPersonal(texte)).not.toContain(numero.slice(-4));
  });

  it('une carte bancaire : jamais inscrite (ce n’est pas un contact), toujours retirée', () => {
    expect(porteesLues({ note: 'card 4111 1111 1111 1111 exp 12/29' })).toEqual([]);
    expect(redactPersonal('card 4111 1111 1111 1111 exp 12/29')).toBe('card *** exp 12/29');
  });

  it('une URL dans un texte : sa query string se lit par paramètre (« + » = espace), pas comme une phrase', () => {
    expect(porteesLues({ note: 'see https://lp.example/?note=write+to+ann@x.com thanks' }).map((p) => p.email)).toEqual(['ann@x.com']);
  });

  it('`sub1=(813)%20555-0142` : la valeur n’était QUE la personne ⇒ `sub1=***`, sans sa parenthèse', () => {
    expect(sanitizeUrlPii('https://t.io/pb?sub1=(813)%20555-0142&cid=1', 'erased')).toBe('https://t.io/pb?sub1=***&cid=1');
  });

  it('référent sans schéma : l’hôte, pas « Unassigned » ; une phrase : rien', () => {
    expect(referrerSansPersonne('facebook.com', 'purged')).toBe('facebook.com');
    expect(referrerSansPersonne('lp.example/merci?tel=8135550142', 'erased')).toBe('lp.example');
    expect(referrerSansPersonne('Ann 813-555-0142', 'purged')).toBeNull();
  });

  it('`+33 8135550142` (trop long pour la France) : la valeur déclarée seule, jamais le numéro de Tampa relu après l’indicatif', () => {
    expect(declaredContactsIn({ phone: '+33 8135550142' }).map((c) => c.phone)).toEqual(['338135550142']);
  });
});

describe('une portée lue = une portée retirée, octet pour octet', () => {
  it.each([
    ['Call me at 813\u00a0555\u00a00142 tonight', 'Call me at *** tonight'],
    ['WhatsApp me +55 11 91234-5678 after 6', 'WhatsApp me +*** after 6'],
    ['mail ann&#64;gmail.com please', 'mail *** please'],
    ['https://lp.example/q?note=call+813-555-0142&cid=7', 'https://lp.example/q?note=call+***&cid=7'],
  ])('%s', (texte, attendu) => {
    const [p] = porteesLues({ m: texte });
    expect(p).toBeDefined();
    expect(redactPersonal(texte)).toBe(attendu);
    expect(redactPersonal(texte)).not.toContain(texte.slice(p.debut, p.fin));
  });

  it('un encodage n’est ni décodé ni ré-encodé : l’appelant ne fabrique aucun paramètre', () => {
    const out = sanitizeUrlPii('https://t.io/pb?cid=c1&p1=call%208135550142%26cid%3Dhacked&payout=1', 'erased');
    expect(out).toBe('https://t.io/pb?cid=c1&p1=call%20***%26cid%3Dhacked&payout=1');
  });
});
