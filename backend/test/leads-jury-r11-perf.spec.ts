import { lireContacts, sanitizeUrlPii, withoutContact } from '../src/leads/lead-fields';

// JURÉ R11 — coût sur entrées hostiles (100 ko), lecture + nettoyage + URL.
const motifs: Record<string, string> = {
  chiffres_espaces: '1 '.repeat(50000),
  plus_chiffres: '+1 '.repeat(33000),
  parentheses: '(1) '.repeat(25000),
  arobases: 'a@'.repeat(50000),
  arobase_domaine: 'a@b.'.repeat(25000),
  points_lettres: 'a.'.repeat(50000),
  pourcent: '%25'.repeat(33000),
  egal: 'a=a&'.repeat(25000),
  url_chemins: 'https://x.co/' + 'a/'.repeat(50000),
  tirets_chiffres: '1-'.repeat(50000),
  zero_zero: '00 '.repeat(33000),
  hash_pipe: '#|'.repeat(50000),
  plus_lettre: 'a+1'.repeat(33000),
  emails_colles: 'ann@x.com'.repeat(11000),
  tel_colles: '8135550142 '.repeat(9000),
};

it('100 ko hostiles : lireContacts, withoutContact, sanitizeUrlPii', () => {
  const lignes: string[] = [];
  for (const [nom, s] of Object.entries(motifs)) {
    let t = Date.now();
    lireContacts({ notes: s });
    const lire = Date.now() - t;
    t = Date.now();
    withoutContact({ memo: s }, 'erased');
    const net = Date.now() - t;
    t = Date.now();
    sanitizeUrlPii(`https://x.co/p?q=${s}`, 'erased');
    const url = Date.now() - t;
    lignes.push(`${nom.padEnd(18)} lire=${lire}ms nettoyer=${net}ms url=${url}ms`);
  }
  if (process.env.FUZZ_RAPPORT) process.stderr.write(`\n${lignes.join('\n')}\n`);
  // Tour 30 : permanent — moins d'une seconde par mesure (le banc r28 promettait deux ; on tient la moitié).
  expect(lignes.filter((l) => /=\d{4,}ms/.test(l))).toEqual([]);
}, 600000);
