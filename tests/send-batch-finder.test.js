// tests/send-batch-finder.test.js
// send-batch with the email finder in the loop: routing, last-gate suppression, firm dedupe, Reoon skip, balance, pre-flight.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os');
const { runBatch, registerCampaign } = require('../send-batch');
const { saveCampaign, getCampaign } = require('../shared/outreach-core/campaigns/campaign-registry');

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const DAY = 86400000;
const HEAD = 'first_name,last_name,email,company,category,town,website,company_number,email_status,email_confidence,email_source,email_rule\n';
const line = (o) => {
  const d = { first_name: 'Ann', last_name: 'Ash', email: 'ann@acme.co.uk', company: 'Acme', category: 'a roofer', town: 'Sale', website: 'https://acme.co.uk',
    company_number: '1', email_status: 'found', email_confidence: 'high', email_source: 'finder', email_rule: 'finder-found', ...o };
  return ['first_name', 'last_name', 'email', 'company', 'category', 'town', 'website', 'company_number', 'email_status', 'email_confidence', 'email_source', 'email_rule'].map(k => d[k]).join(',');
};
const csv = (...rows) => HEAD + rows.map(line).join('\n') + '\n';

function setup({ registry, finder = {}, io: over = {}, files = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbf-'));
  const registryFile = path.join(dir, 'campaign-sheets.json');
  const reg = registry || {
    main: { sheetId: 'S_MAIN', sheetUrl: 'u-main', carriers: {}, finderRoutes: { inbox: 'inbox', probable: 'probable' } },
    inbox: { sheetId: 'S_INBOX', sheetUrl: 'u-inbox', carriers: {} },
    probable: { sheetId: 'S_PROB', sheetUrl: 'u-prob', carriers: {} },
  };
  fs.writeFileSync(registryFile, JSON.stringify(reg));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  const appended = {}, verified = [], calls = { balance: 0, lastVerified: [] };
  const io = {
    dataDir: dir, registryFile, now: () => NOW, today: () => '2026-10-18',
    ledgerFile: path.join(dir, 'sent-ledger.txt'),
    sheets: {
      readColumn: async () => [],
      appendRows: async (id, tab, header, rows) => { (appended[id] = appended[id] || []).push({ header, rows }); return { appended: rows.length, wroteHeader: true }; },
      createSpreadsheet: async () => { throw new Error('not expected'); },
    },
    verifyEmails: async emails => { verified.push(...emails); return emails.map(e => ({ email: e, status: 'safe', score: 90, isSafeToSend: true })); },
    naturalise: async l => l,
    log: () => {},
    finder: {
      isSuppressed: () => false,
      lastVerified: e => { calls.lastVerified.push(e); return null; },
      balance: async () => { calls.balance++; return { daily: 2000, instant: 99999 }; },
      ...finder,
    },
    ...over,
  };
  const csvPath = path.join(dir, 'in.csv');
  const run = (text, opts = {}) => { fs.writeFileSync(csvPath, text); return runBatch({ csvPath, campaign: 'main', ...opts }, io); };
  const emailsIn = id => (appended[id] || []).flatMap(a => a.rows.map(r => r[a.header.indexOf('real_email')]));
  return { dir, io, run, appended, verified, calls, emailsIn, registryFile };
}

// ---------- routing ----------
test('rows go to the campaign for their route: main, inbox and probable each to their own sheet', async () => {
  const t = setup();
  const res = await t.run(csv(
    { email: 'a@a.co.uk', website: 'https://a.co.uk', company_number: '1' },
    { email: 'info@b.co.uk', website: 'https://b.co.uk', company_number: '2', email_status: 'found_generic', email_confidence: 'medium', email_rule: 'finder-generic' },
    { email: 'c@c.co.uk', website: 'https://c.co.uk', company_number: '3', email_status: 'icypeas_found', email_confidence: 'low' }));
  assert.deepStrictEqual(t.emailsIn('S_MAIN'), ['a@a.co.uk']);
  assert.deepStrictEqual(t.emailsIn('S_INBOX'), ['info@b.co.uk']);
  assert.deepStrictEqual(t.emailsIn('S_PROB'), ['c@c.co.uk']);
  assert.strictEqual(res.pushed, 3);
  assert.deepStrictEqual(res.pushedByRoute, { main: 1, inbox: 1, probable: 1 });
});

test('a route with no key configured writes held-<key>-<route>.csv and says so, never dropping silently', async () => {
  const t = setup({ registry: { main: { sheetId: 'S_MAIN', sheetUrl: 'u', carriers: {} } } });
  const res = await t.run(csv(
    { email: 'a@a.co.uk', website: 'https://a.co.uk', company_number: '1' },
    { email: 'c@c.co.uk', website: 'https://c.co.uk', company_number: '3', email_status: 'catch_all_found', email_confidence: 'low' }));
  assert.deepStrictEqual(t.emailsIn('S_MAIN'), ['a@a.co.uk']);
  assert.strictEqual(res.held.probable.n, 1);
  const held = fs.readFileSync(path.join(t.dir, 'held-main-probable.csv'), 'utf8');
  assert.match(held, /c@c\.co\.uk/);
  assert.ok(!fs.readFileSync(t.io.ledgerFile, 'utf8').includes('c@c.co.uk'), 'held rows are not ledgered');
});

test('excluded rows go to excluded-<key>-<date>.csv with a reason each and are never pushed', async () => {
  const t = setup();
  const res = await t.run(csv(
    { email: 'a@a.co.uk', website: 'https://a.co.uk', company_number: '1' },
    { email: 'u@u.co.uk', website: 'https://u.co.uk', company_number: '2', email_status: 'unverifiable', email_confidence: 'low' },
    { email: 'l@l.co.uk', website: 'https://l.co.uk', company_number: '3', email_status: 'left_company' },
    { email: 'b@b.co.uk', website: 'https://b.co.uk', company_number: '4', email_status: '' }));
  assert.deepStrictEqual(t.emailsIn('S_MAIN'), ['a@a.co.uk']);
  assert.strictEqual(res.excluded.length, 3);
  const text = fs.readFileSync(path.join(t.dir, 'excluded-main-2026-10-18.csv'), 'utf8');
  assert.match(text, /status_unverifiable/);
  assert.match(text, /status_left_company/);
  assert.match(text, /blank_email_status/);
});

test('legacy files (no email_status column) still all go to main, as before', async () => {
  const t = setup();
  await t.run('first_name,email,company,category,town\nAnn,ann@x.com,A,accountant,Sale\nBob,bob@y.com,B,solicitor,Sale\n');
  assert.deepStrictEqual(t.emailsIn('S_MAIN').sort(), ['ann@x.com', 'bob@y.com']);
});

test('pre-flight: a configured route whose sheet is missing aborts with NOTHING pushed anywhere', async () => {
  const t = setup({ registry: {
    main: { sheetId: 'S_MAIN', sheetUrl: 'u', carriers: {}, finderRoutes: { inbox: 'inbox', probable: 'probable' } },
    inbox: { sheetId: null, sheetUrl: null, carriers: {} },
    probable: { sheetId: 'S_PROB', sheetUrl: 'u', carriers: {} } } });
  await assert.rejects(t.run(csv(
    { email: 'a@a.co.uk', website: 'https://a.co.uk', company_number: '1' },
    { email: 'info@b.co.uk', website: 'https://b.co.uk', company_number: '2', email_status: 'found_generic', email_confidence: 'medium' })), /inbox/);
  assert.deepStrictEqual(t.appended, {});
  assert.strictEqual(fs.existsSync(t.io.ledgerFile), false);
});

test('a main campaign that is registered but has no sheet yet is refused live, never pushed to a null sheet', async () => {
  const t = setup({ registry: { main: { sheetId: null, sheetUrl: null, carriers: {}, note: 'sheet pending' } } });
  await assert.rejects(t.run(csv({ email: 'a@a.co.uk', website: 'https://a.co.uk' })), /'main'/);
  assert.deepStrictEqual(t.appended, {});
  const dry = await t.run(csv({ email: 'a@a.co.uk', website: 'https://a.co.uk' }), { dryRun: true });
  assert.deepStrictEqual(dry.missingSheets, ['main']);
  assert.strictEqual(dry.wouldPush, 1);
});

test('pre-flight only blocks on routes that actually have rows', async () => {
  const t = setup({ registry: {
    main: { sheetId: 'S_MAIN', sheetUrl: 'u', carriers: {}, finderRoutes: { inbox: 'inbox' } }, inbox: { sheetId: null, carriers: {} } } });
  const res = await t.run(csv({ email: 'a@a.co.uk', website: 'https://a.co.uk' }));
  assert.strictEqual(res.pushed, 1);
});

test('dry run reports a missing route sheet instead of throwing, and pushes nothing', async () => {
  const t = setup({ registry: { main: { sheetId: 'S', sheetUrl: 'u', carriers: {}, finderRoutes: { inbox: 'nope' } } } });
  const res = await t.run(csv({ email: 'info@b.co.uk', website: 'https://b.co.uk', email_status: 'found_generic', email_confidence: 'medium' }), { dryRun: true });
  assert.deepStrictEqual(res.missingSheets, ['nope']);
  assert.strictEqual(res.pushed, 0);
  assert.deepStrictEqual(t.appended, {});
});

// ---------- last-gate suppression ----------
test('do-not-contact by email and by domain removes rows whatever their source, including scraped ones', async () => {
  const t = setup({ files: { 'do-not-contact.txt': '# x\nbad@a.co.uk\treason\n@nogo.co.uk\treason\n' } });
  const res = await t.run(csv(
    { email: 'bad@a.co.uk', website: 'https://a.co.uk', company_number: '1', email_source: 'scraped', email_status: 'scraped_owner', email_rule: 'owner-match' },
    { email: 'x@nogo.co.uk', website: 'https://nogo.co.uk', company_number: '2' },
    { email: 'owner@gmail.com', website: 'https://www.nogo.co.uk', company_number: '5', email_source: 'scraped', email_status: 'scraped_owner' },
    { email: 'ok@ok.co.uk', website: 'https://ok.co.uk', company_number: '3' }));
  assert.deepStrictEqual(t.emailsIn('S_MAIN'), ['ok@ok.co.uk']);
  assert.deepStrictEqual(res.skipped.map(s => s.reason).sort(), ['do_not_contact_domain', 'do_not_contact_domain', 'do_not_contact_email']);
});

test('finder suppression (email or the firm website domain) removes the row at the last gate', async () => {
  const sup = new Set(['bounced@a.co.uk', 'blocked.co.uk']);
  const t = setup({ finder: { isSuppressed: x => sup.has(String(x).toLowerCase()) } });
  const res = await t.run(csv(
    { email: 'bounced@a.co.uk', website: 'https://a.co.uk', company_number: '1', email_source: 'scraped', email_status: 'scraped_role' },
    { email: 'info@z.co.uk', website: 'https://www.blocked.co.uk', company_number: '2' },
    { email: 'ok@ok.co.uk', website: 'https://ok.co.uk', company_number: '3' }));
  assert.deepStrictEqual(t.emailsIn('S_MAIN'), ['ok@ok.co.uk']);
  assert.deepStrictEqual(res.skipped.map(s => s.reason), ['finder_suppressed', 'finder_suppressed']);
});

test('a live run with no finder available refuses to run (fail closed)', async () => {
  const t = setup({ io: { finder: null } });
  await assert.rejects(t.run(csv({ email: 'a@a.co.uk' })), /finder/i);
  assert.deepStrictEqual(t.appended, {});
});

test('a dry run with no finder still runs, and says the suppression check was skipped', async () => {
  const logs = [];
  const t = setup({ io: { finder: null, log: m => logs.push(m) } });
  const res = await t.run(csv({ email: 'a@a.co.uk' }), { dryRun: true });
  assert.strictEqual(res.wouldPush, 1);
  assert.ok(logs.some(m => /suppression/i.test(m) && /not checked|skipped/i.test(m)));
});

// ---------- firm dedupe ----------
test('same firm twice in a file (same website domain) is one touch, and the best route wins across routes', async () => {
  const t = setup();
  const res = await t.run(csv(
    { email: 'info@a.co.uk', website: 'https://a.co.uk', company_number: '1', email_status: 'found_generic', email_confidence: 'medium' },
    { email: 'anthony@a.co.uk', website: 'https://www.a.co.uk', company_number: '1' }));
  assert.deepStrictEqual(t.emailsIn('S_MAIN'), ['anthony@a.co.uk']);
  assert.deepStrictEqual(t.emailsIn('S_INBOX'), []);
  assert.ok(res.skipped.some(s => s.reason === 'firm_dupe_in_file' && s.email === 'info@a.co.uk'));
});

test('same company number on two websites is one firm', async () => {
  const t = setup();
  await t.run(csv({ email: 'a@one.co.uk', website: 'https://one.co.uk', company_number: '9' }, { email: 'b@two.co.uk', website: 'https://two.co.uk', company_number: '9' }));
  assert.deepStrictEqual(t.emailsIn('S_MAIN'), ['a@one.co.uk']);
});

test('at push time the company ledger gets company_number<TAB>domain, and a later file skips that firm by number, by domain', async () => {
  const t = setup();
  await t.run(csv({ email: 'a@a.co.uk', website: 'https://a.co.uk', company_number: '42' }));
  assert.match(fs.readFileSync(path.join(t.dir, 'company-ledger.txt'), 'utf8'), /^42\ta\.co\.uk$/m);
  const byNumber = await t.run(csv({ email: 'other@elsewhere.co.uk', website: 'https://elsewhere.co.uk', company_number: '42' }));
  assert.ok(byNumber.skipped.some(s => s.reason === 'firm_already_loaded_company_number'));
  const byDomain = await t.run(csv({ email: 'new@a.co.uk', website: 'https://www.a.co.uk', company_number: '77' }));
  assert.ok(byDomain.skipped.some(s => s.reason === 'firm_already_loaded_domain'));
});

test('a firm whose domain already appears in ANY loaded email (mailead-loaded-*.txt) is skipped, freemail never counts', async () => {
  const t = setup({ files: { 'mailead-loaded-8986-x.txt': 'martin@nolte-kitchens.co.uk\nsomeone@gmail.com\n' } });
  const res = await t.run(csv(
    { email: 'info@nolte-kitchens.co.uk', website: 'https://nolte-kitchens.co.uk/showrooms', company_number: '1' },
    { email: 'me@hotmail.co.uk', website: 'https://gmail.com', company_number: '2' }));
  assert.ok(res.skipped.some(s => s.reason === 'firm_already_loaded_domain'));
  assert.deepStrictEqual(t.emailsIn('S_MAIN'), ['me@hotmail.co.uk']);
});

test('the company ledger is seeded from mailead-loaded-*.txt on a live run', async () => {
  const t = setup({ files: { 'mailead-loaded-1-x.txt': 'a@loaded.co.uk\n' } });
  await t.run(csv({ email: 'a@a.co.uk', website: 'https://a.co.uk', company_number: '1' }));
  assert.match(fs.readFileSync(path.join(t.dir, 'company-ledger.txt'), 'utf8'), /loaded\.co\.uk/);
});

test('a dry run never writes the ledgers', async () => {
  const t = setup({ files: { 'mailead-loaded-1-x.txt': 'a@loaded.co.uk\n' } });
  await t.run(csv({ email: 'a@a.co.uk', website: 'https://a.co.uk', company_number: '1' }), { dryRun: true });
  assert.strictEqual(fs.existsSync(path.join(t.dir, 'company-ledger.txt')), false);
  assert.strictEqual(fs.existsSync(t.io.ledgerFile), false);
});

// ---------- Reoon skip ----------
const lv = (status, ageDays) => () => ({ status, verified_at: NOW - ageDays * DAY });

test('Reoon is skipped only for finder rows verified safe, role_account or inbox_full within 30 days', async () => {
  for (const status of ['safe', 'role_account', 'inbox_full']) {
    const t = setup({ finder: { lastVerified: lv(status, 3) } });
    const res = await t.run(csv({ email: 'a@a.co.uk', website: 'https://a.co.uk' }));
    assert.deepStrictEqual(t.verified, [], status);
    assert.strictEqual(res.pushed, 1);
  }
});

test('Reoon runs as normal for old stamps, other statuses, scraped rows, and rows the finder has not seen', async () => {
  const cases = [
    ['31 days old', lv('safe', 31), {}],
    ['catch_all status', lv('catch_all', 1), {}],
    ['never seen', () => null, {}],
    ['scraped row even if the finder happens to know it', lv('safe', 1), { email_source: 'scraped', email_status: 'scraped_role' }],
  ];
  for (const [why, fn, extra] of cases) {
    const t = setup({ finder: { lastVerified: fn } });
    await t.run(csv({ email: 'a@a.co.uk', website: 'https://a.co.uk', ...extra }));
    assert.deepStrictEqual(t.verified, ['a@a.co.uk'], why);
  }
});

test('an older finder without lastVerified, or one that throws, means a normal Reoon check', async () => {
  const noMethod = setup({ finder: { lastVerified: undefined } });
  await noMethod.run(csv({ email: 'a@a.co.uk', website: 'https://a.co.uk' }));
  assert.deepStrictEqual(noMethod.verified, ['a@a.co.uk']);
  const throws = setup({ finder: { lastVerified: () => { throw new Error('db locked'); } } });
  await throws.run(csv({ email: 'a@a.co.uk', website: 'https://a.co.uk' }));
  assert.deepStrictEqual(throws.verified, ['a@a.co.uk']);
});

test('a mixed batch verifies only the rows that need it', async () => {
  const t = setup({ finder: { lastVerified: e => (e === 'a@a.co.uk' ? { status: 'safe', verified_at: NOW - DAY } : null) } });
  const res = await t.run(csv({ email: 'a@a.co.uk', website: 'https://a.co.uk', company_number: '1' }, { email: 'b@b.co.uk', website: 'https://b.co.uk', company_number: '2' }));
  assert.deepStrictEqual(t.verified, ['b@b.co.uk']);
  assert.strictEqual(res.pushed, 2);
});

// ---------- balance ----------
test('finder balance is checked before verifying: if the rows to verify exceed the daily credits it stops cleanly, nothing pushed', async () => {
  const t = setup({ finder: { balance: async () => ({ daily: 1, instant: 99999 }) } });
  const res = await t.run(csv({ email: 'a@a.co.uk', website: 'https://a.co.uk', company_number: '1' }, { email: 'b@b.co.uk', website: 'https://b.co.uk', company_number: '2' }));
  assert.match(res.aborted, /daily/);
  assert.strictEqual(res.pushed, 0);
  assert.deepStrictEqual(t.verified, []);
  assert.deepStrictEqual(t.appended, {});
  assert.strictEqual(fs.existsSync(t.io.ledgerFile), false);
});

test('rows skipped by lastVerified do not count against the balance', async () => {
  const t = setup({ finder: { balance: async () => ({ daily: 1, instant: 0 }), lastVerified: e => (e === 'a@a.co.uk' ? { status: 'safe', verified_at: NOW - DAY } : null) } });
  const res = await t.run(csv({ email: 'a@a.co.uk', website: 'https://a.co.uk', company_number: '1' }, { email: 'b@b.co.uk', website: 'https://b.co.uk', company_number: '2' }));
  assert.strictEqual(res.pushed, 2);
});

test('no balance call when --skip-verify, and a balance that cannot be read aborts', async () => {
  const t = setup();
  await t.run(csv({ email: 'a@a.co.uk', website: 'https://a.co.uk' }), { skipVerify: true });
  assert.strictEqual(t.calls.balance, 0);
  const bad = setup({ finder: { balance: async () => { throw new Error('reoon down'); } } });
  const res = await bad.run(csv({ email: 'a@a.co.uk', website: 'https://a.co.uk' }));
  assert.match(res.aborted, /balance/);
  assert.strictEqual(res.pushed, 0);
});

// ---------- register ----------
test('--register merges into the existing entry and keeps finderRoutes, carriers and the mailead block', () => {
  const t = setup({ registry: { 'local-trades-wave2': { sheetId: null, sheetUrl: null, label: 'wave 2', note: 'sheet pending: do the thing', carriers: { last_name: '{category} in {town}' },
    finderRoutes: { inbox: 'local-trades-wave2-inbox' }, mailead: { campaignId: 1 } } } });
  registerCampaign({ registryFile: t.registryFile, key: 'local-trades-wave2', url: 'https://docs.google.com/spreadsheets/d/ABC123/edit', extractSheetId: u => u.split('/d/')[1].split('/')[0] });
  const e = getCampaign(t.registryFile, 'local-trades-wave2');
  assert.strictEqual(e.sheetId, 'ABC123');
  assert.deepStrictEqual(e.finderRoutes, { inbox: 'local-trades-wave2-inbox' });
  assert.deepStrictEqual(e.carriers, { last_name: '{category} in {town}' });
  assert.deepStrictEqual(e.mailead, { campaignId: 1 });
  assert.strictEqual(e.label, 'wave 2');
  assert.strictEqual(e.note, undefined, 'the pending note is cleared once a sheet is registered');
});

test('--register on a new key still works', () => {
  const t = setup({ registry: {} });
  registerCampaign({ registryFile: t.registryFile, key: 'fresh', url: 'https://x/d/ZZ/edit', extractSheetId: u => u.split('/d/')[1].split('/')[0] });
  assert.strictEqual(getCampaign(t.registryFile, 'fresh').sheetId, 'ZZ');
});
