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
  return {
    ledgerFile, registryFile, tmp, calls,
    io: {
      registryFile, ledgerFile,
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

  console.log(`\n${passed} passed`);
})();
