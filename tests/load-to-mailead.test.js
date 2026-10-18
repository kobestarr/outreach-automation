// tests/load-to-mailead.test.js — core loader logic, no live API.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { loadBatch, rowToLead } = require('../load-to-mailead.js');

let passed = 0;
function test(name, fn) { return Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); }).catch(e => { console.error('  FAIL -', name); console.error('   ', e.message); process.exitCode = 1; }); }

// rowToLead maps ONLY the Title Case columns, ignoring real_* / reoon*.
async function unit() {
  const row = {
    real_first_name: 'REALFIRST', real_last_name: 'RealSurname', real_email: 'real@x.com',
    reoonStatus: 'valid', company_full: 'Acme Limited',
    'First Name': 'Peter', 'Last Name': "doesn't come up in AI search", 'Email': 'peter@bevan.co.uk', 'Company Name': 'Bevan & Co',
  };
  const lead = rowToLead(row);
  assert.deepStrictEqual(lead, { first_name: 'Peter', last_name: "doesn't come up in AI search", email: 'peter@bevan.co.uk', company_name: 'Bevan & Co' });
}

function mkIo(rows, ledgerSeed, addLeadImpl) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mailead-test-'));
  const ledgerFile = path.join(tmp, 'ledger.txt');
  if (ledgerSeed) fs.writeFileSync(ledgerFile, ledgerSeed.join('\n') + '\n');
  const registryFile = path.join(tmp, 'reg.json');
  fs.writeFileSync(registryFile, JSON.stringify({ camp: { sheetId: 'SHEET', carriers: {} } }));
  const calls = [];
  // The gate files a live run needs. Every sheet row went through send-batch, so its email is in the sent ledger.
  fs.writeFileSync(path.join(tmp, 'sent-ledger.txt'), rows.map(r => String(r['Email']).toLowerCase()).join('\n') + '\n');
  fs.writeFileSync(path.join(tmp, 'do-not-contact.txt'), '');
  const finder = { isSuppressed: () => false };
  return {
    ledgerFile, registryFile, tmp, calls, finder,
    io: {
      registryFile, ledgerFile, dataDir: tmp, finder,
      sheets: { readRows: async () => ({ header: ['First Name', 'Last Name', 'Email', 'Company Name'], rows }) },
      resolveCampaignId: async () => 8890,
      addLead: async (cid, lead) => { calls.push(lead); return (addLeadImpl || (() => ({ ok: true, json: { success: true } })))(lead); },
      log: () => {},
    },
  };
}

(async () => {
  await test('rowToLead maps only Mailead block', unit);

  await test('dry-run pushes nothing, counts targets', async () => {
    const rows = [
      { 'First Name': 'A', 'Last Name': 'x', 'Email': 'a@x.com', 'Company Name': 'AC' },
      { 'First Name': 'B', 'Last Name': '', 'Email': 'b@x.com', 'Company Name': 'BC' },
    ];
    const { io, calls } = mkIo(rows);
    const r = await loadBatch({ campaign: 'camp', title: 't', dryRun: true }, io);
    assert.strictEqual(r.toPush, 2);
    assert.strictEqual(r.pushed, 0);
    assert.strictEqual(calls.length, 0, 'dry-run must not call addLead');
    assert.deepStrictEqual(r.missingInsight, ['b@x.com']);
  });

  await test('skips rows without a valid email', async () => {
    const rows = [
      { 'First Name': 'A', 'Last Name': 'x', 'Email': '', 'Company Name': 'AC' },
      { 'First Name': 'B', 'Last Name': 'y', 'Email': 'not-an-email', 'Company Name': 'BC' },
      { 'First Name': 'C', 'Last Name': 'z', 'Email': 'c@x.com', 'Company Name': 'CC' },
    ];
    const { io } = mkIo(rows);
    const r = await loadBatch({ campaign: 'camp', title: 't', spacingMs: 0 }, io);
    assert.strictEqual(r.pushed, 1);
  });

  await test('dedups against ledger and within sheet; ledgers each success', async () => {
    const rows = [
      { 'First Name': 'A', 'Last Name': 'x', 'Email': 'a@x.com', 'Company Name': 'AC' }, // already loaded
      { 'First Name': 'B', 'Last Name': 'y', 'Email': 'b@x.com', 'Company Name': 'BC' }, // fresh
      { 'First Name': 'B2', 'Last Name': 'y', 'Email': 'B@X.com', 'Company Name': 'BC' }, // dup of b (case)
    ];
    const { io, calls, ledgerFile } = mkIo(rows, ['a@x.com']);
    const r = await loadBatch({ campaign: 'camp', title: 't', spacingMs: 0 }, io);
    assert.strictEqual(calls.length, 1, 'only the one fresh lead is pushed');
    assert.strictEqual(calls[0].email, 'b@x.com');
    assert.strictEqual(r.pushed, 1);
    const ledger = fs.readFileSync(ledgerFile, 'utf8');
    assert.ok(ledger.includes('b@x.com'), 'success appended to ledger');
  });

  await test('re-run after full load pushes nothing (idempotent)', async () => {
    const rows = [{ 'First Name': 'B', 'Last Name': 'y', 'Email': 'b@x.com', 'Company Name': 'BC' }];
    const { io, calls } = mkIo(rows);
    await loadBatch({ campaign: 'camp', title: 't', spacingMs: 0 }, io);
    const second = await loadBatch({ campaign: 'camp', title: 't', spacingMs: 0 }, io);
    assert.strictEqual(second.pushed, 0);
    assert.strictEqual(calls.length, 1, 'second run makes no new addLead calls');
  });

  await test('retries then records failure without ledgering', async () => {
    const rows = [{ 'First Name': 'B', 'Last Name': 'y', 'Email': 'b@x.com', 'Company Name': 'BC' }];
    let attempts = 0;
    const { io, ledgerFile } = mkIo(rows, null, () => { attempts++; return { ok: false, status: 500, json: { detail: 'boom' } }; });
    const r = await loadBatch({ campaign: 'camp', title: 't', spacingMs: 0, maxRetries: 3 }, io);
    assert.strictEqual(attempts, 3, 'retried maxRetries times');
    assert.strictEqual(r.pushed, 0);
    assert.strictEqual(r.failed.length, 1);
    assert.ok(!fs.existsSync(ledgerFile) || !fs.readFileSync(ledgerFile, 'utf8').includes('b@x.com'), 'failure NOT ledgered');
  });

  await test('throws when a required Mailead column is missing from the sheet', async () => {
    const { io } = mkIo([]);
    io.sheets.readRows = async () => ({ header: ['First Name', 'Email', 'Company Name'], rows: [] }); // no Last Name
    await assert.rejects(
      () => loadBatch({ campaign: 'camp', title: 't', dryRun: true }, io),
      /missing required column 'Last Name'/
    );
  });

  await test('throws when the campaign has no registered sheet', async () => {
    const { io } = mkIo([]);
    await assert.rejects(
      () => loadBatch({ campaign: 'nope', title: 't', dryRun: true }, io),
      /no registered sheet/
    );
  });

  await test('invalid emails (image-file pattern) are skipped, not pushed', async () => {
    const rows = [
      { 'First Name': 'A', 'Last Name': 'x', 'Email': 'back-header@2x.jpg', 'Company Name': 'AC' },
      { 'First Name': 'C', 'Last Name': 'z', 'Email': 'c@x.com', 'Company Name': 'CC' },
    ];
    const { io, calls } = mkIo(rows);
    const r = await loadBatch({ campaign: 'camp', title: 't', spacingMs: 0 }, io);
    assert.strictEqual(r.pushed, 1);
    assert.strictEqual(calls[0].email, 'c@x.com');
  });

  // ---- last gate (round 2) ----
  const R = (email, o = {}) => ({ 'First Name': 'A', 'Last Name': 'in a place', 'Email': email, 'Company Name': 'AC', ...o });

  await test('live run refuses when the finder cannot load; dry run does not need it', async () => {
    const { io, calls } = mkIo([R('a@a.co.uk')]);
    io.finder = null;
    await assert.rejects(() => loadBatch({ campaign: 'camp', title: 't', spacingMs: 0 }, io), /finder/i);
    assert.strictEqual(calls.length, 0);
    const d = await loadBatch({ campaign: 'camp', title: 't', dryRun: true }, io);
    assert.strictEqual(d.toPush, 1);
  });

  await test('live run refuses when sent-ledger.txt or do-not-contact.txt is missing', async () => {
    for (const f of ['sent-ledger.txt', 'do-not-contact.txt']) {
      const { io, tmp, calls } = mkIo([R('a@a.co.uk')]);
      fs.unlinkSync(path.join(tmp, f));
      await assert.rejects(() => loadBatch({ campaign: 'camp', title: 't', spacingMs: 0 }, io), new RegExp(f.replace('.', '\\.')));
      assert.strictEqual(calls.length, 0);
    }
  });

  await test('do-not-contact by email and by domain stops the add_lead and is logged', async () => {
    const logs = [];
    const { io, calls, tmp } = mkIo([R('bad@a.co.uk'), R('x@nogo.co.uk'), R('ok@ok.co.uk')]);
    fs.writeFileSync(path.join(tmp, 'do-not-contact.txt'), 'bad@a.co.uk\treason\n@nogo.co.uk\treason\n');
    io.log = m => logs.push(m);
    const r = await loadBatch({ campaign: 'camp', title: 't', spacingMs: 0 }, io);
    assert.deepStrictEqual(calls.map(c => c.email), ['ok@ok.co.uk']);
    assert.deepStrictEqual(r.gated.map(g => g.reason).sort(), ['do_not_contact_domain', 'do_not_contact_email']);
    assert.ok(logs.some(m => /bad@a\.co\.uk/.test(m) && /do_not_contact_email/.test(m)));
  });

  await test('finder suppression of the address or its domain stops the add_lead', async () => {
    const { io, calls, finder } = mkIo([R('s@a.co.uk'), R('t@blocked.co.uk'), R('ok@ok.co.uk')]);
    const sup = new Set(['s@a.co.uk', 'blocked.co.uk']);
    finder.isSuppressed = x => sup.has(String(x).toLowerCase());
    const r = await loadBatch({ campaign: 'camp', title: 't', spacingMs: 0 }, io);
    assert.deepStrictEqual(calls.map(c => c.email), ['ok@ok.co.uk']);
    assert.strictEqual(r.gated.length, 2);
  });

  await test('a hand-added sheet row that never went through send-batch (not in the sent ledger) is not loaded', async () => {
    const { io, calls, tmp } = mkIo([R('ok@ok.co.uk'), R('hand@added.co.uk')]);
    fs.writeFileSync(path.join(tmp, 'sent-ledger.txt'), 'ok@ok.co.uk\n');
    const r = await loadBatch({ campaign: 'camp', title: 't', spacingMs: 0 }, io);
    assert.deepStrictEqual(calls.map(c => c.email), ['ok@ok.co.uk']);
    assert.strictEqual(r.gated[0].reason, 'not_in_sent_ledger');
  });

  await test('an email or firm already loaded into ANOTHER campaign is not loaded again', async () => {
    const { io, calls, tmp } = mkIo([R('same@a.co.uk'), R('colleague@loaded.co.uk'), R('ok@ok.co.uk')]);
    fs.writeFileSync(path.join(tmp, 'mailead-loaded-1-other.txt'), 'same@a.co.uk\nboss@loaded.co.uk\n');
    const r = await loadBatch({ campaign: 'camp', title: 't', spacingMs: 0 }, io);
    assert.deepStrictEqual(calls.map(c => c.email), ['ok@ok.co.uk']);
    assert.deepStrictEqual(r.gated.map(g => g.reason).sort(), ['firm_loaded_in_other_campaign', 'loaded_in_other_campaign']);
  });

  await test('this campaign\'s own load file does not block its own re-run for the same firm', async () => {
    const { io, calls, ledgerFile } = mkIo([R('a@a.co.uk'), R('b@b.co.uk')], ['a@a.co.uk']);
    await loadBatch({ campaign: 'camp', title: 't', spacingMs: 0 }, io);
    assert.deepStrictEqual(calls.map(c => c.email), ['b@b.co.uk']);
    assert.ok(fs.existsSync(ledgerFile));
  });

  await test('two people at one firm in the sheet: only the first is loaded; shared domains are exempt', async () => {
    const { io, calls } = mkIo([R('a@same.co.uk'), R('b@same.co.uk'), R('dr1@nhs.net'), R('dr2@nhs.net'), R('g1@gmail.com'), R('g2@gmail.com')]);
    const r = await loadBatch({ campaign: 'camp', title: 't', spacingMs: 0 }, io);
    assert.deepStrictEqual(calls.map(c => c.email), ['a@same.co.uk', 'dr1@nhs.net', 'dr2@nhs.net', 'g1@gmail.com', 'g2@gmail.com']);
    assert.strictEqual(r.gated[0].reason, 'firm_dupe_in_batch');
  });

  await test('the gates are checked again immediately before EACH add_lead', async () => {
    const { io, calls, finder } = mkIo([R('one@a.co.uk'), R('two@b.co.uk')]);
    let n = 0;
    finder.isSuppressed = x => { return calls.length >= 1 && String(x) === 'two@b.co.uk' ? true : (n++, false); };
    const r = await loadBatch({ campaign: 'camp', title: 't', spacingMs: 0 }, io);
    assert.deepStrictEqual(calls.map(c => c.email), ['one@a.co.uk']);
    assert.strictEqual(r.gated.length, 1);
  });

  console.log(`\n${passed} passed`);
})();
