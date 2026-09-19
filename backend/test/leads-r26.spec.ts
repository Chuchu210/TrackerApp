// Tour 26 : la méthode change — liste blanche des champs de la personne, bordures par catégorie Unicode, et une
// PROPRIÉTÉ plutôt que des exemples : tout numéro que le nettoyage retire, l'inscription le voit.
import {
  contactFingerprints,
  contactsInAnything,
  declaredContactsIn,
  lireContacts,
  normalizeEmail,
  normalizePhone,
  withoutContact,
} from '../src/leads/lead-fields';

/** Un générateur pseudo-aléatoire à graine : le même jeu à chaque exécution, donc un échec reproductible. */
function graine(n: number) {
  let s = n >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('tour 26 : ce que le nettoyage retire, l’inscription le voit (propriété)', () => {
  const NUMEROS = ['813-555-0142', '(813) 555-0142', '+1 813 555 0142', '8135550142', '407.555.0199'];
  const AVANT = ['Can you call me back?', 'reach me at', 'my cell =', 'Q:', 'tel?', 'rappel ?', '#', '&', 'svp,'];
  const APRES = ['', '= my cell', '?', ' or later', ' & thanks', '#top', ' ok?'];

  it('sur 600 phrases avec « ? », « = », « & », « # », chaque numéro retiré est inscrit', () => {
    const r = graine(26);
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const manques: string[] = [];
    for (let i = 0; i < 600; i += 1) {
      const numero = pick(NUMEROS);
      const phrase = `${pick(AVANT)} ${numero} ${pick(APRES)}`.trim();
      if (withoutContact({ note: phrase }, 'erased') === null) continue; // le nettoyage n'y voit personne : hors propriété
      const attendu = normalizePhone(numero);
      const vus = contactsInAnything({ note: phrase }).map((c) => c.phone);
      if (!vus.includes(attendu!)) manques.push(phrase);
    }
    expect(manques).toEqual([]);
  });

  it('une vraie URL garde sa lecture paramètre par paramètre (gad_campaignid n’est pas un numéro)', () => {
    expect(contactsInAnything({ pageUrl: 'https://x.com/q?gad_campaignid=21234567890&tel=8135550142' })).toEqual([
      { phone: '8135550142' },
    ]);
  });
});

describe('tour 26 : « déclaré » = une liste blanche de champs de la personne', () => {
  it.each(['phone', 'Phone_1', 'phoneNumber', 'customer_phone', 'lead_mobile', 'contactEmail', 'email', 'tel', 'callerId'])(
    '%s est un champ de la personne',
    (cle) => {
      const valeur = /mail/i.test(cle) ? 'ann@example.com' : '813-555-0142';
      expect(declaredContactsIn({ [cle]: valeur })).toHaveLength(1);
    },
  );

  it.each(['transfer_phone', 'carrier_phone', 'vendor_phone', 'business_phone', 'owner_phone', 'from_phone', 'ringba_number', 'support_email', 'company_email'])(
    '%s n’est pas la personne : lu, mais comme « trouvé »',
    (cle) => {
      const valeur = /mail/i.test(cle) ? 'ann@example.com' : '813-555-0142';
      expect(declaredContactsIn({ [cle]: valeur })).toEqual([]);
      expect(contactsInAnything({ [cle]: valeur })).toHaveLength(1);
    },
  );

  it('une query string DANS un champ d’identifiant n’est pas relue (utm_content=a=813…)', () => {
    // Tour 32 : `utm_content` porte ce qu'un outil d'e-mailing y écrit (juré r13) — lu et nettoyé ; `utm_campaign` reste un identifiant.
    expect(contactsInAnything({ utm_campaign: 'a=8135550142&b=4075550199' })).toEqual([]);
  });

  it('les en-têtes `sec-ch-ua*` ne sont jamais lus comme des numéros', () => {
    expect(contactsInAnything({ 'sec-ch-ua-full-version-list': '"Chromium";v="126.0.6478.127"' })).toEqual([]);
  });
});

describe('tour 26 : les bordures d’une adresse, par catégorie', () => {
  it.each(['„ann@example.com“', '•ann@example.com', '「ann@example.com」', '*ann@example.com*', "'ann@example.com'", '​ann@example.com'])(
    '%s → ann@example.com',
    (bordee) => expect(normalizeEmail(bordee)).toBe('ann@example.com'),
  );

  it.each([
    ['_ann@corp.example', '_ann@corp.example'],
    ['~ann@corp.example', '~ann@corp.example'],
    ['{ann}@corp.example', '{ann}@corp.example'],
  ])('%s garde son caractère légal de tête', (entree, attendu) => expect(normalizeEmail(entree)).toBe(attendu));

  it('un caractère invisible AU MILIEU de l’adresse disparaît aussi', () => {
    expect(normalizeEmail('ann​@example.com')).toBe('ann@example.com');
  });

  it('`+ann@x.com` ne devient pas l’empreinte de tout le domaine', () => {
    const cle = 'cle-de-test-0123456789abcdef-0123456789';
    expect(contactFingerprints({ email: '+ann@x.com' }, cle)).not.toEqual(contactFingerprints({ email: '+bob@x.com' }, cle));
  });
});

describe('tour 26 : un troisième niveau d’URL se dit', () => {
  it('une LP dans une URL de postback dans une URL : « pas tout lu »', () => {
    const niveau3 = 'https://lp.example/?p=8135550142';
    const niveau2 = `https://buyer.example/pb?lp=${encodeURIComponent(niveau3)}`;
    const niveau1 = `https://track.example/in?u=${encodeURIComponent(niveau2)}`;
    expect(lireContacts({ incomingPostbackUrl: niveau1 }).complet).toBe(false);
  });
});
