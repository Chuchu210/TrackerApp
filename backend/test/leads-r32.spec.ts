import {
  contactFingerprints,
  contactsInAnything,
  lireContacts,
  normalizePhone,
  referrerSansPersonne,
  withoutContact,
} from '../src/leads/lead-fields';
import { casDe, mulberry32 } from './fuzz-personne.gen';

/**
 * Tour 32 — ce que le juré r13 a relevé hors du registre des colonnes (voir `leads-r32.pglite.spec.ts` pour le bout
 * en bout) : l'étiquette d'un champ décrit, le préfixe « 00 », les montants, `gclid`, le zéro de tronc britannique,
 * l'hôte du référent, les conteneurs de formulaires. Chaque attente est le comportement correct.
 */
const tous = (v: unknown) => lireContacts(v).tous;
const cle = (c: { phone?: string | null; email?: string | null }) => (c.phone ? `p:${c.phone}` : `e:${String(c.email).toLowerCase()}`);

describe('P2 — lire(nettoyer(x)) ne contient aucun contact absent de lire(x)', () => {
  const NOMS = ['ttclid', 'gclid', 'vehicle_year', 'order_id', 'zip_code', 'phone_number', 'email', 'full_name', 'lead_id'];
  const decrits = (graine: number, n: number) => {
    const r = mulberry32(graine);
    const tire = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const valeur = () =>
      tire([
        `E.C.P.00${String(Math.floor(r() * 1e10)).padStart(10, '0')}`,
        String(Math.floor(r() * 1e11)),
        `${Math.floor(r() * 900 + 100)}-555-${String(Math.floor(r() * 1e4)).padStart(4, '0')}`,
        'ann@gmail.com',
        '2019',
        `Cj0KCQjw${Math.floor(r() * 1e10)}`,
      ]);
    return Array.from({ length: n }, () => ({
      field_data: Array.from({ length: 1 + Math.floor(r() * 4) }, () =>
        tire([
          () => ({ name: tire(NOMS), values: [valeur()] }),
          () => ({ key: tire(NOMS), value: valeur() }),
          () => ({ column_id: tire(NOMS).toUpperCase(), string_value: valeur() }),
        ])(),
      ),
    }));
  };

  it('sur les cas du générateur et sur des champs décrits, à la rétention, à l’effacement, et l’un après l’autre', () => {
    const entrees = [...[...casDe(3203, 1500)].map((c) => c.valeur), ...decrits(3207, 1500)];
    const apparus: string[] = [];
    for (const x of entrees) {
      const avant = new Set(tous(x).map(cle));
      const retenu = withoutContact(x, 'purged') ?? x;
      for (const y of [retenu, withoutContact(x, 'erased') ?? x, withoutContact(retenu, 'purged') ?? retenu, withoutContact(retenu, 'erased') ?? retenu]) {
        for (const c of tous(y)) if (!avant.has(cle(c))) apparus.push(`${cle(c)} dans ${JSON.stringify(x).slice(0, 160)}`);
      }
    }
    expect(apparus.slice(0, 5)).toEqual([]);
  });

  it('le cas du juré : la rétention garde l’étiquette, et le ttclid ne devient jamais le numéro 9502215342', () => {
    const x = { field_data: [{ name: 'ttclid', values: ['E.C.P.009502215342'] }, { name: 'phone_number', values: ['+18135550142'] }] };
    const retenu = withoutContact(x, 'purged');
    expect(retenu).toEqual({ field_data: [{ name: 'ttclid', values: ['E.C.P.009502215342'] }, { name: 'phone_number' }] });
    expect(tous(retenu)).toEqual([]);
  });
});

describe('P4 — le préfixe « 00 » dans un texte : ni une date ISO, ni un ZIP+4, quand la longueur est celle du pays', () => {
  it.each([
    ['Please call me at 0052-55-2566-1648 after 5pm', '525525661648'],
    ['0052-33-4996-6916', '523349966916'],
    ['WhatsApp 0055 11 91234-5678 obrigado', '5511912345678'],
  ])('%s', (texte, attendu) => {
    expect(contactsInAnything({ notes: texte })).toEqual([{ phone: attendu }]);
    expect(JSON.stringify(withoutContact({ notes: texte }, 'purged'))).not.toMatch(/\d{4}/);
  });

  it('une vraie date ISO et un vrai ZIP+4 restent ce qu’ils sont', () => {
    expect(contactsInAnything({ notes: 'rdv 2026-09-19, zip 33601-1234' })).toEqual([]);
  });
});

describe('P5 — ce qui n’est pas un numéro se décide dans le détecteur SEUL : lu ⇔ retiré', () => {
  it.each([{ total: '1234567.89' }, { memo: 'paid 1234567.89 today' }, { amount: '1,234,567.89' }, { v: '126.0.6478.127' }])(
    'montant ou version %j : ni lu, ni retiré',
    (x) => {
      expect(tous(x)).toEqual([]);
      expect(withoutContact(x, 'purged')).toBeNull();
    },
  );

  it('« 06.12.34.56.78 » est un numéro français, pas une version', () => {
    expect(contactsInAnything({ note: 'rappel au 06.12.34.56.78' })).toEqual([{ phone: '0612345678' }]);
  });

  it('`gclid` est une clé d’identifiant : sa valeur à la forme d’un numéro n’est ni lue ni retirée (mutant M8)', () => {
    expect(tous({ gclid: '8135550142' })).toEqual([]);
    expect(withoutContact({ gclid: '8135550142' }, 'purged')).toBeNull();
    // Le même nombre sous une clé quelconque EST un numéro : c'est bien la clé qui décide.
    expect(tous({ ref: '8135550142' })).toEqual([{ phone: '8135550142' }]);
  });
});

describe('P6 — petites formes', () => {
  it('« +44 07911 123456 » : le zéro de tronc après l’indicatif tombe, même empreinte que « +44 7911 123456 »', () => {
    const f = (p: string) => contactFingerprints({ phone: p }, 'cle-r32-0123456789abcdef-0123456789abcdef')[0].hash;
    for (const v of ['+44 07911 123456', '+44 (0)7911 123456', '0044 7911 123456', '+447911123456']) {
      expect(normalizePhone(v)).toBe('447911123456');
      expect(f(v)).toBe(f('+44 7911 123456'));
    }
  });

  it('un numéro dans l’HÔTE du référent devient `***` ; des identifiants de connexion ne l’emportent pas', () => {
    expect(referrerSansPersonne('https://813-555-0142.lp.example/merci', 'purged')).toBe('https://***.lp.example/merci');
    expect(referrerSansPersonne('https://813-555-0142.lp.example/merci', 'erased')).toBe('https://***.lp.example/');
    expect(referrerSansPersonne('https://user:pw@news.example/a', 'purged')).toBe('https://news.example/a');
  });

  it.each([
    ['entry', { entry: [{ changes: [{ value: { field_data: [{ name: 'phone_number', values: ['+18135550142'] }] } }] }] }],
    ['form_response', { form_response: { answers: [{ type: 'phone_number', phone_number: '+18135550142' }] } }],
    ['user_column_data', { user_column_data: [{ column_id: 'PHONE_NUMBER', string_value: '+18135550142' }] }],
  ])('le conteneur `%s` est lu comme une déclaration', (_, x) => {
    expect(lireContacts(x).declares).toEqual([{ phone: '8135550142' }]);
  });
});
