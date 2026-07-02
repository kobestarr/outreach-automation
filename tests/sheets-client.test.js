// tests/sheets-client.test.js
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const sc = require('../shared/outreach-core/sheets/sheets-client');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

test('extractSheetId from URL and bare ID', () => {
  assert.strictEqual(
    sc.extractSheetId('https://docs.google.com/spreadsheets/d/abc123_-XYZ/edit#gid=0'),
    'abc123_-XYZ');
  assert.strictEqual(sc.extractSheetId('abc123'), 'abc123');
});

test('readColumn returns values under the named header', async () => {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push(url);
    if (url.includes('/token')) return { json: async () => ({ access_token: 't' }) };
    return { json: async () => ({ values: [['first_name', 'email'], ['A', 'a@x.com'], ['B', 'b@x.com']] }) };
  };
  const vals = await sc.readColumn('SHEET1', 'ToSend', 'email');
  assert.deepStrictEqual(vals, ['a@x.com', 'b@x.com']);
});

test('readColumn returns [] for empty tab', async () => {
  global.fetch = async (url) => {
    if (url.includes('/token')) return { json: async () => ({ access_token: 't' }) };
    return { json: async () => ({}) }; // no values key = empty tab
  };
  assert.deepStrictEqual(await sc.readColumn('S', 'ToSend', 'email'), []);
});

test('appendRows writes header only when tab empty', async () => {
  let appendedBody = null;
  global.fetch = async (url, opts) => {
    if (url.includes('/token')) return { json: async () => ({ access_token: 't' }) };
    if (url.includes(':append')) { appendedBody = JSON.parse(opts.body); return { json: async () => ({ updates: {} }) }; }
    return { json: async () => ({}) }; // A1 check: empty
  };
  await sc.appendRows('S', 'ToSend', ['h1', 'h2'], [['1', '2']]);
  assert.deepStrictEqual(appendedBody.values, [['h1', 'h2'], ['1', '2']]);
});

test('appendRows skips header when tab has content', async () => {
  let appendedBody = null;
  global.fetch = async (url, opts) => {
    if (url.includes('/token')) return { json: async () => ({ access_token: 't' }) };
    if (url.includes(':append')) { appendedBody = JSON.parse(opts.body); return { json: async () => ({ updates: {} }) }; }
    return { json: async () => ({ values: [['h1']] }) }; // A1 non-empty
  };
  await sc.appendRows('S', 'ToSend', ['h1', 'h2'], [['1', '2']]);
  assert.deepStrictEqual(appendedBody.values, [['1', '2']]);
});
