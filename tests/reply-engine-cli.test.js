// tests/reply-engine-cli.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { main } = require('../reply-engine');

const rows = fs.readFileSync(path.join(__dirname, 'fixtures/replies-2026-10-18.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-engine-'));
  const stateDir = path.join(dir, 'state');
  const repliesFile = path.join(dir, 'replies.jsonl');
  const eventsFile = path.join(dir, 'events.jsonl');
  const dnc = path.join(dir, 'dnc.txt'), ledger = path.join(dir, 'ledger.txt');
  fs.writeFileSync(dnc, '# x\n'); fs.writeFileSync(ledger, 'a@b.com\n');
  fs.writeFileSync(repliesFile, rows.map((r, i) => JSON.stringify({ kind: 'inbound', msgid: `<m${i}>`, date: '2026-10-18T08:00:00Z', from: r.from, to: ['kobi.o@kobestarrdigital.com'], cc: r.cc ? [r.cc] : [], subject: r.subject, body: r.body })).join('\n') + '\n');
  fs.writeFileSync(eventsFile, JSON.stringify({ event_type: 'email_answered', lead_email_account: 'atif@hutchingsaccountants.com', firstName: 'Atif', lastName: 'CARRIER SECRET', companyName: 'Hutchings', campaign_name: 'ksd-pro-services', step: 1, from_email_account: 'kobi@kobestarrdigital.com', receivedAt: '2026-10-18T07:00:00Z' }) + '\n');
  return { dir, stateDir, repliesFile, eventsFile, dnc, ledger };
}

test('--dry-run on fixtures prints what would happen and writes nothing anywhere', async () => {
  const s = setup();
  const lines = [];
  const code = await main(['--dry-run', '--once', '--replies-file', s.repliesFile, '--events-file', s.eventsFile],
    { env: { REPLY_ENGINE_STATE_DIR: s.stateDir, REPLY_ENGINE_DNC: s.dnc, REPLY_ENGINE_LEDGER: s.ledger }, log: l => lines.push(l), now: () => new Date('2026-10-18T09:00:00Z') });
  const text = lines.join('\n');
  assert.strictEqual(code, 0);
  assert.match(text, /\[dry-run\] would post/);
  assert.match(text, /\[dry-run\] would block feyi@rslaw\.co\.uk/);
  assert.match(text, /Warm reply/);
  assert.ok(!text.includes('CARRIER SECRET'));
  assert.strictEqual(fs.existsSync(s.stateDir), false, 'dry-run must not create or write state');
  assert.strictEqual(fs.readFileSync(s.dnc, 'utf8'), '# x\n');
  assert.strictEqual(fs.readFileSync(s.ledger, 'utf8'), 'a@b.com\n');
});

test('refuses to run for real from files (files are for dry-run and tests only)', async () => {
  const s = setup();
  const code = await main(['--once', '--replies-file', s.repliesFile], { env: { REPLY_ENGINE_STATE_DIR: s.stateDir }, log: () => {} });
  assert.notStrictEqual(code, 0);
});
