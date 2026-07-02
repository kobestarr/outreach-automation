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
