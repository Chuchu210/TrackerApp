# Lead intake API — send leads captured on another website

**Endpoint:** `POST https://track.nexoquote.com/api/leads/intake`
**Auth:** `x-api-key: <your key>` — one key per site, issued by us
**Body:** JSON, UTF-8
**Who calls it:** your **server**, never the browser

One call stores one person. The tracker creates the visit that a lead normally comes from, then runs the lead
through the same path as leads captured on our own pages, so everything built behind it applies with no extra
work on your side: de-duplication, consent evidence, automatic retention, erasure on request, exports,
reporting.

---

## 1. What you need from us before you start

| Item | Example | Note |
|---|---|---|
| Site name | `monsite.com` | Fixed by your key. It is how your leads are labelled in our reports. |
| API key | `x-api-key` header value | One key per site. Do not share it between sites — a key is revoked per site. |

Ask us for these. If the endpoint answers `401` on every call, the key is either wrong or not deployed on our
side yet — tell us, we can see it in our logs immediately.

**The key is a server secret.** It must never appear in a page, in front-end JavaScript, in a mobile app, in a
public repository, or in a query string. Anyone holding it can post leads as your site. If it leaks, tell us and
we revoke that one key; the other sites keep working.

---

## 2. The request

```http
POST /api/leads/intake HTTP/1.1
Host: track.nexoquote.com
Content-Type: application/json
x-api-key: <your key>
```

### Body fields

| Field | Type | Required | Max | What it is |
|---|---|---|---|---|
| `externalId` | string | **strongly recommended** | 120 | Your own id for this submission. It makes the call **replayable**: the same id twice stores one person, not two. |
| `firstName` | string | one contact field required | 120 | Stored clipped to 100 characters. |
| `lastName` | string | ″ | 120 | Stored clipped to 100. |
| `email` | string | ″ | 200 | Lower-cased. `Ann Dupont <ann@example.com>` is read as `ann@example.com`. Must look like an address, or it is dropped. |
| `phone` | string | ″ | 40 | Any format: `(813) 555-0142`, `813-555-0142`, `+1 813 555 0142`. Stored as digits; a US leading `1` is removed, and a trailing extension (`x204`, `ext. 204`) is dropped. Must end up with 7–15 digits. |
| `country` | string | no | 2 | The person's country, ISO 3166 two letters (`FR`, `GB`, `DE`, `US`). It tells us how to read a `phone` written **without** its country code (`0612345678` is `+33 6 12 34 56 78` in France). Leave it out and your site's country (set on our side with your key) applies; neither, and the number is kept as written. We never guess it. See §9. |
| `zip` | string | no | 20 | Stored clipped to 10. |
| `state` | string | no | 80 | Stored clipped to 40. |
| `answers` | object | no | — | Quiz/form answers. See §4. |
| `consentText` | string | no, but **send it** | 2000 | The consent wording **exactly as displayed** to the person. Over 2000 characters the call is **refused** (400) rather than silently truncated — this is the one field whose whole point is to be verbatim. See §3. |
| `pageUrl` | string | no | 500 | The page the form was on. |
| `ip` | string | no | 60 | The visitor's IP, as your server saw it. |
| `userAgent` | string | no | 500 | The visitor's browser user-agent. Stored clipped to 400. |
| `capturedAt` | string | no | — | Extended ISO 8601 **with a time and a timezone** (`2026-09-17T14:03:11Z`, `2026-09-17T16:03:11+02:00`), when **the person submitted** — not when you send it. It dates the visit. Defaults to now. Refused with `400`: the basic form (`20260917T140311Z`), week or ordinal dates, a date without time or timezone, an impossible date (`2026-02-30…`), and a date more than one minute **in the future** (a future date would escape our retention forever). The consent timestamp is the time we **received** the lead. |
| `isTest` | boolean | no | — | `true` while you wire the integration. See §7. |
| `source` | string | no | 120 | Only if you want to be explicit. It must match your key's site, or the call is refused with `403`. Leave it out and your key decides. |

**Max is counted in UTF-16 code units** — what JavaScript's `.length` returns, and what we store: an emoji counts
as 2. A value over its **Max** is refused with `400`. A few fields are then **stored** shorter than their Max, as
the table says (`firstName`/`lastName` 100, `zip` 10, `state` 40, `userAgent` 400); `consentText` and the
`answers` values are stored whole.

**At least one of `firstName`, `lastName`, `email`, `phone` must survive normalisation.** A `phone` of
`"ask on callback"` and nothing else is refused with `400` — we would rather tell you than store a row nobody can
ever call.

Unknown top-level fields are ignored, not refused. Put everything else in `answers`.

### Minimal call

```bash
curl -sS -X POST https://track.nexoquote.com/api/leads/intake \
  -H "x-api-key: $INTAKE_KEY" \
  -H "content-type: application/json" \
  -d '{
    "externalId": "form-88213",
    "firstName": "Ann",
    "lastName": "Dupont",
    "phone": "(813) 555-0142",
    "email": "ann@example.com",
    "zip": "33610",
    "state": "FL",
    "consentText": "By clicking Get my quote I agree to be contacted at (813) 555-0142 by ExampleSite and its partners, including by automated means. Consent is not a condition of purchase.",
    "pageUrl": "https://monsite.com/auto-quote",
    "capturedAt": "2026-09-17T14:03:11.000Z",
    "answers": { "q1": "2 vehicles", "q2": "currently insured", "insured": "yes" }
  }'
```

---

## 3. Consent — send the text, not a checkbox

`consentText` is the **wording the person actually saw**, copied verbatim, including the phone number and the
brand names in it. We store it, hash it, and timestamp it. It is the only thing that can show, later, that
calling this person was allowed.

Do **not** send `"yes"`, `"true"`, `"accepted"` or the id of a checkbox. If your page shows different wording in
different variants or languages, send the variant that this person saw.

---

## 4. `answers`

A **flat** object: each value is a string, a number or a boolean — never an object or a list. Two kinds of keys
reach the lead record and our reports:

- `q1` … `q99` — numbered questions, in your form's order;
- `insured`, `vehicles`, `homeowner` — named answers we already report on.

Each value is stored clipped to 200 characters. Other keys are kept with the raw event but nothing reads them, so
prefer the numbered form.

**Reserved names are ignored inside `answers`**, including their aliases: `firstName`, `first_name`, `name`,
`lastName`, `last_name`, `email`, `phone`, `zip`, `zipCode`, `postal_code`, `state`, `source`, `consent`,
`consentText`, `pageUrl`, `page_url`. Sending `answers.phone` will not overwrite the real phone, and
`answers.consentText` will not become the consent evidence — they are dropped. Put "best time to call" style
questions in `q…` keys.

**Limits:** at most **50** answers; each name is 1–64 characters from `A–Z a–z 0–9 _`; each value is at most
**200** characters, counted as above (that is what we keep anyway). A nested value, a longer value or an exotic name is refused with
`400`. These limits are set so that the largest allowed body stays under our **100 KB** request limit **even if
your JSON library escapes every non-ASCII character as `\uXXXX`** — the default of Python's `json.dumps` and PHP's
`json_encode`.

`fbc`, `fbp`, `_fbc`, `_fbp` and `fbclid` are also ignored inside `answers`: they feed our own ad attribution.

---

## 5. Responses

A stored lead returns **HTTP 201**:

```json
{ "stored": true, "clickId": "ext_monsite.com_form-88213", "campaignId": "b3c1…" }
```

On a replay of the same `externalId`, the same shape comes back with `"replay": true`.

`clickId` is the id of the visit we created. Keep it with your record — it is the id we will both use when
talking about this person (a correction, an erasure request, a payout question).

A lead the tracker deliberately **did not** store also returns **201**, with `stored: false` and a reason:

| `reason` | Meaning | What you should do |
|---|---|---|
| `test_lead` | `isTest: true`, or the first/last name or the e-mail local part contains `test`, `fake`, `demo` or `qa` **as a whole word** (`Demonte` is fine, `demo.user@` is not), or an `@hipto.com` address. **`lead@hipto.com` is exempt from the whole check**, names included. | Expected while testing. If a **real** person trips it, tell us. |
| `erased_person` | This person asked us to erase their data. We recognise them by a keyed fingerprint of their phone or e-mail, so a **new `externalId` does not bring them back**. Also returned when you replay the `externalId` of a lead that has since been erased. See the limits in §9. | Do not retry, and stop sending this person. Nothing is stored — no visit, no campaign. |
| `external_id_used_for_test` | This `externalId` was first sent with `isTest: true`. A real lead cannot reuse a test visit — it would be stored flagged as a test, invisible in our reports. | Send the real lead with a **new** `externalId`. |
| `outside_attribution_window` | `capturedAt` is more than a year old. | Check your `capturedAt`; do not backfill older than that without telling us. |

Errors:

| Status | Meaning |
|---|---|
| `400` | The body is malformed, no usable contact, or a field is over its maximum. The message says which. |
| `401` | Unknown or missing `x-api-key`. |
| `403` | The `source` in your body is not the site your key is for. |
| `413` | Body over 100 KB. Staying within the documented field limits always fits, whether or not your library escapes non-ASCII characters. |
| `503` | Our suppression list is not configured — we refuse rather than risk re-creating an erased person. Retry later with the same `externalId`. |
| `429` | Rate limit — see §6. |
| `5xx` | Our side. Retry with backoff; your `externalId` makes that safe. |

A `404` means the visit we had just created could not be found when the lead was stored — a race on our side.
Treat it like a `5xx`: retry with the same `externalId`.

---

## 6. Retries, duplicates and rate limit

- **Always send `externalId`.** With it, a retry after a timeout is free: the same id resolves to the same
  visit, and the person is stored once. Without it, every call creates a new visit and a retry duplicates
  the person.
- A replay of an `externalId` that already produced a person is a **no-op**: it returns
  `{"stored": true, "replay": true, ...}` (or `stored: false, reason: "erased_person"` if that person was erased
  since) and changes nothing — the consent text in particular is never
  rewritten by a later send. To correct a field, tell us instead.
- **Rate limit: 120 requests per minute per IP.** On `429`, back off (e.g. 1 s, 2 s, 4 s, 8 s, capped at 60 s) and
  resume. For a backlog, stay at or under ~2 calls per second.
- Timeouts: allow at least 10 s. Treat a timeout as unknown, not as failure — retry with the same `externalId`.

---

## 7. Testing, then going live

1. **Wire it with `isTest: true`.** Expect `201` and `{"stored": false, "reason": "test_lead"}`. That proves the
   URL, the key, the JSON shape and your error handling. **No person is stored** — but the call does create the
   campaign for your site and a visit row, so use a handful of test calls, not thousands.
2. **Then send one real lead** (`isTest` absent or `false`) and tell us — we confirm within minutes that the
   person, the consent text and the answers arrived intact.
3. Turn on the full flow.

Checklist before go-live:

- [ ] The key lives in your server environment, not in the page and not in the repository.
- [ ] `externalId` is your own stable id for the submission.
- [ ] `consentText` is the exact wording displayed.
- [ ] `capturedAt` is the submission time, in ISO 8601 with a timezone.
- [ ] `429` and `5xx` are retried with backoff and the same `externalId`.
- [ ] `stored: false` is logged with its `reason`, not treated as an error.
- [ ] Nothing is dropped silently: a failed send is queued and retried, or it is lost.

---

## 8. Examples

### Node (server-side, no dependency)

```js
class RetryableError extends Error {
  constructor(status) { super(`intake ${status}: retry later`); this.status = status; }
}

export async function sendLead(lead) {
  const res = await fetch('https://track.nexoquote.com/api/leads/intake', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.INTAKE_KEY,      // server env only
    },
    body: JSON.stringify({
      externalId: lead.id,                       // YOUR id — makes retries safe
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      zip: lead.zip,
      state: lead.state,
      consentText: lead.consentShown,            // the wording the person saw
      pageUrl: lead.pageUrl,
      ip: lead.ip,
      userAgent: lead.userAgent,
      capturedAt: lead.submittedAt.toISOString(),
      answers: lead.answers,                     // { q1: '…', q2: '…' }
    }),
  });

  if (res.status === 429 || res.status >= 500) throw new RetryableError(res.status);
  const body = await res.json();
  if (!res.ok) throw new Error(`intake ${res.status}: ${body.message}`);
  if (!body.stored) console.warn('lead not stored:', body.reason, lead.id);
  return body;                                   // { stored, clickId, campaignId }
}
```

### Next.js route handler (form posts to your server, your server posts to us)

```ts
export async function POST(req: Request) {
  const form = await req.json();
  const out = await sendLead({
    id: crypto.randomUUID(),                     // store this with your record
    ...form,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent') ?? undefined,
    submittedAt: new Date(),
  });
  return Response.json({ ok: out.stored });
}
```

### PHP

```php
$payload = json_encode([
  'externalId'  => $submissionId,
  'firstName'   => $_POST['first_name'],
  'phone'       => $_POST['phone'],
  'consentText' => $consentWordingShown,
  'pageUrl'     => $pageUrl,
  'capturedAt'  => gmdate('c'),
  'answers'     => ['q1' => $_POST['q1']],
]);

$ch = curl_init('https://track.nexoquote.com/api/leads/intake');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-api-key: ' . getenv('INTAKE_KEY')],
  CURLOPT_POSTFIELDS => $payload,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 15,
]);
$body = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);   // 201 = handled; 429/5xx = retry later
```

---

## 9. What happens to the lead after you send it

- It is attached to a visit under a campaign named for your site (`ext-<site>`), so your volume is never mixed
  with another partner's.
- Personal fields are kept for the retention window configured on our side (`LEADS_PII_RETENTION_DAYS`), then
  scrubbed automatically; the counts stay. Ask us for the current value if your own policy depends on it. The
  `pageUrl` you send is kept as the visit's referrer. Scrubbing always removes its query string, its fragment and
  any `user@` credentials. **Retention** applies one rule to every visit, whether it converted or not: the path is
  kept (`https://news.example/2025/best-rates`, what the "Referrer" reports group on), except a path segment that
  carries a person, which becomes `***` (`https://lp.example/confirm/***/step-2`). An **erasure** keeps only the
  origin (`https://your-site.example/`). A referrer without a scheme (`facebook.com`, `lp.example/merci`) keeps its
  host only.
- If the person asks to be erased, their data is removed everywhere. Before removing it, we keep a **keyed
  fingerprint** (HMAC-SHA256 with a secret key held outside the database) of every phone number and e-mail
  address we find for them — in the lead, in every visit of theirs (landing URL and its parameters included) and
  in every conversion (event data and postback parameters) — for the sole purpose of refusing them if they come
  back. This is pseudonymised data, not anonymous data. Any later send of that person returns
  `stored: false, reason: "erased_person"` and writes nothing, **including under a brand-new `externalId`**.
- **Limits of that recognition**, stated so you do not rely on more than it does:
  - it matches on the phone or the e-mail (case and a `+tag` ignored) — **a name alone is not matched**. A
    North-American number is recognised in any usual formatting: `+1`, `001` and `1-` prefixes, and an extension
    (`x12`, `x.12`, `ext. 4`, `Ext: 12`, `extn 12`, `extension 1234`, `;ext=12`, `;phone-context=+1`), are not part
    of the number. A **foreign** number is recognised with its `+` or `00` country code, with or without the
    national `(0)` (`+44 (0)7911 123456` and `+44 7911 123456` are the same person). **Written in its national form
    only** (`07911 123456`, `0612345678`), it is matched with its international form **when the country is known**
    — the `country` of the send, else the country of your site (set with your key, §10) — and only then: `0612345678`
    from a French site is `+33 6 12 34 56 78`; from a site with no country it stays `0612345678`, never guessed. The
    national trunk `0` is dropped and the country code added (France, United Kingdom, Germany, Belgium, Netherlands,
    Switzerland, Austria, Sweden, Ireland, Australia, New Zealand); in Italy, Spain and Portugal the national number is
    kept whole behind the code (`06…` in Rome stays `+39 06…`); North-American ten-digit numbers are already in their
    usual form and never change. Where a national form could equally be a number of another country once stored — an
    Italian mobile (`3…`, ten digits, the shape of a North-American number) — it is left as written: send it with
    `+39`. An erasure records such a number **as written and** in its international form, using the country of the
    visit it came from; a send is compared under the same two forms. The written form is exactly what we compared
    before this rule (September 2026), so it refuses no one new; the international form is the same number in the
    same country. Two forms of one number are **one** contact, never a second signal (see below). Limit: a person
    erased from a site with no country, under a national form, and who comes back with the `+` form, is not
    recognised — give every site its country. A foreign number is read with the national lengths of its country (the Brazilian mobile
    `+55 11 91234-5678`, the German `+49 151 23456789` and `+49 30 12345678` included), and a `+CC` followed by one
    block (`+52 8135550142`) is that foreign number — never the North-American number the block alone would be.
    Separators include the ones keyboards and word processors produce: non-breaking and thin spaces, en dash,
    non-breaking hyphen, minus sign, `/`, `_`, ` - ` (`813 555 0142`, `813–555–0142`, `813/555-0142`). Full-width
    digits (`８１３`) are digits;
  - on each send we compare `phone`, `email`, and any phone number or address written inside `answers` or
    `pageUrl`. **The consent text is not read, neither on a send nor at erasure** (`consent`, `consentText`,
    `consent_text`, `tcpa_text`…): it usually carries your own phone number, and one erased person must not block
    every lead that saw the same wording — nor your own test leads;
  - an address written `ann&#64;gmail.com`, `ann\u0040gmail.com` (escaped JSON) or `ann (at) gmail (dot) com` is
    read as `ann@gmail.com`, and removed as such by the scrub;
  - we tell apart a contact **declared** as the person's own from a number or address merely **found** in free
    text. **Declared** means one of the person's own contact fields, by its exact name: `phone`, `phoneNumber`,
    `mobile`, `cell`, `tel`, `telephone`, `callerId`, `contact_number`, `whatsapp`, `telefono`, `celular`, `email`,
    `emailAddress`, `mail`, `correo` — optionally with a word that only qualifies it (`customer_phone`,
    `contactEmail`, `day_phone`, `phone_home`, `cell_phone_number`, `best_phone`, `callback_phone`) — the top-level
    `phone` and `email` of this API, a form field described by its own keys (`field_data: [{ name: "phone_number",
    values: [...] }]`, as Meta Lead Ads sends it, or `{ key, value }`), a URL parameter with such a name (`?tel=`,
    `;tel=`, `#tel=`, `#/quote?phone=`, in a URL with or without `https://`), or a `tel:` / `mailto:` value. On our side, only
    the person's own contact events declare: the number a visitor clicks to call us is ours, not theirs. A contact
    nested under another party (`transfer.phone`, `agent.email`, `buyers[].phone`) is theirs, not the person's;
    `work_phone`, like `business_phone`, is read as found (a company switchboard is shared by its staff). **Every other field is read as found**, whatever its name: `tracking_phone`, `transfer_phone`,
    `support_email`, `business_phone`, `owner_phone`. A refusal needs a declared contact on at least one side, so
    your own tracking number never blocks your other leads — and, the other way round, **send the person's own
    number in `phone`**: sent only under a name like `business_phone`, it is less protected against coming back.
    **A contact only found in the erased person's texts needs a second signal**: "call my husband Bob at
    727-555-0199" in Ann's notes records Bob's number as *found*; Bob sending his own lead with it is **accepted**.
    A found contact refuses a declared one only if **another** contact of the same send (declared or found)
    belongs to the **same erasure** — Ann coming back with that number *and* her e-mail is refused. The price: a
    person whose own number was only ever in free text, and who comes back with nothing else we know, is not
    recognised (rare — forms declare `phone` and `email`). Declared against declared still refuses on its own.
    A contact belongs to **every** erasure that recorded it: Eve's number, found in Ann's notes, then found again
    in Eve's own erasure with her e-mail, belongs to both — Eve coming back with that number and that e-mail is
    refused. Fingerprints recorded before this rule (September 2026) are kept in a group of their own
    (`avant-groupes`) and keep the older, stricter behaviour (a found contact refuses on its own);
    Ad-platform parameters (`gad_*`, `utm_source`, `utm_medium`, `utm_campaign`, `gclid`, `*campaign*`, `ad_id`,
    `site_id`…), user-agents, browser and OS versions (`126.0.6478.127`), decimal amounts (`1234567.89`,
    `1,234,567.89`) and dates are not read as phone numbers — and, being not read, they are not scrubbed either:
    the "not a phone" rules live in one place. `utm_term` and `utm_content` **are** read (e-mailing tools write the
    recipient's address there). A number written with `00` (`0052-55-2566-1648`, `0055 11 91234-5678`) is read
    like one written with `+` when its length is that country's; a trunk `0` after the country code
    (`+44 07911 123456`, `+44 (0)7911 123456`) is dropped, so both forms are the same number;
  - invisible characters, quotes and bullets around an address (`“ann@example.com”`, `• ann@…`, a zero-width
    space, `**ann@…**`) are not part of it: the address is compared, and stored, without them. Characters an address
    may legally start with (`_ann@…`, `~ann@…`) are kept — `_ann@corp.example` and `ann@corp.example` are two
    mailboxes. We record **one faithful form** of each contact, never guessed variants: a guessed variant could
    refuse someone else who later declares it. The one exception is not a guess: a phone written in its national
    form, when its country is known, is also recorded in its international form (above);
  - **inside a URL**, we read every parameter (`&` and `;` separate them), and also what is not a parameter: the
    path (`/confirm/ann@gmail.com`), the fragment (`#ann@gmail.com`, `#/merci/813-555-0142`) and a bare token
    (`?ann@gmail.com`). In a parameter, `+` means a space — **except when the whole value is one address with at
    most one `+`**: `?sub2=ann+quotes@gmail.com` is Ann's tagged address (recorded as `ann@gmail.com` once the tag is
    dropped), never `quotes@gmail.com`, whatever the parameter is called; `?note=write+to+ann@x.com` (two `+` or
    more) is a sentence, and the address is `ann@x.com`. Under an e-mail name (`?email=`), any address keeps its `+`;
  - **how we break ties.** The list must refuse the erased person *and never refuse someone else*. Where a text is
    genuinely ambiguous, the second rule wins, and the forms below are read the way stated even though a rarer
    reading exists:
    - a digit next to a complete North-American number is not part of it: `Unit 3 (813) 555-0142`,
      `after 5 813-555-0142`, `813-555-0142 2 vehicles` are all `8135550142`;
    - numbers written side by side with spaces, without `+`/`00`, that neither have the North-American shape nor
      start with a national `0` (`2024 24082`, `33610 13601`, `$887.99 2015`, `33610. 52150`) are not a phone; nor is a
      run of more than eleven digits without `+`/`00` (millisecond timestamps, Meta ids). A foreign number written
      that way (no `+`, no leading `0`) is therefore not recognised — send it in `phone`;
    - a `+` glued after a letter or digit (`call+800-555-1212`, `phone=(534)+801-5359`) is a query-string space, not
      an international prefix;
    - a bare run of nine to eleven digits **is** read as a phone, whatever word precedes it: `order 4500012345`
      cannot be told apart from a phone number by its shape. It is recorded as *found*, so it can only refuse
      someone who later *declares* that very number;
    - `#` and `|` are legal in an address but, written in front of one, they separate it from what precedes
      (`#ann@x.com`, `spring|ann@x.com` are `ann@x.com`); an `&` does too when only digits precede it
      (`zip=33610&ann@x.com`), while `ann&co@x.com` stays whole;
    - a sentence resumed without a space after an address (`ann@gmail.com.Thanks`) is cut at the capitalised word;
      a lowercase continuation (`ann@gmail.com.thanks`) cannot be told from a domain and is kept;
    - a quote, bracket or asterisk around an address is removed only when it also closes it (`'ann@x.com'`,
      `**_ann@x.com**`); a lone leading `'`, `_` or `~` is part of the address;
    - a foreign number ends where its country's length ends (a small table of national lengths for the common
      country codes; 7 to 12 digits elsewhere), and never across a double space or a lone `-`: in
      `+44 7911 123456 123 Main St` or `+49 30 1234567 12 months`, the neighbour digits are not part of it;
    - in a URL parameter, an **unencoded** `+` in front of a country code is a space, as URL rules say
      (`?phone=+44+7911+123456` reads `44 7911 123456`, which is not recognised as foreign): encode it (`%2B`) or send
      the number in `phone`. For `+1` both readings give the same number;
  - **a partner holding a key can learn whether a given phone or e-mail was erased** — that is what
    `erased_person` answers. This is inherent to refusing erased people, and one more reason to keep your key on
    your server;
  - people erased **before** this feature existed cannot be recognised: their contact was deleted, there was
    nothing left to fingerprint;
  - **a shared number blocks everyone behind it**: if a company switchboard or a family phone was erased with one
    person, later leads carrying that same number are refused, even with another name or e-mail. If a refused
    lead is clearly someone else, tell us;
  - the recognition depends on our key staying the same. We protect it (see §10), but if it were ever lost, the
    list could no longer recognise anyone and new leads would be refused with `503` until it is restored.
- Consent text, IP and user-agent are kept with the lead as the evidence that the contact was allowed, for the
  retention window. After it, only the consent fingerprint (SHA-256 of the wording) and its date remain.

If you need something this endpoint does not do — updating a lead you already sent, sending a call outcome,
batching thousands of rows at once — ask us rather than working around it.

---

## 10. For the operator (our side, not the partner's)

- Keys live in `INTAKE_API_KEYS` on the tracker: `"site:key:CC,site:key:CC"` — one entry per partner site, `CC`
  being the site's country (ISO 3166 two letters, `UK` accepted for `GB`), e.g.
  `"monsite.fr:<key>:FR,autre.com:<key>:US"`. The country is **optional** and the old `"site:key"` format still
  works (no country: phone numbers written without a country code are kept as written). **Set it for every site**:
  it is what lets the suppression list match `0612345678` with `+33 6 12 34 56 78` (§9). A country is read only on
  a final `:` followed by two letters, so a key must never end that way (`openssl rand -hex 32` never does); a key
  may otherwise contain `:`. Two entries of the same site with two different countries apply none, and a country we
  have no rule for (`MX`) changes nothing; both are reported by an `ERROR` line on each intake call. A send's own
  `country` field takes precedence over the site's. Adding or changing a country needs no migration: the list
  already reads both forms. `parseIntakeKeys` ignores an entry without both halves, and the route refuses everything
  while the variable is empty (an `ERROR` line in the tracker log says so).
- Never reuse `ADMIN_API_KEY` for a partner: that key also opens the lead list, the CSV export and deletion.
- Generate a key with `openssl rand -hex 32`. Revoke by removing that one entry and restarting the API.
- `ERASURE_HMAC_KEY` (32 characters at least, `openssl rand -hex 32`) keys the suppression list. **Never change it.**
  At first use the tracker writes a *witness* fingerprint; if a later key does not reproduce it, intake refuses
  everything with `503` and erasures report `suppression: "failed"`, with an `ERROR` line saying the key changed.
  Restoring the original key restores everything. Back it up with the server secrets. Both keys are in
  `deploy/backend.production.env.example`.
- Erasure responses — on both routes, `DELETE /api/leads/:id` and `DELETE /api/leads/visit/:clickId` — say
  `suppression: "partial"` when some visit or conversion data was too large to be read in full (what was read is
  recorded; check that person by hand), `suppression: "nothing"` when no phone or e-mail could be found to fingerprint (the person
  can come back), and `suppression: "failed"` when the list could not be written.
- Code: `src/leads/intake-key.guard.ts`, `LeadsService.intake` in `src/leads/leads.service.ts`, DTO in
  `src/leads/dto/intake-lead.dto.ts`. Proofs: `test/intake-key.guard.spec.ts` and the intake block in
  `test/leads.spec.ts`. National forms and site countries (`enFormeInternationale`, `formesDuNumero` in
  `src/leads/lead-fields.ts`, `paysDuSite` in the guard): `test/leads-numero-national.pglite.spec.ts`, end to end
  on Postgres.
- **One detector** (`detecter` in `src/leads/lead-fields.ts`, round 31): for a value under a key it returns every
  contact it reads, with its exact place (start, end) in the stored value. The suppression list records what those
  spans contain; every scrub — `withoutContact` (conversion metadata, landing parameters), `redactPersonal`,
  `sanitizeUrlPii` (postback URLs), `referrerSansPersonne` (the visit's referrer) — replaces exactly those spans with
  `***`, in the stored value itself (nothing decoded or re-encoded). A value under a key the list DECLARES
  (`champDeLaPersonne`: `phone`, `whatsapp`, `cell_phone`…) is removed whole, with the same classification; other
  personal data that is not a contact (names, IP, consent…) is removed by key (`PII_METADATA_KEYS`). The SQL scrub in
  `src/leads/lead-sql.ts` cannot run the detector: it only removes keys (the same whitelist, compared without case
  or punctuation) and URL parts (query, fragment, credentials, and the path at erasure) after the JavaScript pass,
  and `test/leads-fuzz-personne.pglite.spec.ts` proves on planted URLs that it removes nothing the detector would
  keep and adds nothing back (SQL(JS(x)) = JS(x) at retention). A card number is the one thing scrubbed without
  being recorded (it is not a contact). `isErasedPerson` reads the list in one query.
- Suppression-list reading (`src/leads/lead-fields.ts`) is held by a **planted-contact bench**:
  `test/fuzz-personne.gen.ts` plants a known phone or address in realistic contexts (notes with neighbouring digits,
  wrappers, separators, URLs, Meta Lead Ads, Ringba, TrustedForm/Jornaya, `sub1…sub5`, decoy identifiers) and
  `test/leads-fuzz-personne.spec.ts` checks, for 25,000 seeded cases, that the person is recorded (declared when
  declared), that nothing else is, and that the erasure scrub removes them; `test/leads-fuzz-personne.pglite.spec.ts`
  does the same for the SQL referrer scrub. Longer sweep: `FUZZ_GRAINES=1-120 FUZZ_N=5000 npm test --
  leads-fuzz-personne` (the tie-breaks of §9 are the only readings it does not generate). A second, independent
  bench written by the r11 juror (`test/leads-jury-r11-fuzz.spec.ts`: CSV, HTML, SMS, FR/ES, escaped JSON, markdown,
  `tel:;ext=`, foreign numbers) runs in the suite too; longer: `JURY_N=20000 JURY_SEEDS=1,2,3 npm test --
  leads-jury-r11-fuzz`. A third one, by the r12 juror (`test/leads-jury-r12-fuzz.spec.ts`: separators × keys,
  ASCII and Unicode families), is blocking too. The planted-contact bench also checks, on every case, that each span
  read is gone from the scrubbed value at the same path, and that re-reading the scrubbed value records nothing that
  was recorded before (P1 ⇔ P3).
- **The column registry** (`src/leads/lead-columns.ts`, round 32). Every text or JSON column of `clicks`,
  `conversions`, `leads` and `postback_logs` is classified once: `contact` (read by the suppression list AND
  scrubbed — `utm_*`, `ad_title`, `content_name`, `custom_variable_*`, `metadata`, `raw_params`…), `url` (read,
  scrubbed by the URL rule — the referrer's path segment and host label that carry the person become `***`),
  `personnel` (IP, user-agent, names: emptied, never read as a contact), `identifiant` (ids, `gclid`,
  `browser_version`, `ad_id`: never read) and `structure`. The list reads only `contact` and `url` columns, under
  their column name; the JavaScript scrub (`nettoyageJs`), the SQL `SET` statements (`affectationsSql`), the lead
  tombstone and the retention of lead rows are generated from the same entries. `test/lead-columns.spec.ts` parses
  `prisma/schema.prisma` and fails on a column added without a class or a registry entry whose column no longer
  exists; `test/leads-r32.pglite.spec.ts` plants an address and a number in every read column, runs `deleteOne`
  on Postgres (pglite) and checks each was recorded and is gone, and that a phone-shaped value in any other column
  is never recorded. **Adding a text/JSON column to one of these models means classifying it there.**
- A form field described by its own keys (`{ name, values }`, `{ key, value }`, `{ column_id, string_value }`)
  keeps its label at retention: only the value is judged. Without the label a later erasure read a `ttclid` as a
  phone. Elsewhere `name` is still personal data and removed. Containers read as declarations include `entry`
  (Meta webhooks), `form_response` (Typeform) and `user_column_data` (Google Ads lead forms).
- Migration `20260919090000_erased_contacts_groupe` (not yet applied in production — one migration for rounds 30
  and 32) adds `erased_contacts.groupe` (one random id per erasure) for the second-signal rule of §9 and makes the
  primary key the pair `(hash, groupe)`: a fingerprint belongs to every erasure that recorded it. Existing rows get
  `avant-groupes` (older, stricter rule) and the witness row `temoin`.
