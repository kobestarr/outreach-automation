// tests/reply-draft.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { draftReply, cleanDraft, DATA_SOURCE_LINE } = require('../shared/outreach-core/replies/draft');

const lead = { firstName: 'Donna', company: 'James Warriors', campaign: 'ksd-pro-services', brand: 'ksd', lastName: 'SECRET CARRIER TEXT' };
const reply = { subject: 'Re: Hi Donna', body: 'What are the package prices', from: 'donna@jamesswarriors.org' };
const fakeLlm = (text, seen = []) => async p => { seen.push(p); return text; };

test('no dashes of any kind survive, including inside words', () => {
  const out = cleanDraft('Hi Donna,\n\nI work with Citi-backed firms – and more — really - truly.\n\nKobi');
  assert.doesNotMatch(out, /[–—]/);
  assert.doesNotMatch(out, /-/);
  assert.match(out, /Citi backed/);
});

test('hyphens inside emails and links are left alone', () => {
  const out = cleanDraft('Write to jo-bloggs@my-firm.com or https://cal.com/kobi-o/intro-call');
  assert.match(out, /jo-bloggs@my-firm\.com/);
  assert.match(out, /https:\/\/cal\.com\/kobi-o\/intro-call/);
});

test('draft keeps the booking placeholder while no link is configured', async () => {
  const d = await draftReply({ reply, lead, label: 'maybe' }, { llm: fakeLlm('Hi Donna,\n\nHappy to help. Pick a time: [BOOKING LINK]\n\nKobi'), config: { bookingUrl: '' } });
  assert.match(d.text, /\[BOOKING LINK\]/);
});

test('draft inserts the real booking link once configured', async () => {
  const d = await draftReply({ reply, lead, label: 'maybe' }, { llm: fakeLlm('Hi Donna,\n\nPick a time: [BOOKING LINK]\n\nKobi'), config: { bookingUrl: 'https://cal.com/kobi/intro' } });
  assert.match(d.text, /https:\/\/cal\.com\/kobi\/intro/);
  assert.doesNotMatch(d.text, /\[BOOKING LINK\]/);
});

test('a draft with no call to action gets one', async () => {
  const d = await draftReply({ reply, lead, label: 'warm' }, { llm: fakeLlm('Hi Donna,\n\nThanks!\n\nKobi'), config: { bookingUrl: '' } });
  assert.match(d.text, /\[BOOKING LINK\]/);
});

test('prompt carries the house style, the proof points and never the lastName carrier', async () => {
  const seen = [];
  await draftReply({ reply, lead, label: 'maybe' }, { llm: fakeLlm('Hi Donna,\n\nx [BOOKING LINK]\n\nKobi', seen), config: { bookingUrl: '' } });
  const all = seen[0].system + seen[0].user;
  assert.doesNotMatch(all, /SECRET CARRIER/);
  for (const k of ['Nigel', 'Twiggy', 'Proxymity', 'Entain', 'Thallo', 'window cleaner', 'Donna', 'package prices']) assert.ok(all.includes(k), k);
  assert.match(seen[0].system, /no dashes/i);
});

test('Rod asks where we got his details: the data source line and an offer to remove him are in the draft', async () => {
  const rod = { subject: 'Re: Hi Rod', body: "I don't understand what it is you actually do.\nHow did you get my details", from: 'rod@incomethroughproperty.co.uk' };
  const d = await draftReply({ reply: rod, lead: { firstName: 'Rod', company: 'Income Through Property' }, label: 'maybe' },
    { llm: fakeLlm('Hi Rod,\n\nI help firms get found when people ask AI tools for advice.\n\nWant the 2 minute video? [BOOKING LINK]\n\nKobi'), config: { bookingUrl: '' } });
  assert.ok(d.asksDataSource);
  assert.ok(d.text.includes(DATA_SOURCE_LINE));
  assert.match(d.text, /remove you/i);
});

test('data source line is not added when the person did not ask, and not duplicated when asked', async () => {
  const d1 = await draftReply({ reply, lead, label: 'maybe' }, { llm: fakeLlm('Hi Donna,\n\nx [BOOKING LINK]\n\nKobi'), config: {} });
  assert.ok(!d1.text.includes(DATA_SOURCE_LINE));
  const rod = { subject: 's', body: 'How did you get my details', from: 'r@x.com' };
  const d2 = await draftReply({ reply: rod, lead, label: 'maybe' }, { llm: fakeLlm(`Hi,\n\n${DATA_SOURCE_LINE}\n\n[BOOKING LINK]\n\nKobi`), config: {} });
  assert.strictEqual(d2.text.split(DATA_SOURCE_LINE).length, 2);
});

test('data source line names the real source when the lead carries one', async () => {
  const rod = { subject: 's', body: 'Where did you get my email?', from: 'r@x.com' };
  const d = await draftReply({ reply: rod, lead: { ...lead, source: 'Companies House' }, label: 'maybe' }, { llm: fakeLlm('Hi,\n\nx [BOOKING LINK]\n\nKobi'), config: {} });
  assert.match(d.text, /Companies House/);
});

test('a model failure returns an error instead of throwing', async () => {
  const d = await draftReply({ reply, lead, label: 'warm' }, { llm: async () => { throw new Error('boom'); }, config: {} });
  assert.strictEqual(d.text, '');
  assert.match(d.error, /boom/);
});

test('refuses labels that should never get a draft', async () => {
  await assert.rejects(() => draftReply({ reply, lead, label: 'no' }, { llm: fakeLlm('x'), config: {} }), /label/);
});
