// Jury R4 (repris tel quel comme critère d'acceptation au tour 23) : preuves des défauts suspectés. Chaque test ÉCHOUE si le défaut est présent (attente = comportement correct).
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IntakeLeadDto } from '../src/leads/dto/intake-lead.dto';
import { LeadsService } from '../src/leads/leads.service';
import {
  contactFingerprints,
  contactsInAnything,
  leadFromConversion,
  withoutContact,
} from '../src/leads/lead-fields';

const CLE = 'cle-de-test-0123456789abcdef-0123456789';
const TEMOIN = contactFingerprints({ email: 'temoin@liste-de-suppression.invalid' }, CLE)[0].hash;
const cfg = { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE : undefined)) };

function liste(...contacts: { phone?: string; email?: string }[]) {
  const connues = new Set(contacts.flatMap((c) => contactFingerprints(c, CLE).map((m) => m.hash)));
  return {
    findFirst: jest.fn().mockImplementation(({ where }: { where: { kind?: string; hash?: { in: string[] } } }) => {
      if (where?.kind === 'temoin') return Promise.resolve({ hash: TEMOIN });
      return Promise.resolve(where.hash!.in.some((h) => connues.has(h)) ? { hash: 'x' } : null);
    }),
    // Tour 31 : la lecture groupée d'`isErasedPerson` — des lignes déclarées, d'avant les groupes.
    findMany: jest.fn().mockImplementation(({ where }: { where: { hash: { in: string[] } } }) =>
      Promise.resolve(where.hash.in.filter((h) => connues.has(h)).map((hash) => ({ hash, kind: 'phone', groupe: null }))),
    ),
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
}

function porte(l: ReturnType<typeof liste>) {
  return {
    campaign: { upsert: jest.fn().mockResolvedValue({ id: 'camp-ext' }) },
    click: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue({ isTest: false }) },
    lead: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    erasedContact: l,
  };
}

describe('JURY R4 — D1 : eraseVisit perd `suppression` quand la visite a une ligne de lead', () => {
  function base() {
    const leadRow = {
      id: 'lead-1', clickId: 'c1', campaignId: 'camp-A', isTest: false,
      createdAt: new Date('2026-07-01T00:00:00Z'), phone: '8135550142', email: 'ann@example.com',
      firstName: 'Ann', lastName: null, erasedAt: null, purgedAt: null,
    };
    return {
      lead: {
        findUnique: jest.fn().mockResolvedValue(leadRow),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      erasedContact: {
        findFirst: jest.fn().mockResolvedValue({ hash: TEMOIN }),
        createMany: jest.fn().mockRejectedValue(new Error('base indisponible')),
      },
      conversion: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ clickId: 'c1', campaignId: 'camp-A', isTest: false, createdAt: new Date(), rawParams: {} }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn({ lead: { update: jest.fn() } })),
    };
  }

  it('deleteOne dit « failed »…', async () => {
    const out = await new LeadsService(cfg as never, base() as never, {} as never).deleteOne('lead-1');
    expect(out).toMatchObject({ suppression: 'failed' });
  });

  it('…mais DELETE /api/leads/visit/c1 (même personne, même panne) le TAIT', async () => {
    const out = await new LeadsService(cfg as never, base() as never, {} as never).eraseVisit('c1');
    expect(out).toMatchObject({ erased: true, suppression: 'failed' });
  });
});

describe('JURY R4 — D2 : le nettoyage retire des numéros que la liste de suppression n’inscrit pas', () => {
  it('un numéro dans un texte libre de conversion / paramètre de postback est effacé mais pas empreinté', () => {
    const conv = { postbackParam1: 'tel:8135550142', metadata: { comments_x: 'Ann, rappeler au 813-555-0142' } };
    // Le nettoyage voit bien la personne :
    expect(withoutContact({ p: conv.postbackParam1 }, 'erased')).not.toBeNull();
    expect(withoutContact({ c: conv.metadata.comments_x }, 'erased')).not.toBeNull();
    // …l'inscription, non :
    expect(contactsInAnything(conv)).toEqual(expect.arrayContaining([{ phone: '8135550142' }]));
  });

  it('une adresse doublement encodée hors URL est effacée mais pas empreintée', () => {
    expect(withoutContact({ sub1: 'ann%2540example.com' }, 'erased')).not.toBeNull();
    expect(contactsInAnything({ sub1: 'ann%2540example.com' })).toEqual([{ email: 'ann@example.com' }]);
  });

  it('bout en bout : effacée avec ce numéro, elle revient par intake avec stored:true', async () => {
    // Ce que rememberErased aurait inscrit pour cette conversion :
    const inscrits = contactsInAnything({ postbackParam1: 'tel:8135550142', metadata: { email: 'ann@example.com' } });
    const l = liste(...inscrits);
    const conversions = { create: jest.fn().mockResolvedValue({ id: 'c' }) };
    const out = await new LeadsService(cfg as never, porte(l) as never, conversions as never).intake({
      source: 'monsite.com',
      phone: '(813) 555-0142',
    });
    expect(out).toMatchObject({ stored: false, reason: 'erased_person' });
  });
});

describe('JURY R4 — D3 : une personne effacée revient par intake avec un contact que la normalisation déforme', () => {
  it('adresse sous forme « Nom <adresse> » : refusée comme contact, mais écrite en clair dans la conversion', async () => {
    const l = liste({ email: 'ann@example.com', phone: '8135550142' });
    const conversions = { create: jest.fn().mockResolvedValue({ id: 'c' }) };
    const out = await new LeadsService(cfg as never, porte(l) as never, conversions as never).intake({
      source: 'monsite.com',
      firstName: 'Ann',
      email: 'Ann Dupont <ann@example.com>',
    });
    const meta = conversions.create.mock.calls[0]?.[0]?.metadata;
    expect({ out, email: meta?.email }).toMatchObject({ out: { stored: false, reason: 'erased_person' } });
  });

  it('numéro avec extension : stocké avec un numéro FAUX (11 chiffres) et la personne effacée passe', async () => {
    expect(leadFromConversion({ phone: '(813) 555-0142 x7' }).phone).toBe('8135550142');
  });

  it('adresse de la personne effacée dans une réponse de questionnaire : non vérifiée, écrite en clair', async () => {
    const l = liste({ email: 'ann@example.com' });
    const conversions = { create: jest.fn().mockResolvedValue({ id: 'c' }) };
    const out = await new LeadsService(cfg as never, porte(l) as never, conversions as never).intake({
      source: 'monsite.com',
      firstName: 'Ann',
      answers: { contact_email: 'ann@example.com' },
    });
    expect(out).toMatchObject({ stored: false, reason: 'erased_person' });
  });
});

describe('JURY R4 — D4 : capturedAt ISO accepté puis remplacé EN SILENCE par « maintenant »', () => {
  function erreurs(corps: Record<string, unknown>): string[] {
    return validateSync(plainToInstance(IntakeLeadDto, corps), { whitelist: true }).map((e) => e.property);
  }
  it.each(['20260801T140311Z', '2026-W31-4', '2026-213'])('%s : refusé, ou bien daté correctement', async (s) => {
    const refuse = erreurs({ phone: '8135550142', capturedAt: s }).includes('capturedAt');
    if (refuse) return;
    const prisma = porte(liste());
    const conversions = { create: jest.fn().mockResolvedValue({ id: 'c' }) };
    await new LeadsService(cfg as never, prisma as never, conversions as never).intake({
      source: 'monsite.com', phone: '8135550142', capturedAt: s,
    });
    const createdAt: Date = prisma.click.upsert.mock.calls[0][0].create.createdAt;
    // Accepté : la visite doit être datée d'août, pas d'aujourd'hui.
    expect(createdAt.getTime()).toBeLessThan(Date.now() - 24 * 3600 * 1000);
  });
});

describe('JURY R4 — D5 : consentText « refusé au-delà de 2000, jamais tronqué » (doc §2)', () => {
  function erreurs(corps: Record<string, unknown>): string[] {
    return validateSync(plainToInstance(IntakeLeadDto, corps), { whitelist: true }).map((e) => e.property);
  }
  it.each([
    ['emoji', 'I agree 😀'.repeat(222)],
    ['sélecteurs de variante', 'x'.repeat(2000) + '️'.repeat(10)],
  ])('%s : accepté ⇒ doit être stocké intact', (_n, texte) => {
    if (erreurs({ phone: '8135550142', consentText: texte }).includes('consentText')) return;
    expect(leadFromConversion({ phone: '8135550142', consent: texte }).consentText).toBe(texte);
  });

  it('le pire corps conforme tient sous 100 ko même échappé (doc §5 « always fits »)', () => {
    const esc = (o: unknown) =>
      JSON.stringify(o).replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    // Tour 23 : les bornes se comptent en unités UTF-16 (un emoji en vaut deux). Le pire corps conforme est donc
    // fait d'emoji à la MOITIÉ de chaque borne — six octets par unité une fois échappé, comme un « é ».
    const e = (n: number) => '😀'.repeat(Math.floor(n / 2));
    const pire = {
      source: 'monsite.com', externalId: e(120), firstName: e(120), lastName: e(120),
      email: e(200), phone: e(40), zip: e(20), state: e(80), consentText: e(2000),
      pageUrl: e(500), ip: e(60), userAgent: e(500), capturedAt: '2026-09-17T14:03:11.000Z', isTest: false,
      answers: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`q${i}`.padEnd(64, 'x'), e(200)])),
    };
    expect(erreurs(pire)).toEqual([]);
    expect(Buffer.byteLength(esc(pire), 'utf8')).toBeLessThan(100 * 1024);
  });
});

describe('JURY R4 — D6 : faux positifs de la liste (IP d’une visite inscrite comme téléphone)', () => {
  it('l’adresse IP d’un clic ne devient pas une empreinte « phone »', () => {
    expect(contactsInAnything({ ipAddress: '203.0.113.195', userAgent: 'Mozilla/5.0' })).toEqual([]);
  });
});

describe('JURY R4 — D7 : rejeu d’un externalId effacé → « stored: true »', () => {
  it('ne prétend pas avoir stocké une personne dont la visite est une pierre tombale', async () => {
    const prisma = porte(liste());
    prisma.lead.findUnique = jest.fn().mockResolvedValue({ id: 'tombe', source: 'erasure' });
    const out = await new LeadsService(cfg as never, prisma as never, { create: jest.fn() } as never).intake({
      source: 'monsite.com', externalId: 'form-42', phone: '4075550199',
    });
    expect(out.stored).toBe(false);
  });
});

describe('tour 23 : ce que les correctifs promettent, chaque règle isolée', () => {
  function erreurs(corps: Record<string, unknown>): string[] {
    return validateSync(plainToInstance(IntakeLeadDto, corps), { whitelist: true }).map((e) => e.property);
  }

  it("la limite de débit passe AVANT la clé : dans l'autre ordre, les essais de clé fausse ne sont pas comptés", () => {
    // Le juré r4 a inversé les deux gardes sans qu'aucun test ne bouge : `toContain` ne dit rien de l'ordre.
    const { LeadsController } = jest.requireActual('../src/leads/leads.controller');
    const { IntakeKeyGuard } = jest.requireActual('../src/leads/intake-key.guard');
    const { ThrottlerGuard } = jest.requireActual('@nestjs/throttler');
    const gardes = Reflect.getMetadata('__guards__', LeadsController.prototype.intake);
    expect(gardes).toEqual([ThrottlerGuard, IntakeKeyGuard]);
  });

  it("capturedAt : une minute d'avance est tolérée, deux ne le sont pas", () => {
    const dans = (ms: number) => new Date(Date.now() + ms).toISOString();
    expect(erreurs({ phone: '8135550142', capturedAt: dans(30_000) })).not.toContain('capturedAt');
    expect(erreurs({ phone: '8135550142', capturedAt: dans(120_000) })).toContain('capturedAt');
  });

  it.each(['2026-08-01T14:03:11', '2026-02-30T00:00:00Z', '2026-08-01', 'hier'])(
    'capturedAt %s : refusé (sans fuseau, impossible, sans heure ou illisible)',
    (s) => expect(erreurs({ phone: '8135550142', capturedAt: s })).toContain('capturedAt'),
  );

  it.each(['2026-08-01T14:03:11Z', '2026-08-01T14:03:11.123+02:00', '2026-08-01T14:03Z'])('capturedAt %s : accepté', (s) =>
    expect(erreurs({ phone: '8135550142', capturedAt: s })).not.toContain('capturedAt'),
  );

  it('une clé se lit par MOTS : `company` et `hotel` ne sont pas des téléphones, `tel` et `customerPhone` si', () => {
    expect(contactsInAnything({ company: '5550142', hotel: '5550142' })).toEqual([]);
    expect(contactsInAnything({ tel: '5550142' })).toEqual([{ phone: '5550142' }]);
    expect(contactsInAnything({ customerPhone: '5550143' })).toEqual([{ phone: '5550143' }]);
  });

  it("une adresse étiquetée et encodée garde son étiquette : `ann+promo%40example.com`", () => {
    expect(contactsInAnything({ note: 'ann+promo%40example.com' })).toEqual(
      expect.arrayContaining([{ email: 'ann+promo@example.com' }]),
    );
  });

  it('« Nom <adresse> » est lu comme l’adresse, et l’extension ne fait pas partie du numéro', () => {
    expect(leadFromConversion({ email: 'Ann Dupont <Ann@Example.com>' }).email).toBe('ann@example.com');
    expect(leadFromConversion({ phone: '813-555-0142 ext. 204' }).phone).toBe('8135550142');
  });

  it("le texte de consentement n'est PAS comparé : il porte souvent le numéro de l'annonceur", async () => {
    // Une personne effacée dont la liste contient ce numéro ne doit pas bloquer tous les leads de ce texte.
    const l = liste({ phone: '8005551212' });
    const conversions = { create: jest.fn().mockResolvedValue({ id: 'c' }) };
    const out = await new LeadsService(cfg as never, porte(l) as never, conversions as never).intake({
      source: 'monsite.com',
      phone: '4075550199',
      consentText: 'I agree to be called by ExampleSite at 800-555-1212.',
    });
    expect(out).toMatchObject({ stored: true });
  });

  it("rejeu sur une visite effacée par deleteOne (erasedAt posé) : refusé aussi", async () => {
    const prisma = porte(liste());
    prisma.lead.findUnique = jest.fn().mockResolvedValue({ id: 'lead-1', source: 'monsite.com', erasedAt: new Date() });
    const out = await new LeadsService(cfg as never, prisma as never, { create: jest.fn() } as never).intake({
      source: 'monsite.com', externalId: 'form-42', phone: '4075550199',
    });
    expect(out).toMatchObject({ stored: false, reason: 'erased_person' });
  });

  it('eraseVisit fait traverser « nothing » quand la ligne de lead ne portait aucun contact', async () => {
    // Le pendant du D1 du juré pour l'autre valeur : sans lui, `commeUneVisite` pouvait ne transmettre que « failed ».
    const vide = {
      id: 'lead-1', clickId: 'c1', campaignId: 'camp-A', isTest: false, createdAt: new Date('2026-07-01T00:00:00Z'),
      phone: null, email: null, firstName: 'Ann', lastName: null, erasedAt: null, purgedAt: null,
    };
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue(vide), findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn(), create: jest.fn(),
      },
      erasedContact: { findFirst: jest.fn().mockResolvedValue({ hash: TEMOIN }), createMany: jest.fn() },
      conversion: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: {
        findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ clickId: 'c1', campaignId: 'camp-A', isTest: false, createdAt: new Date(), rawParams: {} }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn({ lead: { update: jest.fn() } })),
    };
    const out = await new LeadsService(cfg as never, prisma as never, {} as never).eraseVisit('c1');
    expect(out).toMatchObject({ erased: true, suppression: 'nothing' });
  });
});
