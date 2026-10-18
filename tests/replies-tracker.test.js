const { test } = require('node:test');
const assert = require('node:assert');
const adapter = require('../shared/outreach-core/replies/tracker');

test('adapter exports trackReply and passes the event straight through', async () => {
  let seen;
  const r = await adapter.trackReply({ email: 'a@b.co', label: 'warm' }, { tracker: { trackReply: async (e) => { seen = e; return { ok: true }; } } });
  assert.deepStrictEqual(seen, { email: 'a@b.co', label: 'warm' }); assert.deepStrictEqual(r, { ok: true });
});
test('adapter moveStage passes pipeline options through', async () => {
  let args;
  await adapter.moveStage('a@b.co', 'stripped', 'Won', { pipeline: 'Marketplace' }, { tracker: { moveStage: async (...a) => { args = a; return {}; } } });
  assert.deepStrictEqual(args, ['a@b.co', 'stripped', 'Won', { pipeline: 'Marketplace' }]);
});
test('with no tracker injected it builds a real one lazily (unknown mailbox is skipped before any network)', async () => {
  const r = await adapter.trackReply({ email: 'a@b.co', label: 'warm', mailbox: 'x@unknown.io' });
  assert.strictEqual(r.skipped, 'unknown_brand');
});
