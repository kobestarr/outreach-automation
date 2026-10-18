// tests/buzz-alerts.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { formatEvent, parseNewEvents } = require('../shared/outreach-core/notify/buzz-alerts');

const reply = {
  event_type: 'email_answered', campaign_name: 'ksd-pro-services-2026-07-02', lead_email_account: 'peter@london-law.co.uk',
  firstName: 'Peter', lastName: 'doesn\'t really come up in AI Search when people ask for a good solicitor in London',
  companyName: 'Alexander JLO', step: 4, from_email_account: 'kobi.omenaka@trykobestarrdigital.com',
};

test('reply alert names the person, firm, campaign, step and the mailbox to answer from', () => {
  const msg = formatEvent(reply);
  assert.match(msg, /Reply/);
  assert.match(msg, /Peter/);
  assert.match(msg, /Alexander JLO/);
  assert.match(msg, /peter@london-law\.co\.uk/);
  assert.match(msg, /ksd-pro-services-2026-07-02/);
  assert.match(msg, /step 4/);
  assert.match(msg, /kobi\.omenaka@trykobestarrdigital\.com/);
});

test('never shows the lastName carrier field', () => {
  assert.doesNotMatch(formatEvent(reply), /AI Search|solicitor in London/);
});

test('bounce alert is short and says it was removed', () => {
  const msg = formatEvent({ event_type: 'email_bounced', campaign_name: 'local-trades-wave1', lead_email_account: 'x@y.co.uk', companyName: 'Y Ltd' });
  assert.match(msg, /Bounce/);
  assert.match(msg, /x@y\.co\.uk/);
  assert.match(msg, /local-trades-wave1/);
});

test('test and unknown events produce no alert', () => {
  assert.strictEqual(formatEvent({ event_type: 'connectivity_test' }), null);
  assert.strictEqual(formatEvent({ event_type: 'deploy_test' }), null);
});

test('no double percent signs reach Buzz', () => {
  assert.doesNotMatch(formatEvent({ ...reply, companyName: '100%% Roofing' }), /%%/);
});

test('parseNewEvents skips blank and broken lines', () => {
  const evs = parseNewEvents('{"event_type":"email_bounced"}\n\nnot json\n{"event_type":"email_answered"}\n');
  assert.deepStrictEqual(evs.map(e => e.event_type), ['email_bounced', 'email_answered']);
});
