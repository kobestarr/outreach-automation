// tests/bounce-loop.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os');
const { handleEvents, fileLedger, fileQueue, bounceKind } = require('../shared/outreach-core/notify/bounce-loop');
const { leadEmail, isOwnMailbox, OWN_DOMAINS } = require('../shared/outreach-core/notify/lead-email');

const bounce = (lead, extra = {}) => ({ event_type: 'email_bounced', campaign_name: 'local-trades-wave2', lead_email_account: lead, from_email_account: 'kobi.omenaka@trykobestarrdigital.com', companyName: 'Y Ltd', ...extra });
const reply = (lead) => ({ event_type: 'email_answered', campaign_name: 'c', lead_email_account: lead, from_email_account: lead, firstName: 'Pat' });

function mem() {
  const ledger = new Set(), queue = new Set(), record = new Set();
  return {
    record: { has: e => record.has(e), add: e => { record.add(e); }, _s: record },
    ledger: { has: e => ledger.has(e), add: e => { ledger.add(e); }, _s: ledger },
    queue: { list: () => [...queue], add: e => { queue.add(e); }, remove: e => { queue.delete(e); }, _s: queue },
  };
}
function setup(over = {}) {
  const m = mem(), posts = [], imported = [];
  const deps = { record: m.record, post: msg => { posts.push(msg); }, importBounce: (e, why) => { imported.push([e, why]); }, ledger: m.ledger, queue: m.queue, log: () => {}, ...over };
  return { deps, posts, imported, m };
}

test('a bounce is imported into the finder once, ledgered, and still posted to Buzz', async () => {
  const t = setup();
  const r = await handleEvents([bounce('x@y.co.uk')], t.deps);
  assert.deepStrictEqual(t.imported, [['x@y.co.uk', 'mailead bounce local-trades-wave2']]);
  assert.ok(t.m.ledger._s.has('x@y.co.uk'));
  assert.strictEqual(t.posts.length, 1);
  assert.match(t.posts[0], /Bounce: x@y\.co\.uk/);
  assert.strictEqual(r.imported, 1);
});

test('the import happens before the alert is posted', async () => {
  const order = [];
  const t = setup({ importBounce: () => order.push('import'), post: () => order.push('post') });
  await handleEvents([bounce('x@y.co.uk')], t.deps);
  assert.deepStrictEqual(order, ['import', 'post']);
});

test('the same address bouncing twice is imported once', async () => {
  const t = setup();
  await handleEvents([bounce('x@y.co.uk'), bounce('X@Y.co.uk')], t.deps);
  assert.strictEqual(t.imported.length, 1);
});

test('an address already in bounced.txt (the imported ledger) is not imported again', async () => {
  const t = setup();
  t.m.ledger.add('x@y.co.uk');
  await handleEvents([bounce('x@y.co.uk')], t.deps);
  assert.strictEqual(t.imported.length, 0);
  assert.strictEqual(t.posts.length, 1, 'the alert still posts');
});

test('our own sending mailbox is never imported as a bounce', async () => {
  const t = setup();
  await handleEvents([bounce('kobi.omenaka@trykobestarrdigital.com', { from_email_account: 'peter@dealflowmedia.co' })], t.deps);
  assert.strictEqual(t.imported.length, 0);
  assert.strictEqual(t.m.ledger._s.size, 0);
});

test('the bounced address follows the receiver rule: from_email_account first, then lead_email_account, never our own', () => {
  assert.strictEqual(leadEmail({ from_email_account: 'a@lead.co.uk', lead_email_account: 'b@lead.co.uk' }), 'a@lead.co.uk');
  assert.strictEqual(leadEmail({ from_email_account: 'kobi@kobestarrdigital.com', lead_email_account: 'b@lead.co.uk' }), 'b@lead.co.uk');
  assert.strictEqual(leadEmail({ from_email_account: 'kobi@trykobestarrdigital.com', lead_email_account: 'kobi.o@gostripped.media' }), null);
  assert.strictEqual(leadEmail({}), null);
});

test('own mailbox check is exact: the 9 sending domains only, never a substring', () => {
  assert.strictEqual(OWN_DOMAINS.length, 9);
  for (const d of OWN_DOMAINS) for (const l of ['kobi', 'kobi.o', 'kobi.omenaka']) assert.strictEqual(isOwnMailbox(`${l}@${d}`), true, `${l}@${d}`);
  assert.strictEqual(isOwnMailbox('Kobi <kobi@DealflowMedia.co>'), true);
  for (const a of ['info@strippedpine.co.uk', 'x@kobestarr-plumbing.co.uk', 'x@mykobestarrdigital.com', 'x@dealflowmedia.com', 'x@sub.dealflowmedia.co', 'x@trykobestarr.com', '']) assert.strictEqual(isOwnMailbox(a), false, a);
  assert.strictEqual(leadEmail({ from_email_account: 'kobi@dealflowmedia.pro', lead_email_account: 'info@strippedpine.co.uk' }), 'info@strippedpine.co.uk');
});

test('replies are never imported as bounces', async () => {
  const t = setup();
  await handleEvents([reply('pat@y.co.uk')], t.deps);
  assert.strictEqual(t.imported.length, 0);
  assert.strictEqual(t.posts.length, 1);
});

test('events with no alert (tests, unknown) are ignored quietly', async () => {
  const t = setup();
  await handleEvents([{ event_type: 'connectivity_test' }, { event_type: 'deploy_test' }], t.deps);
  assert.strictEqual(t.posts.length, 0);
});

test('finder failure: the alert still posts, the address is queued, ONE notice per run, and it is not ledgered', async () => {
  const t = setup({ importBounce: () => { throw new Error('finder not found'); } });
  const r = await handleEvents([bounce('a@y.co.uk'), bounce('b@y.co.uk')], t.deps);
  assert.deepStrictEqual(t.m.queue.list().sort(), ['a@y.co.uk', 'b@y.co.uk']);
  assert.strictEqual(t.m.ledger._s.size, 0);
  const alerts = t.posts.filter(p => /^Bounce:/.test(p));
  const notices = t.posts.filter(p => !/^Bounce:/.test(p));
  assert.strictEqual(alerts.length, 2);
  assert.strictEqual(notices.length, 1);
  assert.match(notices[0], /finder/i);
  assert.match(notices[0], /2/);
  assert.strictEqual(r.queued, 2);
});

test('the next successful run imports queued addresses first and clears them', async () => {
  const t = setup();
  t.m.queue.add('old@y.co.uk');
  const order = [];
  t.deps.importBounce = e => order.push(e);
  await handleEvents([bounce('new@y.co.uk')], t.deps);
  assert.deepStrictEqual(order, ['old@y.co.uk', 'new@y.co.uk']);
  assert.deepStrictEqual(t.m.queue.list(), []);
  assert.ok(t.m.ledger._s.has('old@y.co.uk'));
});

test('a queued address that is already in the ledger is just cleared, not imported again', async () => {
  const t = setup();
  t.m.queue.add('dup@y.co.uk'); t.m.ledger.add('dup@y.co.uk');
  await handleEvents([], t.deps);
  assert.strictEqual(t.imported.length, 0);
  assert.deepStrictEqual(t.m.queue.list(), []);
});

test('finder still down on the next run with no new bounces: queue stays, no repeat notice', async () => {
  const t = setup({ importBounce: () => { throw new Error('down'); } });
  t.m.queue.add('old@y.co.uk');
  await handleEvents([], t.deps);
  assert.deepStrictEqual(t.m.queue.list(), ['old@y.co.uk']);
  assert.strictEqual(t.posts.length, 0);
});

test('if the queue write itself fails the run throws, so the caller does not move the offset', async () => {
  const t = setup({ importBounce: () => { throw new Error('down'); } });
  t.deps.queue = { list: () => [], add: () => { throw new Error('disk full'); }, remove: () => {} };
  await assert.rejects(handleEvents([bounce('a@y.co.uk')], t.deps), /disk full/);
});

test('if posting fails the run throws, so the caller does not move the offset', async () => {
  const t = setup({ post: () => { throw new Error('buzz down'); } });
  await assert.rejects(handleEvents([bounce('a@y.co.uk')], t.deps), /buzz down/);
});

test('dry run posts nothing real, imports nothing, writes nothing', async () => {
  const t = setup({ dryRun: true });
  await handleEvents([bounce('a@y.co.uk')], t.deps);
  assert.strictEqual(t.imported.length, 0);
  assert.strictEqual(t.m.ledger._s.size, 0);
  assert.strictEqual(t.m.queue._s.size, 0);
  assert.strictEqual(t.posts.length, 1, 'the dry-run poster is still called so it can print');
});

// ---- hard / soft ----
test('bounceKind: unknown payloads are treated as hard; explicit soft or temporary markers are soft', () => {
  assert.strictEqual(bounceKind({ event_type: 'email_bounced' }), 'hard');
  assert.strictEqual(bounceKind({ bounce_type: 'Hard' }), 'hard');
  assert.strictEqual(bounceKind({ bounce_type: 'soft' }), 'soft');
  assert.strictEqual(bounceKind({ type: 'temporary' }), 'soft');
  assert.strictEqual(bounceKind({ bounceType: 'transient' }), 'soft');
  assert.strictEqual(bounceKind({ reason: '452 4.2.2 mailbox full' }), 'soft');
  assert.strictEqual(bounceKind({ reason: '550 5.1.1 user unknown' }), 'hard');
});

test('a soft bounce is logged and not imported (alert still posts); a hard one is imported', async () => {
  const logs = [];
  const t = setup({ log: m => logs.push(m) });
  await handleEvents([bounce('soft@y.co.uk', { bounce_type: 'soft' }), bounce('hard@y.co.uk', { bounce_type: 'hard' })], t.deps);
  assert.deepStrictEqual(t.imported.map(x => x[0]), ['hard@y.co.uk']);
  assert.ok(logs.some(m => /soft/i.test(m) && /soft@y\.co\.uk/.test(m)));
  assert.strictEqual(t.posts.filter(p => /^Bounce:/.test(p)).length, 2);
  assert.ok(!t.m.ledger._s.has('soft@y.co.uk'));
});

// ---- legacy bounced.txt is NOT assumed imported ----
test('addresses only in the old bounced.txt are imported once on the first run, then never again', async () => {
  const t = setup({ backlog: ['alex@aleran.com', 'areiter@10xscience.com'] });
  const r1 = await handleEvents([], t.deps);
  assert.deepStrictEqual(t.imported.map(x => x[0]), ['alex@aleran.com', 'areiter@10xscience.com']);
  assert.strictEqual(r1.imported, 2);
  const r2 = await handleEvents([], t.deps);
  assert.strictEqual(t.imported.length, 2);
  assert.strictEqual(r2.imported, 0);
});

test('backlog addresses the finder cannot take yet stay in the backlog (no ledger entry) and retry next run', async () => {
  let down = true;
  const t = setup({ backlog: ['a@y.co.uk'], importBounce: (e) => { if (down) throw new Error('down'); t.imported.push([e]); } });
  await handleEvents([], t.deps);
  assert.ok(!t.m.ledger._s.has('a@y.co.uk'));
  down = false;
  await handleEvents([], t.deps);
  assert.ok(t.m.ledger._s.has('a@y.co.uk'));
});

test('a newly imported bounce is also recorded in bounced.txt (the plain bounce list)', async () => {
  const t = setup();
  await handleEvents([bounce('x@y.co.uk')], t.deps);
  assert.ok(t.m.record._s.has('x@y.co.uk'));
});

test('file ledger: loads existing lines, adds with date and campaign, ignores comments, survives a missing file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-'));
  const f = path.join(dir, 'bounced.txt');
  fs.writeFileSync(f, 'alex@aleran.com 2026-07-06 campaign:8886\n# note\nharrison@taccs.co.uk 2026-07-08 OPT-OUT campaign:8890\n');
  const l = fileLedger(f, { today: () => '2026-10-18' });
  assert.ok(l.has('alex@aleran.com'));
  assert.ok(l.has('harrison@taccs.co.uk'));
  assert.ok(!l.has('new@y.co.uk'));
  l.add('New@Y.co.uk', 'local-trades-wave2');
  assert.ok(l.has('new@y.co.uk'));
  assert.match(fs.readFileSync(f, 'utf8'), /^new@y\.co\.uk 2026-10-18 campaign:local-trades-wave2$/m);
  assert.ok(!fileLedger(path.join(dir, 'missing.txt')).has('x'));
  assert.deepStrictEqual(l.all().sort(), ['alex@aleran.com', 'harrison@taccs.co.uk', 'new@y.co.uk']);
  const fresh = fileLedger(f);
  assert.ok(fresh.has('new@y.co.uk'));
});

test('file queue: add, list, remove, no duplicates, missing file is empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-'));
  const f = path.join(dir, 'bounces-queue.txt');
  const q = fileQueue(f);
  assert.deepStrictEqual(q.list(), []);
  q.add('a@y.co.uk'); q.add('A@y.co.uk'); q.add('b@y.co.uk');
  assert.deepStrictEqual(q.list(), ['a@y.co.uk', 'b@y.co.uk']);
  q.remove('a@y.co.uk');
  assert.deepStrictEqual(fileQueue(f).list(), ['b@y.co.uk']);
  q.remove('b@y.co.uk');
  assert.deepStrictEqual(fileQueue(f).list(), []);
});

test('mailead-alerts-buzz.js exports handleEvents and does not run main() when required', () => {
  const m = require('../mailead-alerts-buzz');
  assert.strictEqual(typeof m.handleEvents, 'function');
});

test('opt-out lines in bounced.txt are not offered as bounces (they are suppressions, not wrong formats)', () => {
  const os = require('os'), fsx = require('fs'), px = require('path');
  const f = px.join(fsx.mkdtempSync(px.join(os.tmpdir(), 'bl-')), 'bounced.txt');
  fsx.writeFileSync(f, 'alex@aleran.com 2026-07-06 campaign:8886\nharrison@taccs.co.uk 2026-07-08 OPT-OUT campaign:8890\n');
  const led = require('../shared/outreach-core/notify/bounce-loop').fileLedger(f);
  assert.deepStrictEqual(led.bounces(), ['alex@aleran.com']);
  assert.ok(led.has('harrison@taccs.co.uk'));
});
