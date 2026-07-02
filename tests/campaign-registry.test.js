// tests/campaign-registry.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os');
const { loadRegistry, getCampaign, saveCampaign } = require('../shared/outreach-core/campaigns/campaign-registry');

function tmpReg(initial) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reg-')), 'campaign-sheets.json');
  if (initial !== undefined) fs.writeFileSync(f, JSON.stringify(initial, null, 2));
  return f;
}

test('loadRegistry returns {} for missing file', () => {
  assert.deepStrictEqual(loadRegistry(tmpReg()), {});
});

test('getCampaign returns entry or null', () => {
  const f = tmpReg({ 'ksd-doctors': { sheetId: 'S1', sheetUrl: 'u', label: 'Doctors', carriers: {} } });
  assert.strictEqual(getCampaign(f, 'ksd-doctors').sheetId, 'S1');
  assert.strictEqual(getCampaign(f, 'nope'), null);
});

test('saveCampaign persists and preserves other entries', () => {
  const f = tmpReg({ a: { sheetId: '1' } });
  saveCampaign(f, 'b', { sheetId: '2', sheetUrl: 'u2', label: 'B', carriers: {} });
  const reg = loadRegistry(f);
  assert.strictEqual(reg.a.sheetId, '1');
  assert.strictEqual(reg.b.sheetId, '2');
});
