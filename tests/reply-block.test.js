// tests/reply-block.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { blockEverywhere, makeFinderSuppress } = require('../shared/outreach-core/replies/block');

function harness(files = {}) {
  const calls = { mailead: [], finder: [], appends: [] };
  const deps = {
    maileadReq: async (ep, o) => { calls.mailead.push([ep, o]); return { ok: true, status: 200, json: { success: true } }; },
    finderSuppress: async (e, r) => { calls.finder.push([e, r]); },
    readFile: p => { if (files[p] == null) throw Object.assign(new Error('nope'), { code: 'ENOENT' }); return files[p]; },
    appendFile: (p, text) => { calls.appends.push([p, text]); files[p] = (files[p] || '') + text; },
    now: () => new Date('2026-10-18T09:00:00Z'),
    source: 'reply-engine',
    dncPath: '/d/do-not-contact.txt', ledgerPath: '/d/sent-ledger.txt', label: 'no',
  };
  return { deps, calls, files };
}

test('blocks in all four places with the agreed line format', async () => {
  const { deps, calls, files } = harness({ '/d/do-not-contact.txt': '# header\n', '/d/sent-ledger.txt': 'old@x.com\n' });
  const r = await blockEverywhere('Feyi@RSLaw.co.uk', 'not interested', deps);
  assert.deepStrictEqual(calls.mailead, [['update_blacklist', { body: { email_to_block: 'feyi@rslaw.co.uk' } }]]);
  assert.deepStrictEqual(calls.finder, [['feyi@rslaw.co.uk', 'not interested']]);
  assert.strictEqual(files['/d/do-not-contact.txt'], '# header\nfeyi@rslaw.co.uk\tnot interested (2026-10-18, reply-engine)\n');
  assert.strictEqual(files['/d/sent-ledger.txt'], 'old@x.com\nfeyi@rslaw.co.uk\n');
  assert.deepStrictEqual([r.mailead, r.finder, r.dnc, r.ledger], ['ok', 'ok', 'added', 'added']);
});

test('idempotent: second call adds no duplicate lines', async () => {
  const { deps, files } = harness({ '/d/do-not-contact.txt': '', '/d/sent-ledger.txt': '' });
  await blockEverywhere('a@b.com', 'x', deps);
  const r = await blockEverywhere('A@B.com', 'x', deps);
  assert.strictEqual(files['/d/do-not-contact.txt'].split('\n').filter(Boolean).length, 1);
  assert.strictEqual(files['/d/sent-ledger.txt'].split('\n').filter(Boolean).length, 1);
  assert.deepStrictEqual([r.dnc, r.ledger], ['exists', 'exists']);
});

test('appends a newline first when the file does not end with one', async () => {
  const { deps, files } = harness({ '/d/do-not-contact.txt': 'z@z.com\tx', '/d/sent-ledger.txt': 'z@z.com' });
  await blockEverywhere('a@b.com', 'x', deps);
  assert.match(files['/d/sent-ledger.txt'], /^z@z\.com\na@b\.com\n$/);
  assert.match(files['/d/do-not-contact.txt'], /^z@z\.com\tx\na@b\.com\t/);
});

test('one target failing does not stop the others and is reported', async () => {
  const { deps, calls } = harness({ '/d/do-not-contact.txt': '', '/d/sent-ledger.txt': '' });
  deps.maileadReq = async () => { throw new Error('network'); };
  const r = await blockEverywhere('a@b.com', 'x', deps);
  assert.match(r.mailead, /network/);
  assert.strictEqual(r.finder, 'ok');
  assert.strictEqual(calls.appends.length, 2);
  assert.strictEqual(r.complete, false);
});

test('mailead answering success:false counts as a failure', async () => {
  const { deps } = harness({ '/d/do-not-contact.txt': '', '/d/sent-ledger.txt': '' });
  deps.maileadReq = async () => ({ ok: true, status: 200, json: { success: false, error: 'bad' } });
  const r = await blockEverywhere('a@b.com', 'x', deps);
  assert.notStrictEqual(r.mailead, 'ok');
  assert.strictEqual(r.complete, false);
});

test('only no and left_company may be blocked', async () => {
  for (const label of ['warm', 'maybe', 'referral', 'auto', undefined]) {
    const { deps, calls } = harness();
    deps.label = label;
    await assert.rejects(() => blockEverywhere('a@b.com', 'x', deps), /label/);
    assert.strictEqual(calls.mailead.length + calls.finder.length + calls.appends.length, 0);
  }
  const { deps } = harness({ '/d/do-not-contact.txt': '', '/d/sent-ledger.txt': '' });
  deps.label = 'left_company';
  await blockEverywhere('a@b.com', 'x', deps);
});

test('never blocks our own mailboxes, Kobi, or junk', async () => {
  for (const e of ['kobi@kobestarrdigital.com', 'kobi@kobestarr.io', 'not-an-email', '']) {
    const { deps, calls } = harness();
    await assert.rejects(() => blockEverywhere(e, 'x', deps), /refus/i);
    assert.strictEqual(calls.mailead.length, 0);
  }
});

test('makeFinderSuppress runs: email-finder suppress <email> <reason>', async () => {
  const seen = [];
  const f = makeFinderSuppress(async (cmd, args) => { seen.push([cmd, args]); });
  await f('a@b.com', 'asked to be removed');
  assert.strictEqual(seen.length, 1);
  assert.ok(require('path').isAbsolute(seen[0][0]), 'launchd has a thin PATH: the finder must be called by absolute path');
  assert.match(seen[0][0], /\.local\/bin\/email-finder$/);
  assert.deepStrictEqual(seen[0][1], ['suppress', 'a@b.com', 'asked to be removed']);
});
