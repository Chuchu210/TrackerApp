// Tour 29 — ce que le banc « contact planté » a trouvé sur ses balayages LONGS (120 graines × 5 000 cas), gardé ici
// mot pour mot parce qu'aucune graine par défaut ne le rejoue, et les arbitrages P1/P2 écrits dans docs §9 : une
// règle d'arbitrage qui n'est tenue par aucun test se défait au tour suivant sans que rien ne le dise.
import {
  contactsInAnything,
  declaredContactsIn,
  looksPersonal,
  sanitizeUrlPii,
  withoutContact,
} from '../src/leads/lead-fields';

const telephones = (v: unknown) => contactsInAnything(v).map((c) => c.phone).filter(Boolean);
const adresses = (v: unknown) => contactsInAnything(v).map((c) => c.email).filter(Boolean);

describe('tour 29 — un « + » collé à ce qui précède est l’espace d’une query string, pas un indicatif', () => {
  it.each([
    // graine 4
    ['Q: www.lp.example/?fbclid=IwARG9CsfUDSwEp3fsdPumQz8M0UfSWHVIGMSHn5bYct&t=1829696202663&ts=1609435592&v=2&s2=+1+480+672+4873 11094', '4806724873'],
    // graine 15
    ['lp partner.example/?utm_source=fb&utm_term=car+insurance#/quote?phone=(534)+801-5359 2018 Honda Civic', '5348015359'],
    // graine 62
    ['lp quotes.insure-now.com/a/b-3?sub5=fb&price=461.04#phone_number=3104094573+extension+1234 18700', '3104094573'],
  ])('%s : la personne, et elle seule', (texte, numero) => {
    expect(telephones({ note: texte })).toEqual([numero]);
    expect(JSON.stringify(withoutContact({ note: texte }, 'erased'))).not.toContain(numero.slice(3));
  });
});

describe('tour 29 — « 00 » collé à une lettre est un morceau d’identifiant, pas un indicatif', () => {
  // Graine 29 du banc, gardée mot pour mot (le générateur du tour 30 ne la rejoue plus) : un UUID dont un bloc
  // commence par « 00 » se lisait comme un numéro composé depuis l'étranger.
  it('`cid=b0015219-3390-4e59-…` : rien n’est inscrit', () => {
    const url = 'https://trk.example/r?cid=b0015219-3390-4e59-ab94-a6a9c75e17ee&url=partner.example%2Fthank-you';
    expect(contactsInAnything({ landing_page: url })).toEqual([]);
    expect(contactsInAnything({ note: 'ref b0015219-3390-4e59-ab94-a6a9c75e17ee' })).toEqual([]);
  });
});

describe('tour 29 — le nettoyage lit aussi profond que la liste', () => {
  it('`ann+quotes%40gmail.com` (seule l’arobase encodée) : plus rien d’Ann après l’effacement', () => {
    const reste = JSON.stringify(withoutContact({ landing: 'https://lp.example/?sub2=ann+quotes%40gmail.com&zip=33610' }, 'erased'));
    expect(reste).not.toMatch(/ann|quotes/);
  });

  it('un « + » et un encodage ne font pas une personne : `spring+sale%202026` reste lisible', () => {
    expect(looksPersonal('spring+sale%202026')).toBe(false);
  });

  it('encodée TROIS fois, la valeur ressort encodée trois fois : deux décodages ne rendent pas `&cid=`', () => {
    const out = sanitizeUrlPii('https://t.io/pb?cid=c1&p1=call%2525208135550142%252526cid%25253Dhacked&payout=1');
    const valeur = out.split('&p1=')[1].split('&payout')[0];
    expect(decodeURIComponent(decodeURIComponent(valeur))).not.toContain('&cid=');
    expect(out).not.toContain('8135550142');
  });

  it('à l’effacement, le chemin d’une URL de postback aussi ; à la rétention, jamais (l’identifiant de clic du réseau)', () => {
    const url = 'https://net.example/pb/8135550142?cid=1&payout=2';
    expect(sanitizeUrlPii(url, 'erased')).toBe('https://net.example/pb/***?cid=1&payout=2');
    expect(sanitizeUrlPii(url, 'purged')).toBe(url);
  });
});

describe('tour 29 — la forme lue', () => {
  it('`;` sépare des paramètres : `?utm_source=fb;phone=…` DÉCLARE le numéro', () => {
    expect(declaredContactsIn({ pageUrl: 'https://lp.example/?utm_source=fb;phone=8135550142' })).toEqual([{ phone: '8135550142' }]);
  });

  it('un numéro étranger n’est pas redécoupé en numéro nord-américain', () => {
    expect(telephones({ note: 'Call +33 612 345 6789 tonight' })).toEqual(['336123456789']);
  });

  it('une parenthèse orpheline appartient au texte : « (Unit 3 813-555-0142) »', () => {
    expect(telephones({ note: '(Unit 3 813-555-0142)' })).toEqual(['8135550142']);
  });

  it.each([
    [{ fields: [{ key: 'phone', value: '813-555-0142' }] }, [{ phone: '8135550142' }]],
    [{ field_data: [{ name: 'email', values: ['ann@example.com'] }] }, [{ email: 'ann@example.com' }]],
    [{ transfer: [{ name: 'phone', values: ['813-555-0142'] }] }, []],
  ])('%j : un champ décrit par ses propres clés est déclaré sous le nom qu’il porte', (valeur, declares) => {
    expect(declaredContactsIn(valeur)).toEqual(declares);
  });
});

describe('tour 29 — les arbitrages P1/P2 de docs §9, tenus', () => {
  it('une suite nue de dix chiffres est lue comme un numéro, quel que soit le mot devant — trouvée, jamais déclarée', () => {
    expect(contactsInAnything({ note: 'order 4500012345' })).toEqual([{ phone: '4500012345' }]);
    expect(declaredContactsIn({ note: 'order 4500012345' })).toEqual([]);
  });

  it('des nombres juxtaposés sans forme de numéro ne sont personne ; un national étranger sans « 0 » ni « + » non plus', () => {
    for (const t of ['2024 24082', '33610 13601', '$887.99 2015 Honda', '33610. 52150', '7911 123456']) {
      expect([t, telephones({ note: t })]).toEqual([t, []]);
    }
    expect(telephones({ note: '07911 123456' })).toEqual(['07911123456']);
  });

  it('`#`, `|` et un `&` après des chiffres séparent ; `ann&co@` reste entière', () => {
    expect(adresses({ note: 'see #ann@x.com' })).toEqual(['ann@x.com']);
    expect(adresses({ note: 'utm_content=spring|ann@x.com' })).toEqual(['ann@x.com']);
    expect(adresses({ note: 'zip=33610&ann@x.com' })).toEqual(['ann@x.com']);
    expect(adresses({ note: 'write to ann&co@x.com' })).toEqual(['ann&co@x.com']);
  });

  it('une phrase reprise sans espace est coupée au mot Capitalisé ; en minuscules, c’est un domaine', () => {
    expect(adresses({ note: 'email me at ann@gmail.com.Thanks' })).toEqual(['ann@gmail.com']);
    expect(adresses({ note: 'email me at ann@gmail.com.thanks' })).toEqual(['ann@gmail.com.thanks']);
  });

  it('dans une URL, une valeur qui est UNE adresse garde son « + » (une étiquette) ; deux « + », c’est une phrase', () => {
    expect(adresses({ pageUrl: 'https://lp.example/?note=contact+ann@x.com' })).toEqual(['contact+ann@x.com']);
    expect(adresses({ pageUrl: 'https://lp.example/?note=write+to+ann@x.com' })).toEqual(['ann@x.com']);
  });

  it('un début légal seul fait partie de l’adresse ; une enveloppe ne compte que si elle se referme', () => {
    expect(adresses({ note: "mail: 'ann@x.com" })).toEqual(["'ann@x.com"]);
    expect(adresses({ note: "mail: 'ann@x.com'" })).toEqual(['ann@x.com']);
    expect(adresses({ note: '**_ann@x.com**' })).toEqual(['_ann@x.com']);
  });
});
