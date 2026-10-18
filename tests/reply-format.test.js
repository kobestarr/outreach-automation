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
  assert.doesNotMatch(f.formatActionable(base) + f.formatBlocked({ ...base, label: 'no', result: { complete: true } }) + f.formatUnibox(base) + f.formatReAlert(base), /—|–/);
});
test('blocked note says what happened, partial blocks shout', () => {
  assert.match(f.formatBlocked({ ...base, label: 'no', reason: 'not interested', result: { complete: true } }), /Blocked everywhere/);
  assert.match(f.formatBlocked({ ...base, label: 'no', result: { complete: false, mailead: 'failed: x' } }), /PARTLY/);
});
test('unibox alert tells Kobi where to read it', () => assert.match(f.formatUnibox(base), /Mailead Unibox/));
test('re-alert names how long it has waited', () => assert.match(f.formatReAlert({ ...base, hours: 26 }), /26/));
test('auto note only exists for a named colleague', () => {
  assert.strictEqual(f.formatAutoNote({ ...base, label: 'auto' }), null);
  assert.match(f.formatAutoNote({ ...base, label: 'auto', colleague: 'jo@x.com', resume: '2026-11-03' }), /jo@x\.com/);
});
