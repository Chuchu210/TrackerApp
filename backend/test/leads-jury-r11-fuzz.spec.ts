import { lireContacts, normalizePhone, sanitizeUrlPii, withoutContact } from '../src/leads/lead-fields';

// JURÉ R11 — fuzzer indépendant, contextes NON couverts par test/fuzz-personne.gen.ts : CSV, HTML, SMS, FR/ES,
// JSON échappé, numéros en lettres, internationaux +44/+33/+52/+49/+91, « Nom <adresse> » dans un long texte,
// liens markdown, tel:;ext=, notes longues, URL avec &amp;.
// Oracle : P1 (la personne est lue, déclarée si le contexte déclare), P2 (rien d'autre que la personne et les tiers
// plantés ; un tiers jamais déclaré), P3 (withoutContact('erased') / sanitizeUrlPii('erased') : relue, la personne
// a disparu, et ni son numéro formaté ni son adresse ne restent en clair).

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Personne = { phone?: { txt: string; attendu: string; famille: string }; email?: { txt: string; attendu: string } };
type Cas = { contexte: string; payload: Record<string, unknown>; url?: string; declare: boolean; p: Personne; tiers: string[] };

function gen(seed: number) {
  const r = rng(seed);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)];
  const d = (n: number) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');
  const d29 = () => String(2 + Math.floor(r() * 8));
  const nanp = () => {
    const a = d29() + d(2);
    const e = d29() + d(2);
    const l = d(4);
    return { a, e, l, n: a + e + l };
  };
  const usPhone = () => {
    const { a, e, l, n } = nanp();
    const fmt = pick([
      `(${a}) ${e}-${l}`, `${a}-${e}-${l}`, `${a}.${e}.${l}`, `${a}${e}${l}`, `+1 ${a} ${e} ${l}`, `+1-${a}-${e}-${l}`,
      `1 (${a}) ${e}-${l}`, `+1${a}${e}${l}`, `${a} ${e} ${l}`, `(${a})${e}-${l}`, `1-${a}-${e}-${l}`, `+1 (${a}) ${e}-${l}`,
    ]);
    return { txt: fmt, attendu: n, famille: 'us' };
  };
  const foreignPhone = () => {
    const c = pick(['uk', 'uk0', 'fr', 'fr0', 'mx', 'mx1', 'de', 'in', 'ph', 'uk00']);
    const x = d(8);
    switch (c) {
      case 'uk': return { txt: `+44 7${x.slice(0, 3)} ${d(6)}`, attendu: '', famille: c };
      case 'uk0': { const m = d(3), s = d(6); return { txt: `+44 (0)7${m} ${s}`, attendu: `447${m}${s}`, famille: c }; }
      case 'uk00': { const m = d(3), s = d(6); return { txt: `0044 7${m} ${s}`, attendu: `447${m}${s}`, famille: c }; }
      case 'fr': return { txt: `+33 6 ${x.slice(0, 2)} ${x.slice(2, 4)} ${x.slice(4, 6)} ${x.slice(6, 8)}`, attendu: '', famille: c };
      case 'fr0': return { txt: `+33 (0)6 ${x.slice(0, 2)} ${x.slice(2, 4)} ${x.slice(4, 6)} ${x.slice(6, 8)}`, attendu: `336${x}`, famille: c };
      case 'mx': return { txt: `+52 55 ${x.slice(0, 4)} ${x.slice(4)}`, attendu: '', famille: c };
      case 'mx1': return { txt: `+52 1 55 ${x.slice(0, 4)} ${x.slice(4)}`, attendu: '', famille: c };
      case 'de': return { txt: `+49 30 ${d(7)}`, attendu: '', famille: c };
      case 'in': return { txt: `+91 9${d(4)} ${d(5)}`, attendu: '', famille: c };
      default: return { txt: `+63 917 ${d(3)} ${d(4)}`, attendu: '', famille: c };
    }
  };
  const phone = () => {
    const p = r() < 0.75 ? usPhone() : foreignPhone();
    return { ...p, attendu: p.attendu || (normalizePhone(p.txt) as string) };
  };
  const email = () => {
    const prenoms = ['ann', 'jose', 'maria', 'kevin', 'lee', 'o.brien', 'j_smith', 'mary-ann', 'bob77', 'nguyen.t'];
    const doms = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.fr', 'orange.fr', 'prodigy.net.mx', 'icloud.com', 'comcast.net'];
    const local = pick(prenoms) + (r() < 0.5 ? String(Math.floor(r() * 999)) : '');
    const tag = r() < 0.1 ? '+quotes' : '';
    const casse = r() < 0.2 ? (s: string) => s.toUpperCase() : (s: string) => s;
    const dom = pick(doms);
    const txt = casse(`${local}${tag}@${dom}`);
    return { txt, attendu: `${local}${tag}@${dom}`.toLowerCase() };
  };
  const decoys = () =>
    pick([
      '09/17/2026', '2026-09-17', '10:30am', 'zip 33610', '33610-1234', '$1,234.56', '$89/mo', '2019 Honda Civic', '2 vehicles',
      'VIN 1HGCM82633A004352', 'ORD-2026-0001234', 'IP 192.168.1.10', 'v2.3.4', '1-800-CALL-NOW', '15%', "5'11\"", '150 lbs',
      'DOB 04/12/1985', 'credit 720', '9-5', '10:00-12:00', 'apt 4B', '123 Main St', 'policy AB-99812', 'id 3f2b9c1e-8d7a-4b1f-9c2e-1a2b3c4d5e6f',
    ]);
  const tiersPhone = () => { const { a, e, l, n } = nanp(); return { txt: `${a}-${e}-${l}`, n }; };

  return function* cas(nb: number): Generator<Cas> {
    for (let i = 0; i < nb; i += 1) {
      const p: Personne = {};
      if (r() < 0.8) p.phone = phone();
      if (!p.phone || r() < 0.6) p.email = email();
      const P = p.phone?.txt ?? '';
      const E = p.email?.txt ?? '';
      const tiers: string[] = [];
      const tp = r() < 0.3 ? tiersPhone() : null;
      if (tp) tiers.push(tp.n);
      const te = r() < 0.2 ? 'support@partner-insure.example' : null;
      if (te) tiers.push(te);
      const extra = [decoys(), decoys()].join(r() < 0.5 ? ', ' : ' ; ');
      const tiersTxt = [tp ? `agent Bob ${tp.txt}` : '', te ? `questions: ${te}` : ''].filter(Boolean).join(', ');
      const ctx = pick(['csv', 'html', 'sms', 'fr', 'es', 'json', 'lettres', 'angle', 'markdown', 'telext', 'long', 'url_amp', 'url_md', 'meta_fields']);
      const payload: Record<string, unknown> = {};
      let url: string | undefined;
      let declare = false;
      switch (ctx) {
        case 'csv': {
          const sep = pick([',', ';', '\t', '|']);
          const q = r() < 0.5 ? '"' : '';
          const cells = ['Ann', 'Dupont', P, E, '33610', '09/17/2026', tiersTxt].filter(Boolean).map((c) => `${q}${c}${q}`);
          payload.export_row = cells.join(sep) + (r() < 0.5 ? `${sep}${q}${extra}${q}` : '');
          break;
        }
        case 'html': {
          const e164 = p.phone ? `+${p.phone.famille === 'us' ? '1' : ''}${p.phone.famille === 'us' ? p.phone.attendu : p.phone.attendu}` : '';
          payload.notes_html = [
            '<div class="lead"><b>Name:</b>&nbsp;Ann',
            P ? `<br><b>Phone:</b> <a href="tel:${e164}">${P}</a>` : '',
            E ? `<br>Email: <a href="mailto:${E}?subject=Quote%20request">${E}</a>` : '',
            `<span data-id="4521" style="width:100px">${extra}</span>`,
            tiersTxt ? `<p>${tiersTxt}</p>` : '',
            '</div>',
          ].join('');
          break;
        }
        case 'sms': {
          const t = pick([
            `hey its ann txt me ${P} ${E ? 'or ' + E : ''} thx!!`,
            `my # is ${P} ${E}`.trim(),
            `ph:${P || 'n/a'} em:${E || 'n/a'} ${extra}`,
            `c u at 5 ok? ${P} 😀 ${E}`,
            `pls call b4 6pm ${P}. ${E} ${tiersTxt}`,
          ]);
          payload.message = t;
          break;
        }
        case 'fr':
          payload.commentaire = `Bonjour, rappelez-moi au ${P || '—'} après 18h, mon courriel : « ${E || 'aucun'} ». ${extra}. ${tiersTxt}`;
          break;
        case 'es':
          payload.comentario = `Hola, llámame al ${P || '—'} por favor; correo: ${E || 'ninguno'}. ${extra} ${tiersTxt}`;
          break;
        case 'json': {
          const obj = { nom: 'José Núñez', tel: P || undefined, mail: E || undefined, note: extra, agent: tiersTxt || undefined };
          // ensure_ascii à la Python : seuls les caractères non ASCII sont échappés.
          payload.raw_json = JSON.stringify(obj).replace(/[-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
          break;
        }
        case 'lettres':
          payload.notes = `Saw ad: call 1-800-CALL-NOW / 1-888-GET-QUOTE. Me: ${P} ${E} ${extra} ${tiersTxt}`;
          break;
        case 'angle':
          payload.transcript = `${'Lorem ipsum dolor sit amet. '.repeat(3)}From: Ann Dupont <${E || 'x'}> Sent: Monday, September 14, 2026 10:32 AM Subject: quote ${P ? 'cell ' + P : ''} ${extra} ${tiersTxt}`;
          if (!E) payload.transcript = String(payload.transcript).replace('<x>', '');
          break;
        case 'markdown': {
          const e164 = p.phone ? `+${p.phone.famille === 'us' ? '1' : ''}${p.phone.attendu}` : '';
          payload.notes_md = `**Contact** ${E ? `[${pick(['Email me', E])}](mailto:${E})` : ''} ${P ? `[call](tel:${e164}) ${P}` : ''} - ${extra} ${tiersTxt}`;
          break;
        }
        case 'telext': {
          if (!p.phone || p.phone.famille !== 'us') { payload.x = extra; p.phone = undefined; if (!p.email) continue; payload.link = `mailto:${E}`; declare = true; break; }
          const n = p.phone.attendu;
          payload.link = pick([`tel:+1-${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)};ext=${d(2)}`, `tel:+1${n};ext=${d(3)}`, `tel:${n};phone-context=+1`]);
          p.email = undefined;
          declare = true;
          break;
        }
        case 'long': {
          const bourre = Array.from({ length: 40 }, () => `${pick(['The', 'Quote', 'Driver', 'Policy', 'Renewal'])} ${decoys()} ${pick(['ok.', 'noted;', 'see file', '—'])}`).join(' ');
          payload.long_notes = `${bourre} Customer says reach ${P} ${E}. ${tiersTxt} ${bourre}`;
          break;
        }
        case 'url_amp': {
          const params = [`ref=sms`, P ? `phone=${encodeURIComponent(P)}` : '', E ? `email=${encodeURIComponent(E)}` : ''].filter(Boolean);
          url = `https://quotes.partner.example/thanks?${params.join('&amp;')}`;
          declare = true;
          break;
        }
        case 'url_md': {
          url = `https://quotes.partner.example/thanks?msg=${encodeURIComponent(`Call me ${P} or ${E}`)}&utm_source=sms`;
          break;
        }
        case 'meta_fields': {
          payload.field_data = [
            ...(P ? [{ name: pick(['phone_number', 'Phone Number', 'phone', 'telefono', 'mobile_phone']), values: [P] }] : []),
            ...(E ? [{ name: pick(['email', 'Email', 'correo_electronico', 'e-mail']), values: [E] }] : []),
            { name: 'when_to_call', values: [extra] },
            ...(tp ? [{ name: 'agent_phone', values: [tp.txt] }] : []),
          ];
          declare = true;
          break;
        }
      }
      if (url) payload.pageUrl = url;
      yield { contexte: ctx, payload, url, declare, p, tiers };
    }
  };
}

type Viol = { k: string; ctx: string; famille: string; detail: string };

function juger(c: Cas): Viol[] {
  const out: Viol[] = [];
  const fam = c.p.phone?.famille ?? 'email';
  const push = (k: string, detail: string) => out.push({ k, ctx: c.contexte, famille: fam, detail });
  const lu = lireContacts(c.payload);
  const has = (l: { phone?: string; email?: string }[], x: { phone?: string; email?: string }) =>
    l.some((y) => (x.phone ? y.phone === x.phone : y.email === x.email));
  const cible: { phone?: string; email?: string }[] = [];
  if (c.p.phone) cible.push({ phone: c.p.phone.attendu });
  if (c.p.email) cible.push({ email: c.p.email.attendu });
  for (const x of cible) {
    if (!has(lu.tous, x)) push('P1', `${JSON.stringify(x)} absent ← ${JSON.stringify(c.payload).slice(0, 300)} ⇒ ${JSON.stringify(lu.tous)}`);
    else if (c.declare && !has(lu.declares, x)) push('P1-declare', `${JSON.stringify(x)} non déclaré ← ${JSON.stringify(c.payload).slice(0, 300)}`);
  }
  for (const y of lu.tous) {
    const estPersonne = has(cible, y);
    const estTiers = c.tiers.includes(y.phone ?? y.email ?? '');
    if (!estPersonne && !estTiers) push('P2', `inconnu ${JSON.stringify(y)} ← ${JSON.stringify(c.payload).slice(0, 300)}`);
  }
  for (const y of lu.declares) {
    if (c.tiers.includes(y.phone ?? y.email ?? '')) push('P2-tiers-declare', `${JSON.stringify(y)} ← ${JSON.stringify(c.payload).slice(0, 300)}`);
  }
  // P3 — effacement
  const nettoye = withoutContact(c.payload, 'erased') ?? c.payload;
  const relu = lireContacts(nettoye).tous;
  const texte = JSON.stringify(nettoye).toLowerCase();
  for (const x of cible) {
    if (has(relu, x)) push('P3', `relu ${JSON.stringify(x)} dans ${JSON.stringify(nettoye).slice(0, 300)}`);
  }
  if (c.p.email && texte.includes(c.p.email.attendu.split('+')[0].split('@')[0] + '@')) push('P3-clair', `adresse en clair ${texte.slice(0, 300)}`);
  if (c.p.phone && texte.includes(c.p.phone.txt.toLowerCase())) push('P3-clair', `numéro en clair ${texte.slice(0, 300)}`);
  if (c.url) {
    const s = sanitizeUrlPii(c.url, 'erased');
    const r = lireContacts({ u: s }).tous;
    for (const x of cible) if (has(r, x)) push('P3-url', `${c.url} → ${s}`);
  }
  return out;
}

describe('JURÉ R11 — fuzzer indépendant (contextes non couverts)', () => {
  const N = Number(process.env.JURY_N ?? 3000);
  const SEEDS = (process.env.JURY_SEEDS ?? '11,22,33').split(',').map(Number);
  it(`${N} cas × ${SEEDS.length} graines : P1/P2/P3`, () => {
    const tous: Viol[] = [];
    let total = 0;
    const t0 = Date.now();
    for (const s of SEEDS) {
      for (const c of gen(s)(N)) {
        total += 1;
        tous.push(...juger(c));
      }
    }
    const ms = Date.now() - t0;
    const parCle = new Map<string, number>();
    for (const v of tous) parCle.set(`${v.k} | ${v.ctx} | ${v.famille}`, (parCle.get(`${v.k} | ${v.ctx} | ${v.famille}`) ?? 0) + 1);
    const exemples = new Map<string, string>();
    for (const v of tous) if (!exemples.has(`${v.k}|${v.ctx}|${v.famille}`)) exemples.set(`${v.k}|${v.ctx}|${v.famille}`, v.detail);
    if (tous.length || process.env.FUZZ_RAPPORT) process.stderr.write(
      `
JURY cas=${total} violations=${tous.length} ms=${ms}\n` +
        [...parCle.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}\t${k}`).join('\n') +
        '\n--- exemples ---\n' +
        [...exemples.entries()].map(([k, e]) => `${k}: ${e}`).join('\n'),
    );
    expect(total).toBeGreaterThanOrEqual(8900);
    expect(tous.length).toBe(0);
  }, 600000);
});
