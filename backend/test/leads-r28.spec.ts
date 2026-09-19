// Tour 28 : UNE forme fidèle par contact. Un « trouvé » inscrit à l'effacement fait refuser celui qui le DÉCLARE
// ensuite (juré r9) : inscrire des variantes « au cas où » refusait des innocents. Deux propriétés tiennent le tout :
// ce que le nettoyage retire est inscrit (la personne effacée ne revient pas), et rien d'AUTRE ne l'est (un innocent
// n'est pas refusé).
import {
  contactsInAnything,
  declaredContactsIn,
  normalizeEmail,
  normalizePhone,
  withoutContact,
} from '../src/leads/lead-fields';

function graine(n: number) {
  let s = n >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('tour 28 : ce que le nettoyage retire est inscrit — URL suivie d’une phrase, fragments `#/`', () => {
  const PREFIXES = [
    'https://www.zillow.com/homedetails/12-Oak-St is my house. Can you call me?',
    'https://lp.example/#/merci/',
    'https://www.facebook.com/ann.dupont #1 priority:',
    'www.lp.example/?phone=',
    'see lp.example/form?x=1 then call',
    'https://lp.example/?q=a b&gad_campaignid=21234567890 or',
    'Q: https://x.example/a?b=c#d —',
  ];
  const NUMEROS = ['813-555-0142', '(813) 555-0142', '8135550142', '+1 813 555 0142'];

  it('sur 400 textes, chaque numéro retiré par le nettoyage est inscrit', () => {
    const r = graine(28);
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const manques: string[] = [];
    for (let i = 0; i < 400; i += 1) {
      const numero = pick(NUMEROS);
      const texte = `${pick(PREFIXES)} ${numero}`;
      if (withoutContact({ note: texte }, 'erased') === null) continue;
      const vus = contactsInAnything({ note: texte }).map((c) => c.phone);
      if (!vus.includes(normalizePhone(numero)!)) manques.push(texte);
    }
    expect(manques).toEqual([]);
  });

  it('une page à routage par fragment (`#/quote?phone=…`) DÉCLARE son numéro', () => {
    expect(declaredContactsIn({ pageUrl: 'https://lp.example/#/quote?phone=813-555-0142' })).toEqual([{ phone: '8135550142' }]);
  });
});

describe('tour 28 : rien d’AUTRE n’est inscrit (un innocent n’est pas refusé)', () => {
  const ADRESSES = ['ann@example.com', '_ann@corp.example', '~ann@corp.example', 'ann+quotes@gmail.com', "o'brien@example.com", 'josé@example.fr'];
  const AVANT = ['write to', 'mail:', 'Q:', 'contact', 'Please email me instead:'];
  const APRES = ['', ' please', '.', ', thanks', '?'];

  it('sur 600 phrases à une seule adresse, la seule adresse inscrite est celle-là, telle qu’écrite', () => {
    const r = graine(2809);
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const intrus: string[] = [];
    for (let i = 0; i < 600; i += 1) {
      const adresse = pick(ADRESSES);
      const phrase = `${pick(AVANT)} ${adresse}${pick(APRES)}`;
      const vus = contactsInAnything({ note: phrase }).map((c) => c.email).filter(Boolean);
      const attendu = normalizeEmail(adresse);
      if (vus.some((v) => v !== attendu)) intrus.push(`${phrase} → ${vus.join(', ')}`);
    }
    expect(intrus).toEqual([]);
  });

  it('`_ann@corp.example` effacé n’inscrit PAS `ann@corp.example` (la boîte de quelqu’un d’autre)', () => {
    const vus = contactsInAnything({ note: 'contact _ann@corp.example please' }).map((c) => c.email);
    expect(vus).toEqual(['_ann@corp.example']);
  });

  it('`?email=ann+quotes@gmail.com` : c’est Ann, déclarée — jamais `quotes@gmail.com`', () => {
    const tous = contactsInAnything({ pageUrl: 'https://lp.example/merci?email=ann+quotes@gmail.com' }).map((c) => c.email);
    expect(tous).not.toContain('quotes@gmail.com');
    expect(declaredContactsIn({ pageUrl: 'https://lp.example/merci?email=ann+quotes@gmail.com' })).toEqual([
      { email: 'ann+quotes@gmail.com' },
    ]);
  });

  it('dans une URL, le « + » d’un paramètre ordinaire est une espace : `note=write+to+ann@x.com` est Ann, pas `write@x.com`', () => {
    const vus = contactsInAnything({ pageUrl: 'https://lp.example/?note=write+to+ann@x.com' }).map((c) => c.email);
    expect(vus).toEqual(['ann@x.com']);
  });

  it('`work_phone` (le standard de l’entreprise) n’est pas déclaré, comme `business_phone`', () => {
    expect(declaredContactsIn({ work_phone: '813-555-0142', phone_work: '813-555-0142' })).toEqual([]);
  });

  it.each([
    [{ transfer: { phone: '813-555-0142' } }, 0],
    [{ agent: { email: 'ann@example.com' } }, 0],
    [{ lead: { phone: '813-555-0142' } }, 1],
    [{ metadata: { contact: { phone: '813-555-0142' } } }, 1],
    [{ answers: [{ phone: '813-555-0142' }] }, 1],
    [{ buyers: [{ phone: '813-555-0142' }] }, 0],
  ])('%j : %i déclaré(s) — le conteneur dit à qui est le contact', (valeur, n) => {
    expect(declaredContactsIn(valeur)).toHaveLength(n);
  });
});

describe('tour 28 : coût borné', () => {
  it('100 ko hostiles de plus — URL répétées, `www.` en rafale — en moins de deux secondes', () => {
    for (const hostile of ['https://x.example/?a=1&'.repeat(4000), 'www.a.b/ '.repeat(10000), '1-'.repeat(50000), 'a'.repeat(100000) + '='])
    {
      const t = Date.now();
      contactsInAnything({ m: hostile });
      expect(Date.now() - t).toBeLessThan(2000);
    }
  }, 60000);
});
