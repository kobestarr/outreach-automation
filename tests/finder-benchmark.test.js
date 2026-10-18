// tests/finder-benchmark.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os');
const { runBenchmark, parseBenchArgs } = require('../scripts/finder-benchmark');

const H = ['company_name', 'company_number', 'website', 'maps_match', 'owner_first', 'owner_last', 'email', 'email_rule', 'emails_scraped'];
const R = (o) => ({ company_name: 'ACME LIMITED', company_number: '1', website: 'https://acme.co.uk', maps_match: 'yes', owner_first: 'Ann', owner_last: 'Ash', email: '', email_rule: 'none', emails_scraped: '', ...o });
const ROWS = [
  R({ company_number: '1', email: 'ann@acme.co.uk', email_rule: 'owner-match', emails_scraped: 'ann@acme.co.uk' }),          // already has an owner address: not for the finder
  R({ company_number: '2', website: 'https://b.co.uk', email: 'info@b.co.uk', email_rule: 'role', emails_scraped: 'info@b.co.uk' }), // finder
  R({ company_number: '3', website: 'https://c.co.uk', maps_match: 'probable', email: 'x@gmail.com', email_rule: 'owner-guess-verified' }), // finder
  R({ company_number: '4', website: 'https://d.co.uk', maps_match: 'check' }),                                                    // not confirmed
  R({ company_number: '5', website: '', email_rule: 'no-website' }),                                                              // no site
  R({ company_number: '6', website: 'https://f.co.uk', owner_first: '' }),                                                        // no owner
];
const toCsv = rows => [H.join(','), ...rows.map(r => H.map(h => `"${r[h]}"`).join(','))].join('\n');

function setup(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-'));
  const inp = path.join(dir, 'final.csv'); fs.writeFileSync(inp, toCsv(ROWS));
  const out = path.join(dir, 'bench.csv');
  const logs = [];
  const calls = { open: 0, estimate: [] };
  const deps = {
    log: m => logs.push(m),
    estimate: rows => { calls.estimate.push(rows); return { rows: rows.length, people: rows.length, companyOnly: 0, badInput: 0, worstCase: rows.length * 40, samples: [] }; },
    openFinder: async () => { calls.open++; return { findMany: async rows => ({ results: rows.map(r => (r.owner_first === 'Ann' ? { status: 'found', email: `ann@${r.website.replace('https://', '')}`, confidence: 'high', suggested_email: '' } : { status: 'not_found', email: '' })), summary: { reoon_used: 6, icypeas_used: 0 } }), close() {} }; },
    now: () => new Date('2026-10-18T10:00:00Z'),
    ...extra,
  };
  return { dir, inp, out, logs, calls, deps };
}

test('dry (default): lists exactly the rows the enrich gate would send, prints worst-case credits, never opens the finder', async () => {
  const t = setup();
  const r = await runBenchmark({ inFile: t.inp, out: t.out, live: false }, t.deps);
  assert.deepStrictEqual(r.selected.map(x => x.company_number), ['2', '3']);
  assert.strictEqual(r.worstCase, 80);
  assert.strictEqual(t.calls.open, 0);
  assert.strictEqual(fs.existsSync(t.out), false, 'nothing is written without --live');
  const text = t.logs.join('\n');
  assert.match(text, /2 of 6/);
  assert.match(text, /80/);
  assert.match(text, /b\.co\.uk/);
  assert.match(text, /Dry run/i);
  assert.match(text, /--live/);
});

test('the estimate is called with finder-shaped rows only', async () => {
  const t = setup();
  await runBenchmark({ inFile: t.inp, out: t.out, live: false }, t.deps);
  assert.deepStrictEqual(Object.keys(t.calls.estimate[0][0]).sort(), ['company_name', 'owner_first', 'owner_last', 'website']);
});

test('refuses an --out that already exists, in both modes (the benchmark never overwrites an earlier run)', async () => {
  const t = setup();
  fs.writeFileSync(t.out, 'old');
  await assert.rejects(runBenchmark({ inFile: t.inp, out: t.out, live: false }, t.deps), /already exists/);
  await assert.rejects(runBenchmark({ inFile: t.inp, out: t.out, live: true }, t.deps), /already exists/);
  assert.strictEqual(fs.readFileSync(t.out, 'utf8'), 'old');
  assert.strictEqual(t.calls.open, 0);
});

test('--live runs only the selected rows through enrichRows, reusing scraped emails (no re-scrape), and writes a comparison', async () => {
  const t = setup();
  const r = await runBenchmark({ inFile: t.inp, out: t.out, live: true }, t.deps);
  assert.strictEqual(t.calls.open, 1);
  assert.strictEqual(r.rows.length, 2);
  const byNo = Object.fromEntries(r.rows.map(x => [x.company_number, x]));
  assert.strictEqual(byNo['2'].email, 'ann@b.co.uk');
  assert.strictEqual(byNo['2'].email_status, 'found');
  assert.strictEqual(byNo['2'].email_fallback, 'info@b.co.uk');
  assert.ok(fs.existsSync(t.out));
  const csv = fs.readFileSync(t.out, 'utf8');
  assert.match(csv, /email_status/);
  assert.ok(fs.existsSync(t.out + '.jsonl'));
  const text = t.logs.join('\n');
  assert.match(text, /info@b\.co\.uk/);
  assert.match(text, /ann@b\.co\.uk/);
  assert.match(text, /Reoon credits used 6/);
});

test('nothing selected: says so and never opens the finder even with --live', async () => {
  const t = setup();
  fs.writeFileSync(t.inp, toCsv([ROWS[0]]));
  const r = await runBenchmark({ inFile: t.inp, out: t.out, live: true }, t.deps);
  assert.strictEqual(r.selected.length, 0);
  assert.strictEqual(t.calls.open, 0);
});

test('args: --out is required, --live is off by default, numbers are strict', () => {
  assert.throws(() => parseBenchArgs(['node', 'x', 'in.csv']), /--out/);
  const a = parseBenchArgs(['node', 'x', 'in.csv', '--out', 'o.csv']);
  assert.strictEqual(a.live, false);
  assert.strictEqual(a.maxIcypeas, 0);
  assert.strictEqual(a.maxCredits, undefined);
  const b = parseBenchArgs(['node', 'x', 'in.csv', '--out', 'o.csv', '--live', '--max-credits', '200']);
  assert.strictEqual(b.live, true);
  assert.strictEqual(b.maxCredits, 200);
  assert.throws(() => parseBenchArgs(['node', 'x', 'in.csv', '--out', 'o.csv', '--max-credits', 'x']), /max-credits/);
});
