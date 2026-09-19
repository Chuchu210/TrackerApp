// Tour 25 : ce que les correctifs du juré r6 promettent, chaque règle isolée — et les trous de tests qu'il a mesurés.
import { LeadsService } from '../src/leads/leads.service';
import {
  contactFingerprints,
  contactsInAnything,
  declaredContactsIn,
  leadFromConversion,
  lireContacts,
  normalizeEmail,
} from '../src/leads/lead-fields';

const CLE = 'cle-de-test-0123456789abcdef-0123456789';
const TEMOIN = contactFingerprints({ email: 'temoin@liste-de-suppression.invalid' }, CLE)[0].hash;
const cfg = { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE : undefined)) };

describe('tour 25 : lecture des contacts', () => {
  it('le « déclaré » l’emporte au dédoublonnage, même vu APRÈS le même numéro trouvé dans un texte', () => {
    expect(declaredContactsIn({ note: 'rappeler au 813-555-0142', phone: '813-555-0142' })).toEqual([{ phone: '8135550142' }]);
  });

  it('deux numéros séparés d’espaces, écrits en blocs, sont deux numéros', () => {
    expect(contactsInAnything({ note: '813 555 0142 407 555 0199' })).toEqual(
      expect.arrayContaining([{ phone: '8135550142' }, { phone: '4075550199' }]),
    );
  });

  it('une valeur trop longue pour être lue en entier le DIT (complet: false)', () => {
    // Une valeur est toujours lue en entier ; c'est ce qui la SUIT qui n'est plus lu, et qui doit se dire.
    expect(lireContacts({ cookie: 'x'.repeat(2_100_000), contact_email: 'ann@example.com' }).complet).toBe(false);
    expect(lireContacts({ phone: '813-555-0142' }).complet).toBe(true);
  });

  it('`agent_notes` se lit ; seul le user-agent est ignoré', () => {
    expect(contactsInAnything({ agent_notes: 'rappeler au 813-555-0142' })).toEqual([{ phone: '8135550142' }]);
    expect(contactsInAnything({ user_agent: 'Chrome/126.0.6478.127 x 813-555-0142' })).toEqual([]);
  });

  it('un numéro de TIERS (`support_phone`) est lu comme trouvé, pas déclaré', () => {
    expect(declaredContactsIn({ support_phone: '1-800-555-1212', contact_email: 'ann@example.com' })).toEqual([
      { email: 'ann@example.com' },
    ]);
    expect(contactsInAnything({ support_phone: '1-800-555-1212' })).toEqual([{ phone: '8005551212' }]);
  });

  it('ce qui borde une adresse n’en fait pas partie, à l’entrée comme à l’empreinte', () => {
    for (const bordee of ['​ann@example.com', '“ann@example.com”', '«ann@example.com»', '[ann@example.com]', '*ann@example.com*']) {
      expect(normalizeEmail(bordee)).toBe('ann@example.com');
    }
  });

  it('le user-agent rangé avec le lead est coupé à 400', () => {
    expect(leadFromConversion({ phone: '4155550134' }, { userAgent: 'a'.repeat(450) } as never).userAgent).toHaveLength(400);
  });
});

describe('tour 25 : un effacement qui n’a pas tout lu répond « partial »', () => {
  it('deleteOne sur une personne dont une conversion dépasse le budget de lecture', async () => {
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'lead-1', clickId: 'c1', campaignId: 'camp', isTest: false, createdAt: new Date('2026-09-01T00:00:00Z'),
          phone: '8135550142', email: null, firstName: 'Ann', lastName: null, erasedAt: null, purgedAt: null,
        }),
        findMany: jest.fn().mockResolvedValue([{ phone: '8135550142', email: null }]),
        upsert: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      erasedContact: {
        findFirst: jest.fn().mockResolvedValue({ hash: TEMOIN }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      conversion: {
        findMany: jest.fn().mockResolvedValue([{ metadata: { notes: 'x'.repeat(2_100_000), contact_email: 'ann@example.com' } }]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ clickId: 'c1', campaignId: 'camp', isTest: false, createdAt: new Date(), rawParams: {} }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn({ lead: { update: jest.fn() } })),
    };
    const out = await new LeadsService(cfg as never, prisma as never, {} as never).deleteOne('lead-1');
    expect(out).toMatchObject({ deleted: true, suppression: 'partial' });
    // Le numéro déclaré est inscrit quand même : « partial » ne veut pas dire « rien ».
    expect(prisma.erasedContact.createMany).toHaveBeenCalled();
  });

  it('rien trouvé ET pas tout lu : « partial », jamais « nothing » (le contact était peut-être dans la partie non lue)', async () => {
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'lead-1', clickId: 'c1', campaignId: 'camp', isTest: false, createdAt: new Date('2026-09-01T00:00:00Z'),
          phone: null, email: null, firstName: 'Ann', lastName: null, erasedAt: null, purgedAt: null,
        }),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      erasedContact: {
        findFirst: jest.fn().mockResolvedValue({ hash: TEMOIN }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      conversion: {
        findMany: jest.fn().mockResolvedValue([{ metadata: { notes: 'x'.repeat(2_100_000), contact_email: 'ann@example.com' } }]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ clickId: 'c1', campaignId: 'camp', isTest: false, createdAt: new Date(), rawParams: {} }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn({ lead: { update: jest.fn() } })),
    };
    const out = await new LeadsService(cfg as never, prisma as never, {} as never).deleteOne('lead-1');
    expect(out).toMatchObject({ deleted: true, suppression: 'partial' });
    expect(prisma.erasedContact.createMany).not.toHaveBeenCalled();
  });
});
