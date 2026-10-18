// tests/enrich-owner-emails.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { enrichRows, parseEnrichArgs, loadRecords, FINAL, OUT_COLUMNS } = require('../enrich-owner-emails');

const row = (o = {}) => ({
  company_name: 'ACME ROOFING LIMITED', company_number: '0001', website: 'https://acme.co.uk', maps_match: 'yes',
  owner_first: 'Anthony', owner_last: 'Millar', ...o,
});

// A fake finder whose answers are keyed by owner_first so each test can steer it.
function fakeFinder(answers = {}, { summary = {}, throws = null } = {}) {
  const calls = [];
  const f = {
    calls, closed: 0,
    async findMany(rows, opts = {}) {
      calls.push({ rows, opts });
      if (throws) throw throws;
      const results = rows.map((r, i) => {
        const a = answers[r.owner_first] || { status: 'not_found', email: '', confidence: '' };
        const out = { suggested_email: '', source: '', reoon_credits: 0, icypeas_credits: 0, ...a };
        if (opts.onResult) opts.onResult(i, r, out);
        return out;
      });
      return { results, summary: { reoon_used: 3, icypeas_used: 0, by_status: {}, retried: 0, ...summary } };
    },
    close() { f.closed++; },
  };
  return f;
}

function makeIo(over = {}) {
  const records = [], appended = [];
  const io = {
    scrape: async () => ({ emails: [] }),
    records, appended,
    appendRecord: r => { appended.push(r); },
    now: () => new Date('2026-10-18T10:00:00Z'),
    log: () => {},
    finder: fakeFinder(),
    ...over,
  };
  io.openFinder = over.openFinder || (async () => io.finder);
  return io;
}

test('owner-match: the finder is never opened or called', async () => {
  const io = makeIo({ scrape: async () => ({ emails: ['tony@acme.co.uk'] }) });
  const { rows } = await enrichRows([row()], io);
  assert.strictEqual(io.finder.calls.length, 0);
  assert.strictEqual(rows[0].email, 'tony@acme.co.uk');
  assert.strictEqual(rows[0].email_status, 'scraped_owner');
  assert.strictEqual(rows[0].email_source, 'scraped');
  assert.strictEqual(rows[0].email_rule, 'owner-match');
});

test('owner-freemail also skips the finder', async () => {
  const io = makeIo({ scrape: async () => ({ emails: ['tony.millar@gmail.com'] }) });
  const { rows } = await enrichRows([row()], io);
  assert.strictEqual(io.finder.calls.length, 0);
  assert.strictEqual(rows[0].email_rule, 'owner-freemail');
});

test('everything else goes to ONE findMany call (scrape first, then finder) and the answer is chosen by status', async () => {
  const order = [];
  const io = makeIo({
    scrape: async w => { order.push('scrape ' + w); return { emails: w.includes('b.co') ? ['info@b.co.uk'] : [] }; },
    finder: Object.assign(fakeFinder({ Anthony: { status: 'found', email: 'anthony@acme.co.uk', confidence: 'high', source: 'reoon' }, Bea: { status: 'found_generic', email: 'hello@b.co.uk', confidence: 'medium' } }), {}),
  });
  const orig = io.finder.findMany.bind(io.finder);
  io.finder.findMany = async (...a) => { order.push('findMany'); return orig(...a); };
  const { rows } = await enrichRows([row(), row({ company_number: '0002', website: 'https://b.co.uk', owner_first: 'Bea' })], io);
  assert.deepStrictEqual(order, ['scrape https://acme.co.uk', 'scrape https://b.co.uk', 'findMany']);
  assert.strictEqual(io.finder.calls.length, 1);
  assert.strictEqual(io.finder.calls[0].rows.length, 2);
  assert.deepStrictEqual(Object.keys(io.finder.calls[0].rows[0]).sort(), ['company_name', 'owner_first', 'owner_last', 'website']);
  assert.strictEqual(rows[0].email, 'anthony@acme.co.uk');
  assert.strictEqual(rows[0].email_rule, 'finder-found');
  assert.strictEqual(rows[0].email_source, 'finder');
  assert.strictEqual(rows[0].email_checked_at, '2026-10-18T10:00:00.000Z');
  // scraped role beats the finder generic inbox
  assert.strictEqual(rows[1].email, 'info@b.co.uk');
  assert.strictEqual(rows[1].email_status, 'scraped_role');
  assert.strictEqual(io.finder.closed, 1);
});

test('the finder is called only with an owner name AND maps_match yes or probable', async () => {
  const io = makeIo();
  await enrichRows([
    row({ company_number: '1' }),
    row({ company_number: '2', maps_match: 'probable', owner_first: 'Pat' }),
    row({ company_number: '3', maps_match: 'check', owner_first: 'Chk' }),
    row({ company_number: '4', maps_match: 'no', owner_first: 'No' }),
    row({ company_number: '5', maps_match: '', owner_first: 'Blank' }),
    row({ company_number: '6', owner_first: '', owner_last: '' }),
    row({ company_number: '7', website: '', owner_first: 'NoSite' }),
  ], io);
  assert.deepStrictEqual(io.finder.calls[0].rows.map(r => r.owner_first), ['Anthony', 'Pat']);
});

test("maps_match 'check' is still scraped but never sent to the finder", async () => {
  const scraped = [];
  const io = makeIo({ scrape: async w => { scraped.push(w); return { emails: ['info@acme.co.uk'] }; } });
  const { rows } = await enrichRows([row({ maps_match: 'check' })], io);
  assert.strictEqual(scraped.length, 1);
  assert.strictEqual(io.finder.calls.length, 0);
  assert.strictEqual(rows[0].email_status, 'scraped_role');
});

test('no rows need the finder: it is never opened', async () => {
  let opened = 0;
  const io = makeIo({ openFinder: async () => { opened++; return fakeFinder(); } });
  await enrichRows([row({ maps_match: 'no' })], io);
  assert.strictEqual(opened, 0);
});

test('--no-guess skips the finder entirely, scraped picks stay', async () => {
  let opened = 0;
  const io = makeIo({ noGuess: true, openFinder: async () => { opened++; return fakeFinder(); }, scrape: async () => ({ emails: ['info@acme.co.uk'] }) });
  const { rows } = await enrichRows([row()], io);
  assert.strictEqual(opened, 0);
  assert.strictEqual(rows[0].email, 'info@acme.co.uk');
});

test('a row with nothing scraped and no finder run reports not_checked and an empty email', async () => {
  const io = makeIo({ noGuess: true });
  const { rows } = await enrichRows([row()], io);
  assert.strictEqual(rows[0].email, '');
  assert.strictEqual(rows[0].email_status, 'not_checked');
});

test('scrape records are written with v:2 and resume skips already scraped rows', async () => {
  let scrapes = 0;
  const io = makeIo({ scrape: async () => { scrapes++; return { emails: ['info@acme.co.uk'] }; } });
  await enrichRows([row()], io);
  const scrapeRec = io.appended.find(r => r.kind === 'scrape');
  assert.strictEqual(scrapeRec.v, 2);
  assert.ok(io.appended.every(r => r.v === 2));
  const io2 = makeIo({ records: io.appended, scrape: async () => { scrapes++; return { emails: [] }; } });
  await enrichRows([row()], io2);
  assert.strictEqual(scrapes, 1);
});

test('resume: FINAL finder results are reused and not re-asked', async () => {
  const io = makeIo({ finder: fakeFinder({ Anthony: { status: 'found', email: 'anthony@acme.co.uk', confidence: 'high' } }) });
  await enrichRows([row()], io);
  const io2 = makeIo({ records: io.appended });
  const { rows } = await enrichRows([row()], io2);
  assert.strictEqual(io2.finder.calls.length, 0);
  assert.strictEqual(rows[0].email, 'anthony@acme.co.uk');
  assert.strictEqual(rows[0].email_checked_at, '2026-10-18T10:00:00.000Z');
});

test('resume: error, skipped, not_run and retry_later re-run; the rest of the batch is not repeated', async () => {
  for (const status of ['error', 'skipped', 'not_run', 'retry_later']) {
    const io = makeIo({ finder: fakeFinder({ Anthony: { status, email: '', confidence: '' }, Bea: { status: 'not_found', email: '' } }) });
    await enrichRows([row(), row({ company_number: '2', owner_first: 'Bea', website: 'https://b.co.uk' })], io);
    const io2 = makeIo({ records: io.appended, finder: fakeFinder({ Anthony: { status: 'found', email: 'anthony@acme.co.uk', confidence: 'high' } }) });
    const { rows } = await enrichRows([row(), row({ company_number: '2', owner_first: 'Bea', website: 'https://b.co.uk' })], io2);
    assert.deepStrictEqual(io2.finder.calls[0].rows.map(r => r.owner_first), ['Anthony'], status);
    assert.strictEqual(rows[0].email, 'anthony@acme.co.uk', status);
    assert.strictEqual(rows[1].email_status, 'not_found');
  }
});

test('the last record for a row wins (a retry supersedes the first attempt)', () => {
  const recs = [
    { v: 2, kind: 'finder', key: 'a', result: { status: 'retry_later' } },
    { v: 2, kind: 'finder', key: 'a', result: { status: 'found', email: 'x@y.co.uk' } },
    { v: 2, kind: 'finder', key: 'b', result: { status: 'found', email: 'b@y.co.uk' } },
    { v: 2, kind: 'finder', key: 'b', result: { status: 'error' } },
  ];
  const { finder } = loadRecords(recs);
  assert.strictEqual(finder.get('a').result.status, 'found');
  assert.strictEqual(finder.has('b'), false);
});

test('old v1 records (no v field) are ignored, never trusted', () => {
  const { scrape, finder, ignored } = loadRecords([{ company_number: '1', email: 'old@guess.co.uk', rule: 'owner-guess-verified' }, { v: 1, kind: 'scrape', key: '1' }]);
  assert.strictEqual(scrape.size, 0);
  assert.strictEqual(finder.size, 0);
  assert.strictEqual(ignored, 2);
});

test('FINAL is exactly the finder answers, not the errors', () => {
  for (const s of ['found', 'found_flagged', 'found_generic', 'catch_all_found', 'icypeas_found', 'catch_all_unresolved', 'unverifiable', 'left_company', 'not_found', 'no_mx', 'suppressed', 'bad_input']) assert.ok(FINAL.has(s), s);
  for (const s of ['error', 'skipped', 'not_run', 'retry_later', '']) assert.ok(!FINAL.has(s), s);
});

test('the finder throwing for the whole batch keeps scraped picks and marks the rest error', async () => {
  const io = makeIo({
    finder: fakeFinder({}, { throws: new Error('boom') }),
    scrape: async w => ({ emails: w.includes('acme') ? ['info@acme.co.uk'] : [] }),
  });
  const { rows, report } = await enrichRows([row(), row({ company_number: '2', owner_first: 'Bea', website: 'https://b.co.uk' })], io);
  assert.strictEqual(rows[0].email, 'info@acme.co.uk');
  assert.strictEqual(rows[0].email_status, 'scraped_role');
  assert.strictEqual(rows[1].email, '');
  assert.strictEqual(rows[1].email_status, 'error');
  assert.strictEqual(report.rerun, 2);
});

test('the finder failing to open is handled the same way', async () => {
  const io = makeIo({ openFinder: async () => { throw new Error('no finder'); }, scrape: async () => ({ emails: ['info@acme.co.uk'] }) });
  const { rows, report } = await enrichRows([row()], io);
  assert.strictEqual(rows[0].email_status, 'scraped_role');
  assert.strictEqual(report.rerun, 1);
  assert.match(report.finder_error, /no finder/);
});

test('budget exhausted: scraped picks survive, finder rows come back skipped, and the re-run count says how many', async () => {
  const io = makeIo({
    scrape: async w => ({ emails: w.includes('acme') ? ['info@acme.co.uk'] : [] }),
    finder: fakeFinder({ Anthony: { status: 'skipped', email: '' }, Bea: { status: 'skipped', email: '' } }),
  });
  const { rows, report } = await enrichRows([row(), row({ company_number: '2', owner_first: 'Bea', website: 'https://b.co.uk' })], io);
  assert.strictEqual(rows[0].email, 'info@acme.co.uk');
  assert.strictEqual(rows[1].email, '');
  assert.strictEqual(rows[1].email_status, 'skipped');
  assert.strictEqual(report.rerun, 2);
});

test('suppressed by the finder removes the row even if a role inbox was scraped', async () => {
  const io = makeIo({ scrape: async () => ({ emails: ['info@acme.co.uk'] }), finder: fakeFinder({ Anthony: { status: 'suppressed', email: '' } }) });
  const { rows } = await enrichRows([row()], io);
  assert.strictEqual(rows[0].email, '');
  assert.strictEqual(rows[0].email_status, 'suppressed');
});

test('email_suggested stays in the enrich output and never becomes the email', async () => {
  const io = makeIo({ finder: fakeFinder({ Anthony: { status: 'unverifiable', email: '', suggested_email: 'anthony@acme.co.uk', confidence: 'low' } }) });
  const { rows } = await enrichRows([row()], io);
  assert.strictEqual(rows[0].email, '');
  assert.strictEqual(rows[0].email_suggested, 'anthony@acme.co.uk');
});

test('scrape failure is recorded and does not stop the run', async () => {
  const io = makeIo({ scrape: async () => { throw new Error('timeout'); }, finder: fakeFinder({ Anthony: { status: 'found', email: 'anthony@acme.co.uk', confidence: 'high' } }) });
  const { rows } = await enrichRows([row()], io);
  assert.strictEqual(rows[0].email, 'anthony@acme.co.uk');
  assert.strictEqual(io.appended.find(r => r.kind === 'scrape').error, 'timeout');
});

test('email_fallback keeps the scraped address when a finder address wins', async () => {
  const io = makeIo({ scrape: async () => ({ emails: ['info@acme.co.uk'] }), finder: fakeFinder({ Anthony: { status: 'found', email: 'anthony@acme.co.uk', confidence: 'high' } }) });
  const { rows } = await enrichRows([row()], io);
  assert.strictEqual(rows[0].email, 'anthony@acme.co.uk');
  assert.strictEqual(rows[0].email_fallback, 'info@acme.co.uk');
  assert.strictEqual(rows[0].emails_scraped, 'info@acme.co.uk');
});

test('report counts by status and rule and carries the credits the finder used', async () => {
  const io = makeIo({
    scrape: async w => ({ emails: w.includes('c.co') ? ['tony@c.co.uk'] : [] }),
    finder: fakeFinder({ Anthony: { status: 'found', email: 'anthony@acme.co.uk', confidence: 'high' }, Bea: { status: 'not_found' } }, { summary: { reoon_used: 7, icypeas_used: 2 } }),
  });
  const { report } = await enrichRows([row(), row({ company_number: '2', owner_first: 'Bea', website: 'https://b.co.uk' }), row({ company_number: '3', website: 'https://c.co.uk' })], io);
  assert.deepStrictEqual(report.by_status, { found: 1, not_found: 1, scraped_owner: 1 });
  assert.strictEqual(report.by_rule['finder-found'], 1);
  assert.strictEqual(report.by_rule['owner-match'], 1);
  assert.strictEqual(report.reoon_used, 7);
  assert.strictEqual(report.icypeas_used, 2);
  assert.strictEqual(report.finder_rows, 2);
});

test('output columns keep the existing ones and add the new ones once', () => {
  assert.deepStrictEqual(OUT_COLUMNS, ['email', 'email_rule', 'email_fallback', 'emails_scraped', 'email_status', 'email_confidence', 'email_suggested', 'email_source', 'email_checked_at']);
});

test('limit and unrelated columns pass through untouched', async () => {
  const io = makeIo();
  const { rows } = await enrichRows([row({ town: 'Sale' })], io);
  assert.strictEqual(rows[0].town, 'Sale');
  assert.strictEqual(rows[0].company_number, '0001');
});

// ---- CLI arguments ----
test('args: --max-credits is left undefined (so the daily-minus-300 default applies) and --max-icypeas defaults to 0', () => {
  const a = parseEnrichArgs(['node', 'x', 'in.csv', '--out', 'o.csv']);
  assert.strictEqual(a.maxCredits, undefined);
  assert.strictEqual(a.maxIcypeas, 0);
  assert.strictEqual(a.noGuess, false);
  assert.strictEqual(a.out, 'o.csv');
  const b = parseEnrichArgs(['node', 'x', 'in.csv', '--max-credits', '150', '--max-icypeas', '5', '--no-guess', '--limit', '10']);
  assert.strictEqual(b.maxCredits, 150);
  assert.strictEqual(b.maxIcypeas, 5);
  assert.strictEqual(b.noGuess, true);
  assert.strictEqual(b.limit, 10);
  assert.strictEqual(b.out, 'in-emails.csv');
});

test('args: a typo in a number stops the run instead of silently using a default', () => {
  assert.throws(() => parseEnrichArgs(['node', 'x', 'in.csv', '--max-credits', 'lots']), /max-credits/);
  assert.throws(() => parseEnrichArgs(['node', 'x', 'in.csv', '--max-icypeas', '-1']), /max-icypeas/);
  assert.throws(() => parseEnrichArgs(['node', 'x', 'in.csv', '--max-credits']), /max-credits/);
  assert.throws(() => parseEnrichArgs(['node', 'x']), /Usage/);
});

test('needsFinder is the single gate: site, owner first name, maps yes/probable, no scraped owner address, not --no-guess', () => {
  const { needsFinder } = require('../enrich-owner-emails');
  assert.strictEqual(needsFinder(row(), 'role'), true);
  assert.strictEqual(needsFinder(row({ maps_match: 'probable' }), 'none'), true);
  assert.strictEqual(needsFinder(row({ maps_match: 'check' }), 'none'), false);
  assert.strictEqual(needsFinder(row({ owner_first: ' ' }), 'none'), false);
  assert.strictEqual(needsFinder(row({ website: '' }), 'none'), false);
  assert.strictEqual(needsFinder(row(), 'owner-match'), false);
  assert.strictEqual(needsFinder(row(), 'owner-freemail'), false);
  assert.strictEqual(needsFinder(row(), 'owner-guess-verified'), true, 'an old guessed address is not a scraped owner address');
  assert.strictEqual(needsFinder(row(), 'role', true), false);
});

// ---- round 2: resume safety ----
test('resume records store the website, and a changed website re-scrapes and re-asks the finder', async () => {
  const io = makeIo({ scrape: async () => ({ emails: ['info@acme.co.uk'] }), finder: fakeFinder({ Anthony: { status: 'found', email: 'anthony@acme.co.uk', confidence: 'high' } }) });
  await enrichRows([row()], io);
  assert.ok(io.appended.filter(r => r.kind !== undefined).every(r => r.website === 'https://acme.co.uk'));
  let scrapes = 0;
  const io2 = makeIo({ records: io.appended, scrape: async () => { scrapes++; return { emails: [] }; }, finder: fakeFinder({ Anthony: { status: 'not_found', email: '' } }) });
  const { rows } = await enrichRows([row({ website: 'https://acme-new.co.uk' })], io2);
  assert.strictEqual(scrapes, 1);
  assert.strictEqual(io2.finder.calls.length, 1);
  assert.strictEqual(rows[0].email_status, 'not_found');
});

test('rows with no company number are keyed by website plus owner name, not by row position', async () => {
  const a = row({ company_number: '', website: 'https://a.co.uk', owner_first: 'Ann' });
  const b = row({ company_number: '', website: 'https://b.co.uk', owner_first: 'Bea' });
  const io = makeIo({ finder: fakeFinder({ Ann: { status: 'found', email: 'ann@a.co.uk', confidence: 'high' }, Bea: { status: 'found', email: 'bea@b.co.uk', confidence: 'high' } }) });
  await enrichRows([a, b], io);
  // same rows, opposite order, plus a new row first: nobody inherits somebody else's answer
  const c = row({ company_number: '', website: 'https://c.co.uk', owner_first: 'Cat' });
  const io2 = makeIo({ records: io.appended, finder: fakeFinder({ Cat: { status: 'not_found', email: '' } }) });
  const { rows } = await enrichRows([c, b, a], io2);
  assert.deepStrictEqual(io2.finder.calls[0].rows.map(r => r.owner_first), ['Cat']);
  assert.deepStrictEqual(rows.map(r => r.email), ['', 'bea@b.co.uk', 'ann@a.co.uk']);
});
