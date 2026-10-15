// tests/mailead-client-pick.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { pickCampaignId } = require('../shared/outreach-core/campaigns/mailead-client');

test('returns the id of the single exact title match', () => {
  assert.strictEqual(pickCampaignId([{ id: 1, title: 'a' }, { id: 2, title: 'b' }], 'b'), 2);
});
test('refuses when two campaigns share the title (duplicate trap)', () => {
  assert.throws(() => pickCampaignId([{ id: 8985, title: 'x' }, { id: 8986, title: 'x' }], 'x'), /2 Mailead campaigns titled/);
});
test('refuses when nothing matches', () => {
  assert.throws(() => pickCampaignId([{ id: 1, title: 'a' }], 'z'), /No Mailead campaign titled/);
});
