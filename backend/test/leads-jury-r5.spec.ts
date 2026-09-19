// JURY R5 (repris comme critère d'acceptation au tour 24) — chaque test ÉCHOUE tant que le défaut est présent (attente = comportement correct).
import { LeadsService } from '../src/leads/leads.service';
import { contactFingerprints, contactsInAnything, declaredContactsIn, withoutContact } from '../src/leads/lead-fields';

const CLE = 'cle-de-test-0123456789abcdef-0123456789';
const TEMOIN = contactFingerprints({ email: 'temoin@liste-de-suppression.invalid' }, CLE)[0].hash;
const cfg = { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE : undefined)) };

/** Efface Ann (deleteOne) et rend les empreintes réellement écrites dans erased_contacts. */
async function effacerAnn(visite: Record<string, unknown>, metadata: Record<string, unknown>): Promise<Set<string>> {
  const ecrites: string[] = [];
  const leadRow = {
    id: 'lead-1', clickId: 'c1', campaignId: 'camp-ext', isTest: false,
    createdAt: new Date('2026-09-01T00:00:00Z'), phone: '8135550142', email: 'ann@example.com',
    firstName: 'Ann', lastName: 'Dupont', erasedAt: null, purgedAt: null,
  };
  const prisma = {
    lead: {
      findUnique: jest.fn().mockResolvedValue(leadRow),
      findMany: jest.fn().mockResolvedValue([{ phone: leadRow.phone, email: leadRow.email }]),
      upsert: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    erasedContact: {
      findFirst: jest.fn().mockResolvedValue({ hash: TEMOIN }),
      createMany: jest.fn().mockImplementation(({ data }: { data: { hash: string }[] }) => {
        ecrites.push(...data.map((d) => d.hash));
        return Promise.resolve({ count: data.length });
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    conversion: {
      findMany: jest.fn().mockResolvedValue([{ metadata, postbackParam1: null, incomingPostbackUrl: null }]),
      update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    click: {
      findMany: jest.fn().mockResolvedValue([{ clickId: 'c1', campaignId: 'camp-ext', isTest: false, createdAt: new Date(), ...visite }]),
      findUnique: jest.fn().mockResolvedValue({ clickId: 'c1', campaignId: 'camp-ext', isTest: false, createdAt: new Date(), rawParams: {} }),
      update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn({ lead: { update: jest.fn() } })),
  };
  const out = await new LeadsService(cfg as never, prisma as never, {} as never).deleteOne('lead-1');
  expect(out.deleted).toBe(true);
  return new Set(ecrites);
}

/** La porte d'entrée, avec une liste de suppression qui contient exactement `connues`. */
function porte(connues: Set<string>) {
  return {
    campaign: { upsert: jest.fn().mockResolvedValue({ id: 'camp-ext' }) },
    click: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue({ isTest: false }) },
    lead: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    erasedContact: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: { kind?: string; hash?: { in: string[] } } }) => {
        if (where?.kind === 'temoin') return Promise.resolve({ hash: TEMOIN });
        return Promise.resolve(where.hash!.in.some((h) => connues.has(h)) ? { hash: 'x' } : null);
      }),
      // Tour 31 : la lecture groupée d'`isErasedPerson` — des lignes déclarées, d'avant les groupes.
      findMany: jest.fn().mockImplementation(({ where }: { where: { hash: { in: string[] } } }) =>
        Promise.resolve(where.hash.in.filter((h) => connues.has(h)).map((hash) => ({ hash, kind: 'phone', groupe: 'avant-groupes' }))),
      ),
      createMany: jest.fn(),
    },
  };
}

describe('R5-D1 — un effacement empreinte des numéros qui ne sont PAS la personne, et bloque d’autres gens', () => {
  const URL_GOOGLE = 'https://monsite.com/auto-quote?gad_source=1&gad_campaignid=21234567890&gclid=Cj0KCQjwxyz';

  it('l’identifiant de campagne Google Ads de l’URL d’atterrissage n’est pas un téléphone', () => {
    expect(contactsInAnything({ referrer: URL_GOOGLE })).toEqual([]);
  });

  it('bout en bout : Ann effacée ⇒ Bob, autre personne venue de la même campagne Google, est refusé', async () => {
    const liste = await effacerAnn({ referrer: URL_GOOGLE }, { page_url: URL_GOOGLE, email: 'ann@example.com' });
    const conversions = { create: jest.fn().mockResolvedValue({ id: 'conv' }) };
    const out = await new LeadsService(cfg as never, porte(liste) as never, conversions as never).intake({
      source: 'monsite.com', externalId: 'form-2', firstName: 'Bob', phone: '(407) 555-0199',
      email: 'bob@example.org', pageUrl: URL_GOOGLE,
    });
    expect(out).toMatchObject({ stored: true });
  });

  it('bout en bout : un créneau de rappel « 09-17-2026 10:00 » bloque tous ceux qui choisissent le même', async () => {
    const liste = await effacerAnn({}, { q7: '09-17-2026 10:00', email: 'ann@example.com' });
    const conversions = { create: jest.fn().mockResolvedValue({ id: 'conv' }) };
    const out = await new LeadsService(cfg as never, porte(liste) as never, conversions as never).intake({
      source: 'monsite.com', externalId: 'form-3', firstName: 'Carl', phone: '3055550123',
      answers: { q7: '09-17-2026 10:00' },
    });
    expect(out).toMatchObject({ stored: true });
  });

  it('un identifiant de campagne Microsoft Ads (9 chiffres) non plus', () => {
    expect(contactsInAnything({ referrer: 'https://monsite.com/?utm_source=bing&utm_campaign=413123456' })).toEqual([]);
  });
});

describe('R5-D2 — contactsInAnything : coût quadratique puis débordement de pile sur une métadonnée publique', () => {
  // `POST /conversions/track` est public (ThrottlerGuard seul) et `metadata` n'a pas de borne sous les 100 ko.
  it('10 ko « a=%2525… » : moins d’une seconde (bloque la boucle d’événements sinon)', () => {
    const t = Date.now();
    contactsInAnything({ m: 'a=%2525'.repeat(1400) });
    expect(Date.now() - t).toBeLessThan(1000);
  }, 120000);

  it('40 ko « a=a=… » : l’inscription ne doit pas lever (sinon suppression « failed »)', () => {
    expect(() => contactsInAnything({ m: 'a='.repeat(20000) })).not.toThrow();
  });
});

describe('R5-D3 — « le même détecteur que le nettoyage » est faux pour les adresses', () => {
  it('ce que le nettoyage retire, l’inscription doit le voir (josé@…)', () => {
    expect(withoutContact({ sub1: 'josé@example.com' }, 'erased')).not.toBeNull();
    expect(contactsInAnything({ sub1: 'josé@example.com' })).toEqual([{ email: 'josé@example.com' }]);
  });
  it('« ann&co@example.com » est empreinté comme « co@example.com »', () => {
    expect(contactsInAnything({ sub1: 'ann&co@example.com' })).toEqual([{ email: 'ann&co@example.com' }]);
  });
});

describe('R5-D4 — deux numéros tirets séparés par une espace survivent au nettoyage ET à l’inscription', () => {
  it('le nettoyage d’effacement les retire', () => {
    // `null` = « rien à retirer » : la valeur est laissée telle quelle sur une visite effacée.
    expect(withoutContact({ sub2: 'Ann 813-555-0142 407-555-0199' }, 'erased')).not.toBeNull();
  });
  it('l’inscription les voit', () => {
    expect(contactsInAnything({ sub2: 'Ann 813-555-0142 407-555-0199' })).toEqual(
      expect.arrayContaining([{ phone: '8135550142' }]),
    );
  });
});


describe('tour 24 : déclaré contre trouvé — la règle elle-même, avec une liste qui connaît le « comment »', () => {
  const empreinte = (c: { phone?: string; email?: string }) => contactFingerprints(c, CLE)[0].hash;

  /** Une liste de suppression qui répond comme Postgres : par empreinte ET par sorte. */
  function listeAvecSortes(lignes: { hash: string; kind: string }[]) {
    return {
      findFirst: jest.fn().mockImplementation(({ where }: { where: { kind?: string | { in: string[] }; hash?: { in: string[] } } }) => {
        if (where?.kind === 'temoin') return Promise.resolve({ hash: TEMOIN });
        const sortes = typeof where.kind === 'object' ? where.kind.in : null;
        const l = lignes.find((x) => where.hash!.in.includes(x.hash) && (!sortes || sortes.includes(x.kind)));
        return Promise.resolve(l ? { hash: l.hash } : null);
      }),
      // Tour 31 : la lecture groupée d'`isErasedPerson`. Des lignes d'avant les groupes (règle du tour 24).
      findMany: jest.fn().mockImplementation(({ where }: { where: { hash: { in: string[] } } }) =>
        Promise.resolve(lignes.filter((x) => where.hash.in.includes(x.hash)).map((x) => ({ ...x, groupe: 'avant-groupes' }))),
      ),
      createMany: jest.fn(),
      updateMany: jest.fn(),
    };
  }
  const envoyer = (liste: ReturnType<typeof listeAvecSortes>, corps: Record<string, unknown>) =>
    new LeadsService(
      cfg as never,
      { ...porte(new Set()), erasedContact: liste } as never,
      { create: jest.fn().mockResolvedValue({ id: 'c' }) } as never,
    ).intake({ source: 'monsite.com', ...corps } as never);

  it('trouvé des deux côtés : PAS de refus (le même nombre dans deux textes ne fait pas une personne)', async () => {
    const liste = listeAvecSortes([{ hash: empreinte({ phone: '8135550142' }), kind: 'phone_texte' }]);
    const out = await envoyer(liste, { firstName: 'Bob', answers: { q3: 'appelez au 813-555-0142 svp' } });
    expect(out).toMatchObject({ stored: true });
  });

  it("déclaré à l'entrée contre trouvé dans la liste : refus", async () => {
    const liste = listeAvecSortes([{ hash: empreinte({ phone: '8135550142' }), kind: 'phone_texte' }]);
    expect(await envoyer(liste, { phone: '(813) 555-0142' })).toMatchObject({ stored: false, reason: 'erased_person' });
  });

  it("trouvé à l'entrée contre déclaré dans la liste : refus", async () => {
    const liste = listeAvecSortes([{ hash: empreinte({ phone: '8135550142' }), kind: 'phone' }]);
    const out = await envoyer(liste, { firstName: 'Ann', answers: { q3: 'appelez au 813-555-0142 svp' } });
    expect(out).toMatchObject({ stored: false, reason: 'erased_person' });
  });

  it('un numéro DÉCLARÉ dans pageUrl (`?tel=`), même court, est comparé — y compris à un « trouvé » de la liste', async () => {
    // Contre une empreinte « trouvée », seule la DÉCLARATION de l'envoi peut refuser : ce décor isole cette lecture.
    const liste = listeAvecSortes([{ hash: empreinte({ phone: '8135550142' }), kind: 'phone_texte' }]);
    const out = await envoyer(liste, { firstName: 'Ann', pageUrl: 'https://monsite.com/merci?tel=813-555-0142' });
    expect(out).toMatchObject({ stored: false, reason: 'erased_person' });
  });

  it("l'effacement inscrit chaque contact avec sa sorte, et le déclaré l'emporte sur le trouvé", async () => {
    const data: { hash: string; kind: string }[] = [];
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'lead-1', clickId: 'c1', campaignId: 'camp-ext', isTest: false, createdAt: new Date('2026-09-01T00:00:00Z'),
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
        createMany: jest.fn().mockImplementation(({ data: d }: { data: { hash: string; kind: string }[] }) => {
          data.push(...d);
          return Promise.resolve({ count: d.length });
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      conversion: {
        findMany: jest.fn().mockResolvedValue([
          // Un événement de CONTACT (formulaire) : c'est lui qui déclare (tour 27 — Prisma rend toujours `eventType`).
          { eventType: 'lead', metadata: { note: 'rappeler 813-555-0142 ou 407-555-0199', contact_email: 'ann@example.com' } },
        ]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ clickId: 'c1', campaignId: 'camp-ext', isTest: false, createdAt: new Date(), rawParams: {} }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn({ lead: { update: jest.fn() } })),
    };
    await new LeadsService(cfg as never, prisma as never, {} as never).deleteOne('lead-1');
    const sorte = new Map(data.map((d) => [d.hash, d.kind]));
    expect(sorte.get(empreinte({ phone: '8135550142' }))).toBe('phone'); // déclaré (ligne de lead), aussi trouvé
    expect(sorte.get(empreinte({ phone: '4075550199' }))).toBe('phone_texte'); // seulement dans un texte
    expect(sorte.get(empreinte({ email: 'ann@example.com' }))).toBe('email'); // sous `contact_email`
    // Tour 32 : plus de « promotion » d'un trouvé d'hier — la clé est le couple (empreinte, groupe), et le déclaré
    // s'inscrit dans le groupe de CET effacement, un seul pour toutes ses lignes.
    expect(prisma.erasedContact.updateMany).not.toHaveBeenCalled();
    const groupes = new Set((data as { kind: string; groupe?: string }[]).filter((d) => d.kind !== 'temoin').map((d) => d.groupe));
    expect(groupes.size).toBe(1);
    expect([...groupes][0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("une adresse citée entre apostrophes est l'adresse, sans l'apostrophe", () => {
    expect(contactsInAnything({ note: "écrire à 'ann@example.com' demain" })).toEqual([{ email: 'ann@example.com' }]);
  });

  it('`tel:` et `mailto:` sont des déclarations ; un numéro dans une phrase ne l’est pas', () => {
    expect(declaredContactsIn({ x: 'tel:8135550142', y: 'mailto:ann@example.com', z: 'au 407-555-0199' })).toEqual([
      { phone: '8135550142' },
      { email: 'ann@example.com' },
    ]);
  });

  it('100 ko hostiles se lisent en moins d’une seconde, sans lever', () => {
    for (const hostile of ['a=%2525'.repeat(14000), 'a='.repeat(50000), '1 '.repeat(50000), '1-'.repeat(50000)]) {
      const t = Date.now();
      expect(() => contactsInAnything({ m: hostile })).not.toThrow();
      // Deux secondes et non une : la suite tourne parfois à côté d'autres charges, et le défaut visé coûtait sept
      // secondes (retour arrière quadratique) — la marge ne le laisse pas passer.
      expect(Date.now() - t).toBeLessThan(2000);
    }
  }, 60000);

  it('un objet imbriqué sur cent mille niveaux ne fait pas déborder la pile', () => {
    // `{"a":` fait cinq octets : un corps public de 100 ko atteint vingt mille niveaux. Cent mille, pour la marge.
    let profond: Record<string, unknown> = { phone: '8135550142' };
    for (let i = 0; i < 100_000; i += 1) profond = { a: profond };
    expect(() => contactsInAnything(profond)).not.toThrow();
  });
});

describe('tour 24 : le consentement se garde mot pour mot', () => {
  it('garde ses retours à la ligne et ses tabulations, et son empreinte ignore l’espacement', () => {
    const { leadFromConversion } = jest.requireActual('../src/leads/lead-fields');
    const texte = 'I agree to be called.\n\tConsent is not a condition of purchase.';
    const lead = leadFromConversion({ consent: texte, phone: '4155550134' });
    expect(lead.consentText).toBe(texte);
    expect(lead.consentHash).toBe(leadFromConversion({ consent: '  I agree to be called. Consent is not a condition of purchase. ', phone: '4155550134' }).consentHash);
  });
});
