# send-batch Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command (`node send-batch.js <csv> --campaign <key>`) that normalises, dedups (ledger + target sheet), Reoon-verifies, naturalises, composes carrier-field insights, and appends leads to the campaign's Google Sheet for TaskMagic → Mailead pickup.

**Architecture:** Single orchestrator CLI over small shared modules (`shared/outreach-core/`): a CSV utility, a refactored JWT Sheets client, a normaliser, a deduper, an insight composer, a ledger, and a campaign registry. State = `config/campaign-sheets.json` + `data/sent-ledger.txt`. Spec: `docs/superpowers/specs/2026-07-02-send-batch-pipeline-design.md`.

**Tech Stack:** Node 24 (no new npm deps), built-in `node:test` runner, hand-rolled Google Sheets v4 REST via service-account JWT (crypto), existing Reoon verifier module.

**First live data:** `exports/ksd-proservices-batch2-2026-06-24-safe816.csv` (816 KSD pro-services, Reoon-verified 2026-06-28) → campaign `ksd-pro-services`.

**Conventions used throughout:**
- Tests live in `tests/`, run with `PATH="/opt/homebrew/bin:$PATH" node --test tests/`.
- All modules are CommonJS (`module.exports`), matching the repo.
- Sheet column convention: **snake_case headers = reference block** (never mapped), **Title Case headers = Mailead block** (TaskMagic maps these to like-named Mailead fields).
- Never commit `data/sent-ledger.txt` entries containing test emails; test fixtures use temp dirs.

---

### Task 1: Shared CSV utility (`csv-util.js`)

The repo has ~8 inlined copies of `parseCSV`. Create one shared module (with BOM stripping — a real bug: the July LeadByte file's BOM-prefixed first header) plus a writer.

**Files:**
- Create: `shared/outreach-core/csv/csv-util.js`
- Test: `tests/csv-util.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/csv-util.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseCSV, toCSV } = require('../shared/outreach-core/csv/csv-util');

test('parses quoted fields with commas and escaped quotes', () => {
  const rows = parseCSV('a,b\n"x, y","say ""hi"""\n');
  assert.deepStrictEqual(rows, [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('strips UTF-8 BOM from first header', () => {
  const rows = parseCSV('﻿Organization Name,Website\nAcme,https://acme.com\n');
  assert.strictEqual(rows[0][0], 'Organization Name');
});

test('handles CRLF and trailing newline', () => {
  const rows = parseCSV('a,b\r\n1,2\r\n');
  assert.deepStrictEqual(rows, [['a', 'b'], ['1', '2']]);
});

test('toCSV escapes commas, quotes and newlines', () => {
  const s = toCSV([['a', 'b'], ['x, y', 'say "hi"\nline2']]);
  assert.strictEqual(s, 'a,b\n"x, y","say ""hi""\nline2"\n');
});

test('round-trips', () => {
  const rows = [['h1', 'h2'], ['plain', 'with, comma']];
  assert.deepStrictEqual(parseCSV(toCSV(rows)), rows);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/csv-util.test.js`
Expected: FAIL — `Cannot find module '../shared/outreach-core/csv/csv-util'`

- [ ] **Step 3: Write minimal implementation**

```js
// shared/outreach-core/csv/csv-util.js
// Single shared CSV parse/serialise. Strips UTF-8 BOM (LeadByte drops carry one).

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function csvField(v) {
  v = String(v == null ? '' : v);
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function toCSV(rows) {
  return rows.map(r => r.map(csvField).join(',')).join('\n') + '\n';
}

module.exports = { parseCSV, toCSV, csvField };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/csv-util.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add shared/outreach-core/csv/csv-util.js tests/csv-util.test.js
git commit -m "feat(core): shared CSV parse/serialise with BOM strip"
```

---

### Task 2: Sheets client (`sheets-client.js`) — refactor out of push-to-sheet.js

**Files:**
- Create: `shared/outreach-core/sheets/sheets-client.js`
- Test: `tests/sheets-client.test.js`
- Modify (later, Task 10): `push-to-sheet.js` to use it

Network calls go through `global.fetch`; tests stub it. Pure helpers (`extractSheetId`) tested directly.

- [ ] **Step 1: Write the failing test**

```js
// tests/sheets-client.test.js
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const sc = require('../shared/outreach-core/sheets/sheets-client');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

test('extractSheetId from URL and bare ID', () => {
  assert.strictEqual(
    sc.extractSheetId('https://docs.google.com/spreadsheets/d/abc123_-XYZ/edit#gid=0'),
    'abc123_-XYZ');
  assert.strictEqual(sc.extractSheetId('abc123'), 'abc123');
});

test('readColumn returns values under the named header', async () => {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push(url);
    if (url.includes('/token')) return { json: async () => ({ access_token: 't' }) };
    return { json: async () => ({ values: [['first_name', 'email'], ['A', 'a@x.com'], ['B', 'b@x.com']] }) };
  };
  const vals = await sc.readColumn('SHEET1', 'ToSend', 'email');
  assert.deepStrictEqual(vals, ['a@x.com', 'b@x.com']);
});

test('readColumn returns [] for empty tab', async () => {
  global.fetch = async (url) => {
    if (url.includes('/token')) return { json: async () => ({ access_token: 't' }) };
    return { json: async () => ({}) }; // no values key = empty tab
  };
  assert.deepStrictEqual(await sc.readColumn('S', 'ToSend', 'email'), []);
});

test('appendRows writes header only when tab empty', async () => {
  let appendedBody = null;
  global.fetch = async (url, opts) => {
    if (url.includes('/token')) return { json: async () => ({ access_token: 't' }) };
    if (url.includes(':append')) { appendedBody = JSON.parse(opts.body); return { json: async () => ({ updates: {} }) }; }
    return { json: async () => ({}) }; // A1 check: empty
  };
  await sc.appendRows('S', 'ToSend', ['h1', 'h2'], [['1', '2']]);
  assert.deepStrictEqual(appendedBody.values, [['h1', 'h2'], ['1', '2']]);
});

test('appendRows skips header when tab has content', async () => {
  let appendedBody = null;
  global.fetch = async (url, opts) => {
    if (url.includes('/token')) return { json: async () => ({ access_token: 't' }) };
    if (url.includes(':append')) { appendedBody = JSON.parse(opts.body); return { json: async () => ({ updates: {} }) }; }
    return { json: async () => ({ values: [['h1']] }) }; // A1 non-empty
  };
  await sc.appendRows('S', 'ToSend', ['h1', 'h2'], [['1', '2']]);
  assert.deepStrictEqual(appendedBody.values, [['1', '2']]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/sheets-client.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// shared/outreach-core/sheets/sheets-client.js
// Google Sheets v4 REST client via service-account JWT. No external deps.
// Refactored from push-to-sheet.js. Creds: ~/.credentials/outreach-sheets-sa.json
const crypto = require('crypto'), path = require('path'), os = require('os');

const KEY_PATH = path.join(os.homedir(), '.credentials/outreach-sheets-sa.json');
let KEY = null;
function key() { if (!KEY) KEY = require(KEY_PATH); return KEY; }

const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// token cache per scope set (tokens live 1h; cache for 50min)
const tokCache = {};
async function getToken(scope = 'https://www.googleapis.com/auth/spreadsheets') {
  const hit = tokCache[scope];
  if (hit && hit.exp > Date.now()) return hit.tok;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: key().client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const unsigned = head + '.' + claim;
  const sig = b64url(crypto.createSign('RSA-SHA256').update(unsigned).sign(key().private_key));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig })
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('TOKEN ERROR: ' + JSON.stringify(j));
  tokCache[scope] = { tok: j.access_token, exp: Date.now() + 50 * 60 * 1000 };
  return j.access_token;
}

function extractSheetId(urlOrId) {
  const m = String(urlOrId).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : String(urlOrId);
}

async function api(url, opts = {}, scope) {
  const tok = await getToken(scope);
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const j = await r.json();
  if (j.error) throw new Error(`Sheets API error: ${JSON.stringify(j.error)}`);
  return j;
}

// Read a whole tab, return the values under headerName (excludes header row).
async function readColumn(sheetId, tab, headerName) {
  const j = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}`);
  const values = j.values || [];
  if (!values.length) return [];
  const idx = values[0].indexOf(headerName);
  if (idx < 0) return [];
  return values.slice(1).map(r => r[idx] || '').filter(v => v !== '');
}

// Append rows; write header first iff the tab is empty (A1 check).
async function appendRows(sheetId, tab, header, dataRows) {
  const chk = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}!A1:A1`);
  const empty = !chk.values || !chk.values.length;
  const values = empty ? [header, ...dataRows] : dataRows;
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values }) });
  return { appended: dataRows.length, wroteHeader: empty };
}

// Create a spreadsheet (SA-owned) with one tab, share Editor with an email.
// Sharing needs the Drive scope; creation works with the spreadsheets scope.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
async function createSpreadsheet(title, tab, shareWithEmail) {
  const created = await api('https://sheets.googleapis.com/v4/spreadsheets',
    { method: 'POST', body: JSON.stringify({ properties: { title }, sheets: [{ properties: { title: tab } }] }) });
  const sheetId = created.spreadsheetId;
  await api(`https://www.googleapis.com/drive/v3/files/${sheetId}/permissions?sendNotificationEmail=false`,
    { method: 'POST', body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: shareWithEmail }) }, DRIVE_SCOPE);
  return { sheetId, url: 'https://docs.google.com/spreadsheets/d/' + sheetId };
}

module.exports = { getToken, extractSheetId, readColumn, appendRows, createSpreadsheet };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/sheets-client.test.js`
Expected: PASS (5 tests). Note the tests never read the real creds file (lazy `key()` load, stubbed fetch skips signing for token because the token endpoint is stubbed BEFORE `crypto.createSign` — if the token path still executes signing, stub `getToken` instead: the tests above stub fetch for the token URL, but `createSign` runs first and needs a real key. If the test machine has `~/.credentials/outreach-sheets-sa.json` this is fine (it does — the daily engine uses it). If a test fails on key load, change the token test-stub approach to `sc.__setTokenForTest` — do NOT ship that unless needed.)

- [ ] **Step 5: Commit**

```bash
git add shared/outreach-core/sheets/sheets-client.js tests/sheets-client.test.js
git commit -m "feat(core): shared Sheets client (read/append/create+share) from push-to-sheet"
```

---

### Task 3: Normaliser (`normalise.js`)

**Files:**
- Create: `shared/outreach-core/csv/normalise.js`
- Test: `tests/normalise.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/normalise.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { normalise, CANONICAL } = require('../shared/outreach-core/csv/normalise');

const HDR = ['Decision Maker First Name', 'Decision Maker Last Name', 'Decision Maker Email', 'Organization Name', 'City', 'Website', 'Decision Maker LinkedIn URL', 'Industries'];
const ROW = ['Sarah', 'Jones', ' Sarah.Jones@Acme.COM ', 'Acme Ltd', 'Wilmslow', 'https://acme.com', 'https://linkedin.com/in/sj', 'Health Care'];

test('maps aliased headers to canonical fields', () => {
  const { leads } = normalise([HDR, ROW]);
  const l = leads[0];
  assert.strictEqual(l.first_name, 'Sarah');
  assert.strictEqual(l.last_name, 'Jones');
  assert.strictEqual(l.email, 'sarah.jones@acme.com'); // lowercased + trimmed
  assert.strictEqual(l.company_name, 'Acme Ltd');
  assert.strictEqual(l.town, 'Wilmslow');
  assert.strictEqual(l.website, 'https://acme.com');
  assert.strictEqual(l.linkedin_url, 'https://linkedin.com/in/sj');
});

test('keeps unmapped columns in ref', () => {
  const { leads } = normalise([HDR, ROW]);
  assert.strictEqual(leads[0].ref['Industries'], 'Health Care');
});

test('already-canonical headers pass through', () => {
  const { leads } = normalise([['first_name', 'email', 'company', 'category', 'town'], ['Pete', 'p@x.co', 'Bevan & Co', 'accountant', 'Bramhall']]);
  assert.strictEqual(leads[0].company_name, 'Bevan & Co'); // company -> company_name
  assert.strictEqual(leads[0].category, 'accountant');
});

test('drops rows with invalid email, reports them', () => {
  const { leads, skipped } = normalise([['email', 'first_name'], ['not-an-email', 'X'], ['ok@x.com', 'Y']]);
  assert.strictEqual(leads.length, 1);
  assert.strictEqual(skipped.length, 1);
  assert.strictEqual(skipped[0].reason, 'invalid_email');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/normalise.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// shared/outreach-core/csv/normalise.js
// Map arbitrary CSV headers onto the canonical lead schema; keep everything else in .ref
const { isValidEmail } = require('../validation/data-quality');

// canonical field -> lowercase header aliases (exact match after trim/lowercase)
const CANONICAL = {
  email:        ['email', 'decision maker email', 'email address', 'generic email address', 'e-mail'],
  first_name:   ['first_name', 'first name', 'decision maker first name', 'firstname'],
  last_name:    ['last_name', 'last name', 'decision maker last name', 'lastname', 'surname'],
  company_name: ['company_name', 'company', 'company name', 'organization name', 'organisation name', 'company_full'],
  category:     ['category', 'business type', 'industry'],
  town:         ['town', 'city', 'location'],
  website:      ['website', 'url', 'site'],
  linkedin_url: ['linkedin_url', 'linkedin', 'decision maker linkedin url', 'linkedin url'],
};

function normalise(rows) {
  const header = rows[0].map(h => String(h).trim());
  const lower = header.map(h => h.toLowerCase());
  // canonical field -> column index (first alias hit wins; earlier aliases beat later)
  const map = {};
  for (const [field, aliases] of Object.entries(CANONICAL)) {
    for (const a of aliases) { const i = lower.indexOf(a); if (i >= 0) { map[field] = i; break; } }
  }
  const mappedIdx = new Set(Object.values(map));
  const leads = [], skipped = [];
  for (const r of rows.slice(1)) {
    if (r.length < 2) continue; // blank/garbage line
    const lead = { ref: {} };
    for (const [field, i] of Object.entries(map)) lead[field] = String(r[i] || '').trim();
    for (const field of Object.keys(CANONICAL)) if (!(field in lead)) lead[field] = '';
    lead.email = lead.email.toLowerCase();
    header.forEach((h, i) => { if (!mappedIdx.has(i)) lead.ref[h] = String(r[i] || '').trim(); });
    if (!isValidEmail(lead.email)) { skipped.push({ email: lead.email, reason: 'invalid_email' }); continue; }
    leads.push(lead);
  }
  return { leads, skipped, mappedFields: Object.keys(map) };
}

module.exports = { normalise, CANONICAL };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/normalise.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add shared/outreach-core/csv/normalise.js tests/normalise.test.js
git commit -m "feat(core): header normaliser mapping arbitrary CSVs to canonical lead schema"
```

---

### Task 4: Deduper (`dedup.js`)

**Files:**
- Create: `shared/outreach-core/csv/dedup.js`
- Test: `tests/dedup.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/dedup.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { dedupe } = require('../shared/outreach-core/csv/dedup');

const L = e => ({ email: e });

test('removes within-file duplicates keeping first', () => {
  const { kept, skipped } = dedupe([L('a@x.com'), L('a@x.com'), L('b@x.com')], new Set(), new Set());
  assert.deepStrictEqual(kept.map(l => l.email), ['a@x.com', 'b@x.com']);
  assert.strictEqual(skipped[0].reason, 'dupe_in_file');
});

test('skips emails in the ledger', () => {
  const { kept, skipped } = dedupe([L('a@x.com'), L('b@x.com')], new Set(['a@x.com']), new Set());
  assert.deepStrictEqual(kept.map(l => l.email), ['b@x.com']);
  assert.strictEqual(skipped[0].reason, 'in_ledger');
});

test('skips emails already in target sheet', () => {
  const { kept, skipped } = dedupe([L('a@x.com')], new Set(), new Set(['a@x.com']));
  assert.strictEqual(kept.length, 0);
  assert.strictEqual(skipped[0].reason, 'in_sheet');
});

test('comparison is case-insensitive', () => {
  const { kept } = dedupe([L('A@X.com')], new Set(['a@x.com']), new Set());
  assert.strictEqual(kept.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/dedup.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// shared/outreach-core/csv/dedup.js
// Three-pass dedup: within-file, global sent-ledger, target-sheet. All skips reported.
function dedupe(leads, ledgerSet, sheetSet) {
  const lower = s => String(s).toLowerCase();
  const ledger = new Set([...ledgerSet].map(lower));
  const sheet = new Set([...sheetSet].map(lower));
  const seen = new Set();
  const kept = [], skipped = [];
  for (const lead of leads) {
    const e = lower(lead.email);
    if (seen.has(e)) { skipped.push({ email: e, reason: 'dupe_in_file' }); continue; }
    seen.add(e);
    if (ledger.has(e)) { skipped.push({ email: e, reason: 'in_ledger' }); continue; }
    if (sheet.has(e)) { skipped.push({ email: e, reason: 'in_sheet' }); continue; }
    kept.push(lead);
  }
  return { kept, skipped };
}

module.exports = { dedupe };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/dedup.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add shared/outreach-core/csv/dedup.js tests/dedup.test.js
git commit -m "feat(core): three-pass dedup (file, ledger, target sheet)"
```

---

### Task 5: Sent ledger (`ledger.js`)

**Files:**
- Create: `shared/outreach-core/csv/ledger.js`
- Test: `tests/ledger.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/ledger.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os');
const { readLedger, appendLedger } = require('../shared/outreach-core/csv/ledger');

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-')), 'sent-ledger.txt'); }

test('readLedger returns empty set for missing file', () => {
  assert.strictEqual(readLedger(tmpFile()).size, 0);
});

test('appendLedger then readLedger round-trips, lowercased and deduped', () => {
  const f = tmpFile();
  appendLedger(f, ['A@X.com', 'b@y.com']);
  appendLedger(f, ['a@x.com', 'c@z.com']); // a@x.com already there -> not duplicated
  const set = readLedger(f);
  assert.deepStrictEqual([...set].sort(), ['a@x.com', 'b@y.com', 'c@z.com']);
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 3); // no duplicate line written
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/ledger.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// shared/outreach-core/csv/ledger.js
// Global sent-ledger: one lowercased email per line. Append-only, dedupes on write.
const fs = require('fs'), path = require('path');

function readLedger(file) {
  if (!fs.existsSync(file)) return new Set();
  return new Set(fs.readFileSync(file, 'utf8').split(/\r?\n/).map(l => l.trim().toLowerCase()).filter(Boolean));
}

function appendLedger(file, emails) {
  const existing = readLedger(file);
  const fresh = [...new Set(emails.map(e => String(e).trim().toLowerCase()))].filter(e => e && !existing.has(e));
  if (!fresh.length) return 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, fresh.join('\n') + '\n');
  return fresh.length;
}

module.exports = { readLedger, appendLedger };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/ledger.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add shared/outreach-core/csv/ledger.js tests/ledger.test.js
git commit -m "feat(core): append-only sent-ledger with dedup on write"
```

---

### Task 6: Insight composer (`insight-composer.js`)

**Files:**
- Create: `shared/outreach-core/content-generation/insight-composer.js`
- Test: `tests/insight-composer.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/insight-composer.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { composeInsights, fillTemplate } = require('../shared/outreach-core/content-generation/insight-composer');

const lead = { first_name: 'Sarah', category: 'Accountant', town: 'Stockport', company_name: 'Acme' };

test('fills placeholders, lowercasing category', () => {
  const s = fillTemplate('a good {category} in {town}', lead);
  assert.strictEqual(s, 'a good accountant in Stockport');
});

test('throws on unresolved placeholder (missing lead field)', () => {
  assert.throws(() => fillTemplate('needs {signal}', lead), /unresolved placeholder/i);
});

test('rejects em dashes in composed output', () => {
  assert.throws(() => fillTemplate('bad — dash', lead), /em dash/i);
});

test('composeInsights returns one value per carrier, empty carriers = {}', () => {
  const out = composeInsights(lead, { last_name: 'ask for a good {category} in {town}' });
  assert.deepStrictEqual(Object.keys(out), ['last_name']);
  assert.strictEqual(out.last_name, 'ask for a good accountant in Stockport');
  assert.deepStrictEqual(composeInsights(lead, {}), {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/insight-composer.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// shared/outreach-core/content-generation/insight-composer.js
// Deterministic carrier-field insight composition. No LLM. No em dashes, ever.
// Placeholders: {category} (lowercased), {town}, {company_name}, {first_name}, {signal}...
// any canonical lead field is legal; unresolved placeholders are an error, not a blank.

function fillTemplate(tpl, lead) {
  const out = tpl.replace(/\{(\w+)\}/g, (_, field) => {
    let v = lead[field];
    if (v === undefined || v === null || v === '') throw new Error(`unresolved placeholder {${field}} for ${lead.email || lead.company_name || 'lead'}`);
    v = String(v).trim();
    if (field === 'category') v = v.toLowerCase();
    return v;
  });
  if (/—|–/.test(out)) throw new Error('em dash (or en dash) in composed insight: ' + out);
  return out;
}

// carriers: { <mailead_field>: <template> } -> { <mailead_field>: <composed text> }
function composeInsights(lead, carriers) {
  const out = {};
  for (const [field, tpl] of Object.entries(carriers || {})) out[field] = fillTemplate(tpl, lead);
  return out;
}

module.exports = { composeInsights, fillTemplate };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/insight-composer.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add shared/outreach-core/content-generation/insight-composer.js tests/insight-composer.test.js
git commit -m "feat(core): deterministic carrier-field insight composer"
```

---

### Task 7: Campaign registry (`campaign-registry.js`)

**Files:**
- Create: `shared/outreach-core/campaigns/campaign-registry.js`
- Create: `config/campaign-sheets.json` (empty registry `{}`)
- Test: `tests/campaign-registry.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/campaign-registry.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os');
const { loadRegistry, getCampaign, saveCampaign } = require('../shared/outreach-core/campaigns/campaign-registry');

function tmpReg(initial) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reg-')), 'campaign-sheets.json');
  if (initial !== undefined) fs.writeFileSync(f, JSON.stringify(initial, null, 2));
  return f;
}

test('loadRegistry returns {} for missing file', () => {
  assert.deepStrictEqual(loadRegistry(tmpReg()), {});
});

test('getCampaign returns entry or null', () => {
  const f = tmpReg({ 'ksd-doctors': { sheetId: 'S1', sheetUrl: 'u', label: 'Doctors', carriers: {} } });
  assert.strictEqual(getCampaign(f, 'ksd-doctors').sheetId, 'S1');
  assert.strictEqual(getCampaign(f, 'nope'), null);
});

test('saveCampaign persists and preserves other entries', () => {
  const f = tmpReg({ a: { sheetId: '1' } });
  saveCampaign(f, 'b', { sheetId: '2', sheetUrl: 'u2', label: 'B', carriers: {} });
  const reg = loadRegistry(f);
  assert.strictEqual(reg.a.sheetId, '1');
  assert.strictEqual(reg.b.sheetId, '2');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/campaign-registry.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// shared/outreach-core/campaigns/campaign-registry.js
// Registry: campaign key -> { sheetId, sheetUrl, label, carriers: {field: template} }
const fs = require('fs'), path = require('path');

function loadRegistry(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function getCampaign(file, key) {
  return loadRegistry(file)[key] || null;
}

function saveCampaign(file, key, entry) {
  const reg = loadRegistry(file);
  reg[key] = entry;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(reg, null, 2) + '\n');
}

module.exports = { loadRegistry, getCampaign, saveCampaign };
```

Also create the empty live registry:

```bash
mkdir -p config && echo '{}' > config/campaign-sheets.json
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/campaign-registry.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add shared/outreach-core/campaigns/campaign-registry.js tests/campaign-registry.test.js config/campaign-sheets.json
git commit -m "feat(core): campaign registry (key -> sheet + carriers)"
```

---

### Task 8: Sheet row builder (`sheet-rows.js`) — the two-block layout

**Files:**
- Create: `shared/outreach-core/campaigns/sheet-rows.js`
- Test: `tests/sheet-rows.test.js`

Column convention: snake_case = reference block (never mapped); Title Case = Mailead block (TaskMagic maps these). Mailead block always: `First Name, Last Name, Email, Company Name` (+ one Title Case column per extra carrier beyond last_name, e.g. `Linkedin Url`).

- [ ] **Step 1: Write the failing test**

```js
// tests/sheet-rows.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildHeader, buildRow, MAILEAD_LABELS } = require('../shared/outreach-core/campaigns/sheet-rows');

const lead = {
  first_name: 'Sarah', last_name: 'Jones', email: 's@x.com', company_name: 'Acme',
  category: 'accountant', town: 'Stockport', website: 'https://a.com', linkedin_url: 'https://li.com/sj',
  ref: { Industries: 'Health' }, reoonStatus: 'safe', reoonScore: '98', reoonSafe: '1',
};

test('header = reference block then Mailead block, extras included', () => {
  const h = buildHeader(['Industries'], ['last_name']);
  assert.deepStrictEqual(h, [
    'first_name', 'last_name', 'email', 'company_name', 'category', 'town', 'website', 'linkedin_url',
    'reoonStatus', 'reoonScore', 'reoonSafe', 'Industries',
    'First Name', 'Last Name', 'Email', 'Company Name',
  ]);
});

test('carrier value lands in the Mailead column; real value stays in reference', () => {
  const h = buildHeader(['Industries'], ['last_name']);
  const row = buildRow(lead, h, { last_name: 'the insight text' });
  const get = name => row[h.indexOf(name)];
  assert.strictEqual(get('last_name'), 'Jones');          // reference: real surname
  assert.strictEqual(get('Last Name'), 'the insight text'); // Mailead: injected
  assert.strictEqual(get('First Name'), 'Sarah');
  assert.strictEqual(get('Email'), 's@x.com');
  assert.strictEqual(get('Company Name'), 'Acme');
  assert.strictEqual(get('Industries'), 'Health');
});

test('no carriers -> Mailead Last Name carries the real surname', () => {
  const h = buildHeader([], []);
  const row = buildRow(lead, h, {});
  assert.strictEqual(row[h.indexOf('Last Name')], 'Jones');
});

test('extra carrier adds its Title Case Mailead column', () => {
  const h = buildHeader([], ['last_name', 'linkedin_url']);
  assert.ok(h.includes('Linkedin Url'));
  const row = buildRow(lead, h, { last_name: 'i1', linkedin_url: 'i2' });
  assert.strictEqual(row[h.indexOf('Linkedin Url')], 'i2');
  assert.strictEqual(row[h.indexOf('linkedin_url')], 'https://li.com/sj'); // original preserved
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/sheet-rows.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// shared/outreach-core/campaigns/sheet-rows.js
// Two-block sheet layout. snake_case = reference block (Kobi's source of truth,
// never mapped). Title Case = Mailead block (the ONLY columns TaskMagic maps).
const REF_FIELDS = ['first_name', 'last_name', 'email', 'company_name', 'category', 'town', 'website', 'linkedin_url'];
const REOON_FIELDS = ['reoonStatus', 'reoonScore', 'reoonSafe'];
// canonical field -> Mailead field label
const MAILEAD_LABELS = { first_name: 'First Name', last_name: 'Last Name', email: 'Email', company_name: 'Company Name', linkedin_url: 'Linkedin Url', phone: 'Phone' };
const BASE_MAILEAD = ['first_name', 'last_name', 'email', 'company_name'];

function buildHeader(extraRefCols, carrierFields) {
  const maileadFields = [...BASE_MAILEAD];
  for (const c of carrierFields) if (!maileadFields.includes(c)) maileadFields.push(c);
  return [
    ...REF_FIELDS, ...REOON_FIELDS, ...extraRefCols,
    ...maileadFields.map(f => {
      if (!MAILEAD_LABELS[f]) throw new Error(`no Mailead label for carrier field '${f}'`);
      return MAILEAD_LABELS[f];
    }),
  ];
}

function buildRow(lead, header, insights) {
  const labelToField = Object.fromEntries(Object.entries(MAILEAD_LABELS).map(([f, l]) => [l, f]));
  return header.map(col => {
    if (labelToField[col]) { // Mailead block: injected insight wins, else real value
      const f = labelToField[col];
      return insights[f] !== undefined ? insights[f] : (lead[f] || '');
    }
    if (REF_FIELDS.includes(col) || REOON_FIELDS.includes(col)) return lead[col] || '';
    return (lead.ref && lead.ref[col]) || '';
  });
}

module.exports = { buildHeader, buildRow, MAILEAD_LABELS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/sheet-rows.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add shared/outreach-core/campaigns/sheet-rows.js tests/sheet-rows.test.js
git commit -m "feat(core): two-block sheet row builder (reference + Mailead carrier columns)"
```

---

### Task 9: Orchestrator (`send-batch.js`)

**Files:**
- Create: `send-batch.js` (repo root, like the other CLIs)
- Test: `tests/send-batch.test.js` (pipeline function, network + Reoon injected)

Design: the CLI is a thin wrapper around an exported `runBatch(opts, io)` where `io` bundles the injectable effects (`sheets`, `verifyEmails`, `readFile`, ledger path, registry path, `log`). Tests drive `runBatch` with fakes; the CLI passes the real ones.

- [ ] **Step 1: Write the failing test**

```js
// tests/send-batch.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os');
const { runBatch } = require('../send-batch');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sb-')); }

function makeIo(overrides = {}) {
  const dir = tmpDir();
  const registryFile = path.join(dir, 'campaign-sheets.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    'test-camp': { sheetId: 'SHEET1', sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET1', label: 'Test', carriers: { last_name: 'ask for a good {category} in {town}' } },
  }));
  const appended = [];
  return {
    dir,
    io: {
      registryFile,
      ledgerFile: path.join(dir, 'sent-ledger.txt'),
      sheets: {
        readColumn: async () => ['already@sheet.com'],
        appendRows: async (id, tab, header, rows) => { appended.push({ id, tab, header, rows }); return { appended: rows.length, wroteHeader: true }; },
        createSpreadsheet: async () => { throw new Error('not expected'); },
      },
      verifyEmails: async emails => emails.map(e => ({ email: e, status: e.startsWith('bad') ? 'invalid' : 'safe', score: 90, isSafeToSend: !e.startsWith('bad') })),
      naturalise: async leads => leads, // identity for tests
      log: () => {},
      ...overrides,
    },
    appended,
  };
}

const CSV = 'first_name,last_name,email,company,category,town\n' +
  'Ann,Ash,ann@x.com,Ann Ltd,accountant,Bramhall\n' +
  'Bob,Best,bad@x.com,Bob Ltd,solicitor,Poynton\n' +      // fails Reoon
  'Cat,Cole,already@sheet.com,Cat Ltd,accountant,Sale\n' + // already in sheet
  'Dan,Dew,ann@x.com,Dup Ltd,accountant,Bramhall\n';       // dupe in file

test('dry-run reports counts and appends nothing', async () => {
  const { io, appended, dir } = makeIo();
  const csvPath = path.join(dir, 'in.csv'); fs.writeFileSync(csvPath, CSV);
  const res = await runBatch({ csvPath, campaign: 'test-camp', dryRun: true }, io);
  assert.strictEqual(appended.length, 0);
  assert.strictEqual(res.wouldPush, 2); // ann + bad (verify NOT spent on dry-run)
  assert.strictEqual(res.skipped.length, 2); // sheet-dupe + file-dupe
  assert.strictEqual(fs.existsSync(io.ledgerFile), false);
});

test('live run verifies, drops bad, appends, records ledger', async () => {
  const { io, appended, dir } = makeIo();
  const csvPath = path.join(dir, 'in.csv'); fs.writeFileSync(csvPath, CSV);
  const res = await runBatch({ csvPath, campaign: 'test-camp' }, io);
  assert.strictEqual(res.pushed, 1); // only ann survives verify
  assert.strictEqual(appended.length, 1);
  const { header, rows } = appended[0];
  const get = (r, name) => r[header.indexOf(name)];
  assert.strictEqual(get(rows[0], 'last_name'), 'Ash'); // real surname preserved
  assert.strictEqual(get(rows[0], 'Last Name'), 'ask for a good accountant in Bramhall'); // insight injected
  const ledger = fs.readFileSync(io.ledgerFile, 'utf8').trim().split('\n');
  assert.deepStrictEqual(ledger, ['ann@x.com']);
});

test('skip-verify pushes pre-verified leads without spending credits', async () => {
  let verifyCalled = false;
  const { io, dir } = makeIo({ verifyEmails: async () => { verifyCalled = true; return []; } });
  const csvPath = path.join(dir, 'in.csv');
  fs.writeFileSync(csvPath, 'first_name,email,company,category,town\nAnn,ann2@x.com,A,accountant,Sale\n');
  const res = await runBatch({ csvPath, campaign: 'test-camp', skipVerify: true }, io);
  assert.strictEqual(verifyCalled, false);
  assert.strictEqual(res.pushed, 1);
});

test('limit caps processed rows', async () => {
  const { io, dir } = makeIo();
  const csvPath = path.join(dir, 'in.csv'); fs.writeFileSync(csvPath, CSV);
  const res = await runBatch({ csvPath, campaign: 'test-camp', limit: 1, dryRun: true }, io);
  assert.strictEqual(res.wouldPush, 1);
});

test('unknown campaign with no sheet triggers createSpreadsheet and registry save', async () => {
  const created = [];
  const { io, dir } = makeIo({
    sheets: {
      readColumn: async () => [],
      appendRows: async () => ({ appended: 1, wroteHeader: true }),
      createSpreadsheet: async (title, tab, share) => { created.push({ title, tab, share }); return { sheetId: 'NEW1', url: 'https://docs.google.com/spreadsheets/d/NEW1' }; },
    },
  });
  const csvPath = path.join(dir, 'in.csv');
  fs.writeFileSync(csvPath, 'first_name,email,company,category,town\nAnn,new@x.com,A,accountant,Sale\n');
  const res = await runBatch({ csvPath, campaign: 'brand-new', skipVerify: true }, io);
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].share, 'kobi@kobestarr.io');
  const reg = JSON.parse(fs.readFileSync(io.registryFile, 'utf8'));
  assert.strictEqual(reg['brand-new'].sheetId, 'NEW1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/send-batch.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```js
#!/usr/bin/env node
// send-batch.js — CSV -> normalise -> dedup -> Reoon verify -> naturalise ->
// compose insights -> append to the campaign's Google Sheet (tab ToSend) -> ledger.
// Spec: docs/superpowers/specs/2026-07-02-send-batch-pipeline-design.md
//
// Usage: node send-batch.js <csv> --campaign <key> [--dry-run] [--limit N] [--skip-verify]
const fs = require('fs'), path = require('path');
const { parseCSV } = require('./shared/outreach-core/csv/csv-util');
const { normalise } = require('./shared/outreach-core/csv/normalise');
const { dedupe } = require('./shared/outreach-core/csv/dedup');
const { readLedger, appendLedger } = require('./shared/outreach-core/csv/ledger');
const { getCampaign, saveCampaign } = require('./shared/outreach-core/campaigns/campaign-registry');
const { buildHeader, buildRow } = require('./shared/outreach-core/campaigns/sheet-rows');
const { composeInsights } = require('./shared/outreach-core/content-generation/insight-composer');

const TAB = 'ToSend';
const SHARE_WITH = 'kobi@kobestarr.io';
const BAD_STATUSES = new Set(['invalid', 'disabled', 'disposable', 'spamtrap']); // project rule: keep risky

async function runBatch(opts, io) {
  const { csvPath, campaign, dryRun = false, limit = 0, skipVerify = false } = opts;
  const log = io.log || console.log;

  // 1. Load + normalise
  const rows = parseCSV(io.readFile ? io.readFile(csvPath) : fs.readFileSync(csvPath, 'utf8'));
  const { leads: allLeads, skipped: badRows } = normalise(rows);
  const leads = limit > 0 ? allLeads.slice(0, limit) : allLeads;

  // 2. Campaign entry (auto-create sheet if new)
  let entry = getCampaign(io.registryFile, campaign);
  if (!entry) {
    if (dryRun) {
      log(`DRY-RUN: campaign '${campaign}' has no sheet yet; a live run would create + share one.`);
      entry = { sheetId: null, sheetUrl: '(would be created)', carriers: {} };
    } else {
      let createdMeta;
      try {
        createdMeta = await io.sheets.createSpreadsheet(`Outreach ToSend — ${campaign}`, TAB, SHARE_WITH);
      } catch (e) {
        throw new Error(
          `Could not auto-create a sheet for '${campaign}' (${e.message}).\n` +
          `Manual fallback: create a blank Google Sheet with a tab named '${TAB}', share it (Editor) with the service account, then register it:\n` +
          `  node send-batch.js --register ${campaign} <sheet URL>`);
      }
      entry = { sheetId: createdMeta.sheetId, sheetUrl: createdMeta.url, label: campaign, carriers: {} };
      saveCampaign(io.registryFile, campaign, entry);
      log(`Created sheet for '${campaign}': ${createdMeta.url}`);
    }
  }

  // 3. Dedup: file + ledger + target sheet
  const ledgerSet = readLedger(io.ledgerFile);
  const sheetEmails = entry.sheetId ? await io.sheets.readColumn(entry.sheetId, TAB, 'email') : [];
  const { kept, skipped: dupes } = dedupe(leads, ledgerSet, new Set(sheetEmails));
  const skipped = [...badRows, ...dupes];

  if (dryRun) {
    log(`DRY-RUN [${campaign}] input:${leads.length} would-verify:${skipVerify ? 0 : kept.length} would-push(before verify):${kept.length}`);
    for (const s of dupes.slice(0, 10)) log(`  skip ${s.email} (${s.reason})`);
    if (kept[0]) {
      const insights = composeInsights(kept[0], entry.carriers || {});
      log('  sample insights: ' + JSON.stringify(insights));
    }
    return { wouldPush: kept.length, skipped, pushed: 0 };
  }

  // 4. Verify (Reoon) unless pre-verified
  let survivors = kept;
  if (!skipVerify && kept.length) {
    const results = await io.verifyEmails(kept.map(l => l.email));
    const byEmail = Object.fromEntries(results.map(r => [String(r.email).toLowerCase(), r]));
    survivors = [];
    for (const lead of kept) {
      const r = byEmail[lead.email];
      if (r && BAD_STATUSES.has(r.status)) { skipped.push({ email: lead.email, reason: 'reoon_' + r.status }); continue; }
      if (r) { lead.reoonStatus = r.status; lead.reoonScore = String(r.score ?? ''); lead.reoonSafe = r.isSafeToSend ? '1' : '0'; }
      survivors.push(lead);
    }
  }

  // 5. Naturalise company names (batched; identity fallback)
  if (io.naturalise) survivors = await io.naturalise(survivors);

  // 6. Compose insights + build rows
  const extraRefCols = [...new Set(survivors.flatMap(l => Object.keys(l.ref || {})))];
  const carrierFields = Object.keys(entry.carriers || {});
  const header = buildHeader(extraRefCols, carrierFields);
  const outRows = survivors.map(l => buildRow(l, header, composeInsights(l, entry.carriers || {})));

  // 7. Append + ledger + report
  let pushed = 0;
  if (outRows.length) {
    const res = await io.sheets.appendRows(entry.sheetId, TAB, header, outRows);
    pushed = res.appended;
    appendLedger(io.ledgerFile, survivors.map(l => l.email));
  }
  log(`[${campaign}] pushed:${pushed} skipped:${skipped.length} sheet: ${entry.sheetUrl}`);
  return { pushed, skipped, sheetUrl: entry.sheetUrl };
}

module.exports = { runBatch };

// ---- CLI ----
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const flag = n => args.includes('--' + n);
    const val = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };

    const registryFile = path.join(__dirname, 'config/campaign-sheets.json');
    // --register <key> <sheet URL>: manual fallback for blocked auto-create
    if (flag('register')) {
      const i = args.indexOf('--register');
      const [key, url] = [args[i + 1], args[i + 2]];
      const { extractSheetId } = require('./shared/outreach-core/sheets/sheets-client');
      if (!key || !url) { console.error('Usage: node send-batch.js --register <campaign> <sheet URL>'); process.exit(2); }
      saveCampaign(registryFile, key, { sheetId: extractSheetId(url), sheetUrl: url, label: key, carriers: (getCampaign(registryFile, key) || {}).carriers || {} });
      console.log(`Registered '${key}'.`); return;
    }

    const csvPath = args.find(a => !a.startsWith('--') && a.endsWith('.csv'));
    const campaign = val('campaign');
    if (!csvPath || !fs.existsSync(csvPath) || !campaign) {
      console.error('Usage: node send-batch.js <csv> --campaign <key> [--dry-run] [--limit N] [--skip-verify]');
      process.exit(2);
    }

    const sheets = require('./shared/outreach-core/sheets/sheets-client');
    const { verifyEmails, getQuotaRemaining } = require('./shared/outreach-core/email-verification/reoon-verifier');
    const io = {
      registryFile,
      ledgerFile: path.join(__dirname, 'data/sent-ledger.txt'),
      sheets,
      // zip input emails back in: do not assume reoon results carry .email
      verifyEmails: async emails => (await verifyEmails(emails)).map((r, i) => ({ ...r, email: r.email || emails[i] })),
      naturalise: null, // v1: company_full/company_name from the CSV is already clean for KSD batches
      log: console.log,
    };
    const res = await runBatch({ csvPath, campaign, dryRun: flag('dry-run'), limit: parseInt(val('limit') || '0', 10), skipVerify: flag('skip-verify') }, io);
    if (!flag('dry-run') && !flag('skip-verify')) console.log('Reoon quota remaining today:', getQuotaRemaining());
  })().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
}
```

Note on `naturalise: null`: the 816 KSD file already carries naturalised `company` (from `prep-proservices-batch.js`). Wiring the Haiku naturaliser in is deliberately deferred; the hook exists in `runBatch`, tests cover it via the identity fake, and raw-CSV campaigns can add it later without touching the pipeline.

- [ ] **Step 4: Run tests (all suites) to verify they pass**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/`
Expected: PASS (all files: csv-util 5, sheets-client 5, normalise 4, dedup 4, ledger 2, insight-composer 4, campaign-registry 3, sheet-rows 4, send-batch 5)

- [ ] **Step 5: Commit**

```bash
git add send-batch.js tests/send-batch.test.js
git commit -m "feat: send-batch orchestrator (normalise, dedup, verify, insights, sheet append, ledger)"
```

---

### Task 10: Point `push-to-sheet.js` at the shared client (DRY)

**Files:**
- Modify: `push-to-sheet.js` (replace lines 9-23 JWT code and the inline append logic with `sheets-client` calls; keep the CLI contract identical)

- [ ] **Step 1: Rewrite push-to-sheet.js as a thin wrapper**

```js
#!/usr/bin/env node
// Append a Mailead-ready CSV to the ToSend staging sheet (the TaskMagic -> Mailead
// pickup point). Thin CLI over shared/outreach-core/sheets/sheets-client.js.
// Usage: node push-to-sheet.js <sheet URL or ID> <csv path> [--tab ToSend]
const fs = require('fs');
const { parseCSV } = require('./shared/outreach-core/csv/csv-util');
const { extractSheetId, appendRows } = require('./shared/outreach-core/sheets/sheets-client');

(async () => {
  const args = process.argv.slice(2);
  const positional = args.filter(a => !a.startsWith('--'));
  const tab = (() => { const i = args.indexOf('--tab'); return i >= 0 ? args[i + 1] : 'ToSend'; })();
  const sheetId = extractSheetId(positional[0] || '');
  const csvArg = positional[1];
  if (!sheetId || !csvArg || !fs.existsSync(csvArg)) {
    console.error('Usage: node push-to-sheet.js <sheet URL or ID> <csv path> [--tab ToSend]');
    process.exit(2);
  }
  const rows = parseCSV(fs.readFileSync(csvArg, 'utf8')).filter(r => r.length > 1);
  const res = await appendRows(sheetId, tab, rows[0], rows.slice(1));
  console.log(`OK — appended ${res.appended} rows to '${tab}'${res.wroteHeader ? ' (with header)' : ''}.`);
  console.log('URL: https://docs.google.com/spreadsheets/d/' + sheetId);
})().catch(e => { console.error('ERROR:', e.message); process.exit(3); });
```

- [ ] **Step 2: Run all tests to confirm nothing broke**

Run: `PATH="/opt/homebrew/bin:$PATH" node --test tests/`
Expected: PASS (same counts as Task 9 Step 4)

- [ ] **Step 3: Smoke-check the CLI usage error path**

Run: `PATH="/opt/homebrew/bin:$PATH" node push-to-sheet.js`
Expected: prints usage, exit code 2.

- [ ] **Step 4: Commit**

```bash
git add push-to-sheet.js
git commit -m "refactor: push-to-sheet uses shared sheets-client (behaviour unchanged)"
```

---

### Task 11: Fix "The Netherlands" GEO bug (found during July-273 investigation)

**Files:**
- Modify: `process-funded-startups.js:33` (the `GEO` set)

- [ ] **Step 1: Add the alias**

In `process-funded-startups.js` line 33, add `'The Netherlands'` to the GEO set:

```js
const GEO = new Set(['United Kingdom','United States','Canada','Australia','New Zealand','Ireland','Netherlands','The Netherlands','Sweden','Denmark','Norway','Finland','Switzerland','Germany','Belgium','France','Spain','Italy']);
```

- [ ] **Step 2: Verify the 10 Dutch leads now pass**

Run:
```bash
PATH="/opt/homebrew/bin:$PATH" node -e "
const { parseCSV } = require('./shared/outreach-core/csv/csv-util');
const fs = require('fs');
const rows = parseCSV(fs.readFileSync('exports/funded-drop-NEW-2026-07-01.csv','utf8'));
const H = rows[0]; const col=(r,n)=>r[H.indexOf(n)]||'';
console.log('Dutch rows:', rows.slice(1).filter(r=>col(r,'Country')==='The Netherlands').length);
"
```
Expected: `Dutch rows: 10`

- [ ] **Step 3: Commit**

```bash
git add process-funded-startups.js
git commit -m "fix(funded): accept 'The Netherlands' in ICP geo filter (10 leads were dropped)"
```

---

### Task 12: Register the `ksd-pro-services` campaign + insight template

**Files:**
- Modify: `config/campaign-sheets.json` (via the pipeline's auto-create, or `--register` fallback)
- Create: `docs/insight-templates.md` (the auditable copy source)

The insight template is lifted verbatim from the already-cold-reader-audited pilot sequence (`exports/pilot-ksd-pro-services-sequence.md`, audit done 2026-06-22). The Email-1 sentence "I had a quick look and saw {{company_name}} doesn't really come up in AI Search such as Google AI Overview or ChatGPT when people ask for a good {{category}} in {{town}}." becomes: template copy references `{{company_name}} {{last_name}}` and the carrier supplies the rest.

- [ ] **Step 1: Write `docs/insight-templates.md`**

```markdown
# Carrier-field insight templates

Deterministic templates for send-batch carrier fields (spec: 2026-07-02-send-batch-pipeline-design.md).
Copy provenance: pilot KSD pro-services sequence, cold-reader audit 2026-06-22.
Rule: no em dashes; category renders lowercase; template changes require a fresh cold-reader pass.

## ksd-pro-services

- Carrier `last_name` (renders after "{{company_name}}" in the email body):
  `doesn't really come up in AI Search such as Google AI Overview or ChatGPT when people ask for a good {category} in {town}`
- Email body line: `I had a quick look and saw {{company_name}} {{last_name}}.`
  -> "I had a quick look and saw Bevan & Co doesn't really come up in AI Search such as
     Google AI Overview or ChatGPT when people ask for a good accountant in Bramhall."
```

- [ ] **Step 2: Dry-run to trigger campaign setup preview**

Run:
```bash
PATH="/opt/homebrew/bin:$PATH" node send-batch.js exports/ksd-proservices-batch2-2026-06-24-safe816.csv --campaign ksd-pro-services --dry-run
```
Expected: `DRY-RUN: campaign 'ksd-pro-services' has no sheet yet...` plus input/dedup counts (816 input; ledger is empty at this point so would-push ≈ 816).

- [ ] **Step 3: Create the sheet live (2-row limit, skip-verify) — this also exercises auto-create**

Run:
```bash
PATH="/opt/homebrew/bin:$PATH" node send-batch.js exports/ksd-proservices-batch2-2026-06-24-safe816.csv --campaign ksd-pro-services --limit 2 --skip-verify
```
Expected: `Created sheet for 'ksd-pro-services': https://docs.google.com/spreadsheets/d/...` then `pushed:2`. **If auto-create fails** (Workspace policy): follow the printed fallback (create sheet manually, share Editor with `outreach-sheets@kobestarr-leadpipe.iam.gserviceaccount.com`, run `--register`), then re-run this step.

Then **open the sheet** (`open <url>`) and eyeball: snake_case reference columns hold the real values, `Last Name` column holds the composed insight, real surname intact.

- [ ] **Step 4: Add the carrier template to the registry entry**

Edit `config/campaign-sheets.json` — the `ksd-pro-services` entry gets:

```json
"carriers": {
  "last_name": "doesn't really come up in AI Search such as Google AI Overview or ChatGPT when people ask for a good {category} in {town}"
}
```

(The auto-create wrote `carriers: {}`; this fills it. The 2 test rows in Step 3 predate the carrier and will show plain surnames in `Last Name` — fine, they are the TaskMagic 2-lead test rows.)

Re-run Step 3's command with `--limit 4` — the 2 new rows (rows 3-4 of the CSV; the first 2 dedupe against the sheet) must show the composed insight in `Last Name`.

- [ ] **Step 5: Commit**

```bash
git add config/campaign-sheets.json docs/insight-templates.md
git commit -m "feat(config): ksd-pro-services campaign registered with last_name insight carrier"
```

---

### Task 13: Seed the sent-ledger (CHECKPOINT — needs Kobi confirmation)

**Files:**
- Create: `seed-ledger.js` (one-off, kept for re-use)
- Modify: `data/sent-ledger.txt`

Candidate already-sent/loaded files (from handover + memory — **confirm with Kobi before seeding**, this is the resend-protection backbone):
- `exports/pilot-mailead-2026-06-16.csv` and `exports/pilot-mailead-2026-06-22.csv` (pilot loaded 2026-06-22)
- `exports/ToSend-leadbyte-funded-clean.csv` (LeadByte funded, loaded 2026-06-30?)
- `exports/ufh-*-mailead-2026-02-22-verified.csv` (UFH, sent Feb — different sender but same-human protection)
- Any `MAILEAD-Funded-Daily-*.csv` batches Kobi has actually loaded
- Lemlist press sends (`ufh-journalists`)

- [ ] **Step 1: Write `seed-ledger.js`**

```js
#!/usr/bin/env node
// Seed data/sent-ledger.txt from CSVs that were ALREADY loaded into a sender.
// Usage: node seed-ledger.js <csv> [<csv> ...]   (email column found by /email/i)
const fs = require('fs'), path = require('path');
const { parseCSV } = require('./shared/outreach-core/csv/csv-util');
const { appendLedger } = require('./shared/outreach-core/csv/ledger');

const files = process.argv.slice(2);
if (!files.length) { console.error('Usage: node seed-ledger.js <csv> [...]'); process.exit(2); }
let total = 0;
for (const f of files) {
  const rows = parseCSV(fs.readFileSync(f, 'utf8'));
  const idx = rows[0].findIndex(h => /email/i.test(h));
  if (idx < 0) { console.error(`SKIP ${f}: no email column`); continue; }
  const emails = rows.slice(1).map(r => r[idx]).filter(e => e && e.includes('@'));
  const added = appendLedger(path.join(__dirname, 'data/sent-ledger.txt'), emails);
  console.log(`${f}: ${added} new emails into ledger`);
  total += added;
}
console.log(`TOTAL added: ${total}`);
```

- [ ] **Step 2: CHECKPOINT — ask Kobi which files were genuinely loaded/sent**, then run e.g.:

```bash
PATH="/opt/homebrew/bin:$PATH" node seed-ledger.js exports/pilot-mailead-2026-06-22.csv exports/ToSend-leadbyte-funded-clean.csv
```
Expected: per-file counts + total.

- [ ] **Step 3: Commit**

```bash
git add seed-ledger.js data/sent-ledger.txt
git commit -m "feat: seed sent-ledger from confirmed already-loaded exports"
```

---

### Task 14: Full 816 live run + TaskMagic last mile (CHECKPOINT — Kobi in the loop)

No new code. Sequence:

- [ ] **Step 1: Dry-run the full 816** (post-ledger-seed, so counts are honest):

```bash
PATH="/opt/homebrew/bin:$PATH" node send-batch.js exports/ksd-proservices-batch2-2026-06-24-safe816.csv --campaign ksd-pro-services --dry-run
```
Expected: would-push ≈ 816 minus ledger/sheet overlaps (the 4 test rows dedupe out). Review the sample insight line.

- [ ] **Step 2: Live push with `--skip-verify`** (file was Reoon-verified 2026-06-28; re-verifying 800+ burns ~40% of the daily quota for nothing):

```bash
PATH="/opt/homebrew/bin:$PATH" node send-batch.js exports/ksd-proservices-batch2-2026-06-24-safe816.csv --campaign ksd-pro-services --skip-verify
```
Expected: `pushed: ~812`, ledger grows by the same, sheet link printed. Open the sheet and spot-check 5 rows.

- [ ] **Step 3: CHECKPOINT — build the TaskMagic flow (Kobi + assistant, TaskMagic UI/MCP).** Per `docs/mailead-taskmagic-SOP.md` Part C: trigger on new rows in this sheet's `ToSend` tab → create NEW Mailead campaign `ksd-pro-services-<YYYY-MM-DD>` → map ONLY the Title Case columns (`First Name`→First Name, `Last Name`→Last Name, `Email`→Email, `Company Name`→Company Name) → notify WhatsApp with lead count. **First validation = the 2-lead test rows** (Task 12 Step 3 rows): run the flow, open Mailead, confirm both leads landed, confirm which standard fields the app-action actually exposed (this locks the legal carrier list; update `MAILEAD_LABELS` in `sheet-rows.js` + spec if it differs).

- [ ] **Step 4: Adapt the sequence copy in Mailead** to reference `{{last_name}}` for the insight (per `docs/insight-templates.md`), subject unchanged (already audited). First-touch scheduling: Mon-Thu only (house rule).

- [ ] **Step 5: Update docs + memory + commit.** Update `docs/NEXT-STEPS.md` (ToSend sheet now exists; daily-engine wiring = next), append the run log to `data/`, and write the project memory entry for the carrier-field mechanism.

```bash
git add docs/NEXT-STEPS.md data/
git commit -m "docs: send-batch live, ksd-pro-services flowing via ToSend sheet + TaskMagic"
```

---

## Execution order & dependencies

Tasks 1→9 are strictly ordered (each module feeds the next; orchestrator last). Task 10 (refactor) and Task 11 (Netherlands fix) can happen any time after Tasks 1-2. Tasks 12→14 are sequential and end in Kobi-in-the-loop checkpoints (sheet eyeball, ledger confirmation, TaskMagic 2-lead test).

## Out of scope (per spec)

LLM insights, per-row routing, businesses.db dedup, programmatic TaskMagic flow creation, daily-funded-engine wiring (follow-up: point `daily-funded-batch.sh` at `send-batch.js --campaign funded-daily --skip-verify` once this is proven).
