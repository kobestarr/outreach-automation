// tests/reply-engine.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { processNew, emptyState } = require('../shared/outreach-core/replies/engine');
const { classifyReply } = require('../shared/outreach-core/replies/classify');
const { draftReply } = require('../shared/outreach-core/replies/draft');

const rows = fs.readFileSync(path.join(__dirname, 'fixtures/replies-2026-10-18.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const row = (from, i = 0) => rows.filter(r => r.from === from)[i];
const T0 = new Date('2026-10-18T09:00:00Z');
const at = (min) => new Date(T0.getTime() + min * 60_000);

// llm: hand label from the fixture stands in for Haiku; drafting just echoes a plain draft
const labelLlm = async ({ user }) => {
  const r = rows.find(x => user.includes(x.subject) && user.includes(x.from));
  return JSON.stringify({ label: r ? r.label : 'maybe', reason: 'fixture' });
};
const draftLlm = async () => 'Hi there,\n\nThanks for coming back. Here is a Citi backed example.\n\n[BOOKING LINK]\n\nKobi';

function make(overrides = {}) {
  const h = { posts: [], blocks: [], tracked: [], clock: T0, state: emptyState(), blockResult: { complete: true } };
  h.deps = {
    classify: r => classifyReply(r, { llm: labelLlm, now: h.clock }),
    draft: a => draftReply(a, { llm: draftLlm, config: { bookingUrl: '' } }),
    block: async (email, reason, label) => { h.blocks.push({ email, reason, label }); return h.blockResult; },
    post: async t => { h.posts.push(t); },
    tracker: { trackReply: async e => { h.tracked.push(e); } },
    now: () => h.clock,
    ...overrides,
  };
  h.run = (replies = [], events = []) => processNew({ replies, events, state: h.state }, h.deps);
  return h;
}

const inbound = (r, extra = {}) => ({ kind: 'inbound', msgid: `<${r.from}-${r.subject}>`, date: T0.toISOString(), from: r.from, to: ['kobi.o@kobestarrdigital.com'], cc: r.cc ? [r.cc] : [], subject: r.subject, body: r.body, ...extra });
const evt = (lead, extra = {}) => ({ event_type: 'email_answered', lead_email_account: lead, firstName: 'Atif', lastName: 'CARRIER SECRET', companyName: 'Hutchings', campaign_name: 'ksd-pro-services', step: 1, from_email_account: 'kobi@kobestarrdigital.com', receivedAt: T0.toISOString(), ...extra });

test('Atif: webhook reply with no Gmail copy gets a Unibox alert after 15 minutes, once', async () => {
  const h = make();
  await h.run([], [evt('atif@hutchingsaccountants.com')]);
  assert.strictEqual(h.posts.length, 0);
  h.clock = at(10); await h.run();
  assert.strictEqual(h.posts.length, 0);
  h.clock = at(16); await h.run();
  assert.strictEqual(h.posts.length, 1);
  assert.match(h.posts[0], /Mailead Unibox/);
  assert.match(h.posts[0], /Atif/);
  assert.strictEqual(h.tracked.length, 1);
  assert.strictEqual(h.tracked[0].label, 'unread');
  h.clock = at(60); await h.run();
  assert.strictEqual(h.posts.length, 1);
});

test('webhook and Gmail copy together make one alert with the text, no Unibox alert', async () => {
  const h = make();
  await h.run([inbound(rows[0])], [evt('atif@hutchingsaccountants.com')]);
  h.clock = at(30); await h.run();
  assert.strictEqual(h.posts.length, 1);
  assert.match(h.posts[0], /Warm/);
  assert.match(h.posts[0], /Audit/);
  assert.match(h.posts[0], /ksd-pro-services/);
  assert.match(h.posts[0], /kobi@kobestarrdigital\.com/);
  assert.doesNotMatch(h.posts[0], /Unibox, I cannot/);
});

test('Gmail first, webhook later: the webhook is consumed quietly', async () => {
  const h = make();
  await h.run([inbound(rows[0])]);
  assert.strictEqual(h.posts.length, 1);
  h.clock = at(2); await h.run([], [evt('atif@hutchingsaccountants.com', { receivedAt: at(2).toISOString() })]);
  h.clock = at(40); await h.run();
  assert.strictEqual(h.posts.length, 1);
});

test('Rob threatens to block but asks for a proposal: warm, a draft, nothing blocked', async () => {
  const h = make();
  await h.run([inbound(row('rob@cityviewgreen.ca'))]);
  assert.strictEqual(h.blocks.length, 0);
  assert.match(h.posts[0], /Warm/);
  assert.match(h.posts[0], /Suggested reply/);
});

test('Conor says not now: alerted as maybe, never blocked', async () => {
  const h = make();
  await h.run([inbound(row('conor.dalgarno@mchaleandco.co.uk'))]);
  assert.strictEqual(h.blocks.length, 0);
  assert.match(h.posts[0], /Maybe/);
});

test('Donna asks the price: maybe with a draft, no block', async () => {
  const h = make();
  await h.run([inbound(row('donna@jamesswarriors.org'))]);
  assert.strictEqual(h.blocks.length, 0);
  assert.match(h.posts[0], /Maybe/);
  assert.match(h.posts[0], /package prices/);
});

test('Rod asks where we got his details: the draft says where and offers removal', async () => {
  const h = make();
  await h.run([inbound(row('rod@incomethroughproperty.co.uk'))]);
  assert.match(h.posts[0], /publicly available business details/);
  assert.match(h.posts[0], /remove you/);
});

test('a referral is drafted and alerted, with the cc visible to the classifier', async () => {
  const h = make();
  await h.run([inbound(row('susie.roberts@mchaleandco.co.uk'))]);
  assert.match(h.posts[0], /Referral/);
});

test('no: blocked once everywhere, short note, tracked', async () => {
  const h = make();
  const r = inbound(row('feyi@rslaw.co.uk'));
  await h.run([r]);
  assert.deepStrictEqual(h.blocks.map(b => [b.email, b.label]), [['feyi@rslaw.co.uk', 'no']]);
  assert.match(h.posts[0], /Blocked everywhere/);
  assert.strictEqual(h.tracked[0].label, 'no');
  await h.run([r]);
  assert.strictEqual(h.blocks.length, 1);
  assert.strictEqual(h.posts.length, 1);
});

test('already blocked address replying again is not blocked twice', async () => {
  const h = make();
  await h.run([inbound(row('feyi@rslaw.co.uk'))]);
  await h.run([{ ...inbound(row('feyi@rslaw.co.uk')), msgid: '<another>' }]);
  assert.strictEqual(h.blocks.length, 1);
});

test('retired is blocked and the named colleague is shown but not contacted', async () => {
  const h = make();
  await h.run([inbound(row('sheila.thompson@cheapaccounting.co.uk'))]);
  assert.strictEqual(h.blocks.length, 1);
  assert.match(h.posts[0], /elaine\.clark@cheapaccounting\.co\.uk/);
  assert.match(h.posts[0], /not contacted/);
});

test('left company is blocked', async () => {
  const h = make();
  await h.run([inbound(row('marwan@hasirudalainnovations.com'))]);
  assert.deepStrictEqual(h.blocks.map(b => b.label), ['left_company']);
});

test('a partial block is reported loudly', async () => {
  const h = make();
  h.blockResult = { complete: false, mailead: 'failed: network' };
  await h.run([inbound(row('feyi@rslaw.co.uk'))]);
  assert.match(h.posts[0], /PARTLY/);
});

test('OOO: no alert, resume date recorded, not blocked', async () => {
  const h = make();
  await h.run([inbound(rows.find(r => r.subject.startsWith('Automatic reply: AI search for Hutchings')))]);
  assert.strictEqual(h.posts.length, 0);
  assert.strictEqual(h.blocks.length, 0);
  assert.strictEqual(h.state.resume['atif@hutchingsaccountants.com'], '2026-07-27');
});

test('OOO naming a colleague posts a short note', async () => {
  const h = make();
  await h.run([inbound(rows.find(r => r.subject.startsWith('Automatic reply: AI search for McHale')))]);
  assert.strictEqual(h.posts.length, 1);
  assert.match(h.posts[0], /michelle\.corry@mchaleandco\.co\.uk/);
});

test('non-English auto replies are silent', async () => {
  const h = make();
  const autos = rows.filter(r => /Automatische|Automatisch|Demande|Solicitud/i.test(r.subject));
  assert.ok(autos.length >= 4);
  await h.run(autos.map(r => inbound(r)));
  assert.strictEqual(h.posts.length, 0);
  assert.strictEqual(h.blocks.length, 0);
});

test('whole fixture: nothing warm, maybe or referral is ever blocked, every one is alerted', async () => {
  const h = make();
  await h.run(rows.map((r, i) => inbound(r, { msgid: `<m${i}>` })));
  const blocked = new Set(h.blocks.map(b => b.email));
  for (const r of rows) {
    if (['warm', 'maybe', 'referral'].includes(r.label)) assert.ok(!blocked.has(r.from), r.from);
  }
  const actionable = rows.filter(r => ['warm', 'maybe', 'referral'].includes(r.label)).length;
  assert.strictEqual(h.posts.filter(p => /^(Warm reply|Maybe|Referral)/.test(p)).length, actionable);
});

test('24 hour re-alert fires once, and not if Kobi answered', async () => {
  const h = make();
  await h.run([inbound(rows[0])]);
  assert.strictEqual(h.posts.length, 1);
  h.clock = at(23 * 60); await h.run();
  assert.strictEqual(h.posts.length, 1);
  h.clock = at(25 * 60); await h.run();
  assert.strictEqual(h.posts.length, 2);
  assert.match(h.posts[1], /Still unanswered/);
  h.clock = at(48 * 60); await h.run();
  assert.strictEqual(h.posts.length, 2);

  const g = make();
  await g.run([inbound(rows[0])]);
  await g.run([{ kind: 'sent', msgid: '<s1>', date: at(120).toISOString(), to: ['atif@hutchingsaccountants.com'], subject: 'Re: x' }]);
  g.clock = at(30 * 60); await g.run();
  assert.strictEqual(g.posts.length, 1);
});

test('a sent reply from before the lead replied does not count as an answer', async () => {
  const h = make();
  await h.run([{ kind: 'sent', msgid: '<s0>', date: at(-600).toISOString(), to: ['atif@hutchingsaccountants.com'], subject: 'Re: x' }, inbound(rows[0])]);
  h.clock = at(25 * 60); await h.run();
  assert.match(h.posts.at(-1), /Still unanswered/);
});

test('tracker gets the agreed fields, never lastName; a tracker crash does not stop the alert', async () => {
  const h = make();
  await h.run([inbound(rows[0])], [evt('atif@hutchingsaccountants.com')]);
  const t = h.tracked[0];
  assert.deepStrictEqual(Object.keys(t).sort(), ['brand', 'campaign', 'company', 'date', 'email', 'firstName', 'label', 'mailbox', 'text']);
  assert.strictEqual(t.brand, 'ksd'); assert.strictEqual(t.company, 'Hutchings'); assert.strictEqual(t.label, 'warm');
  const g = make({ tracker: { trackReply: async () => { throw new Error('ghl down'); } } });
  await g.run([inbound(rows[0])]);
  assert.strictEqual(g.posts.length, 1);
});

test('no tracker supplied is fine', async () => {
  const h = make({ tracker: undefined });
  await h.run([inbound(rows[0])]);
  assert.strictEqual(h.posts.length, 1);
});

test('lastName carrier never reaches Buzz', async () => {
  const h = make();
  await h.run([inbound(rows[0])], [evt('atif@hutchingsaccountants.com')]);
  h.clock = at(30); await h.run([], [evt('x@y.com', { firstName: 'X' })]);
  h.clock = at(60); await h.run();
  assert.ok(h.posts.length >= 2);
  assert.ok(h.posts.every(p => !p.includes('CARRIER SECRET')));
});

test('our own mailboxes and Kobi are never treated as a lead', async () => {
  const h = make();
  await h.run([inbound({ ...rows[0], from: 'kobi.o@kobestarrdigital.com' }), inbound({ ...rows[0], from: 'kobi@kobestarr.io' }, { msgid: '<k>' })]);
  assert.strictEqual(h.posts.length, 0);
});

test('re-fired webhook events inside 24h do not alert twice', async () => {
  const h = make();
  await h.run([], [evt('atif@hutchingsaccountants.com'), evt('atif@hutchingsaccountants.com')]);
  h.clock = at(20); await h.run([], [evt('atif@hutchingsaccountants.com', { receivedAt: at(18).toISOString() })]);
  assert.strictEqual(h.posts.length, 1);
});

test('a failed Buzz post leaves the reply to be retried next run', async () => {
  let fail = true;
  const h = make({ post: async t => { if (fail) throw new Error('buzz down'); h.posts.push(t); } });
  const r = inbound(rows[0]);
  const res = await h.run([r]);
  assert.strictEqual(res.errors.length, 1);
  fail = false;
  await h.run([r]);
  assert.strictEqual(h.posts.length, 1);
});

test('bounces and mailer-daemon mail are ignored', async () => {
  const h = make();
  await h.run([inbound({ ...rows[0], from: 'mailer-daemon@googlemail.com' })]);
  assert.strictEqual(h.posts.length, 0);
});

test('actions list describes what happened (used by dry-run)', async () => {
  const h = make();
  const res = await h.run([inbound(row('feyi@rslaw.co.uk')), inbound(rows[0])]);
  assert.deepStrictEqual(res.actions.map(a => `${a.label}:${a.email}`), ['no:feyi@rslaw.co.uk', 'warm:atif@hutchingsaccountants.com']);
});
