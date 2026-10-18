// tests/reply-format.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const f = require('../shared/outreach-core/replies/format');

const base = { label: 'warm', reason: 'asked for the video', firstName: 'Dana', company: 'Edit Pep', email: 'dana@editpep.bio',
  campaign: 'ksd-funded', step: 2, mailbox: 'kobi.o@kobestarrdigital.com', text: 'Hi, I would like to see the video.', draft: 'Hi Dana,\n\nSure.\n\nKobi' };

test('actionable alert has label, who, firm, campaign, mailbox, reply text and the draft', () => {
  const m = f.formatActionable(base);
  for (const s of ['Warm', 'Dana', 'Edit Pep', 'dana@editpep.bio', 'ksd-funded', 'kobi.o@kobestarrdigital.com', 'I would like to see the video', 'Suggested reply', 'Hi Dana,']) assert.ok(m.includes(s), s);
});
test('long replies are trimmed', () => {
  const m = f.formatActionable({ ...base, text: 'x'.repeat(5000) });
  assert.ok(m.length < 2600);
});
test('never prints lastName or double percent signs', () => {
  const m = f.formatActionable({ ...base, lastName: 'CARRIER', company: '100%% Roofing' });
  assert.ok(!m.includes('CARRIER')); assert.ok(!m.includes('%%'));
});
test('missing draft says so', () => {
  assert.match(f.formatActionable({ ...base, draft: '', draftError: 'boom' }), /no draft/i);
});
test('actionable alerts contain no dashes of the em kind', () => {
  assert.doesNotMatch(f.formatActionable(base) + f.formatBlocked({ ...base, label: 'no', result: { complete: true } }) + f.formatUnibox(base) + f.formatReAlert(base), /\u2014|\u2013/);
});
test('blocked note says what happened, partial blocks shout', () => {
  assert.match(f.formatBlocked({ ...base, label: 'no', reason: 'not interested', result: { complete: true } }), /Blocked everywhere/);
  assert.match(f.formatBlocked({ ...base, label: 'no', result: { complete: false, mailead: 'failed: x' } }), /PARTLY/);
});
test('unibox alert tells Kobi where to read it', () => assert.match(f.formatUnibox(base), /Mailead Unibox/));
test('re-alert names how long it has waited', () => assert.match(f.formatReAlert({ ...base, hours: 26 }), /26/));

test('wording: answer in Gmail, reply to the thread', () => {
  assert.match(f.formatActionable(base), /Answer in Gmail, reply to the thread/);
});
test('reminder tells Kobi how to silence it by hand', () => {
  assert.match(f.formatReAlert(base), /node reply-engine\.js --answered dana@editpep\.bio/);
});
test('unibox alert with no email names who and company', () => {
  const m = f.formatUnibox({ firstName: 'Priya', company: 'Acme Ltd', campaign: 'x' });
  assert.match(m, /Priya at Acme Ltd/); assert.match(m, /Unibox/);
});
test('auto digest lists each auto with resume date and colleague, one message', () => {
  const m = f.formatAutoDigest([{ firstName: 'A', company: 'AA', email: 'a@a.com', resume: '2026-07-27' }, { firstName: 'B', company: 'BB', email: 'b@b.com', colleague: 'c@b.com' }]);
  assert.match(m, /^Auto replies \(2\)/); assert.match(m, /2026-07-27/); assert.match(m, /c@b\.com/); assert.doesNotMatch(m, /\u2014/);
});
