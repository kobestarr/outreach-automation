const { test } = require('node:test');
const assert = require('node:assert');
const { main } = require('../ghl-setup');
const { makeFakeGhl, FAKE_CREDS } = require('./fake-ghl');

async function run(args, fakeOpts) {
  const fake = makeFakeGhl(fakeOpts); const lines = [];
  const code = await main(args, { fetch: fake.fetch, creds: FAKE_CREDS, cli: null, throttle: async () => {}, out: (l) => lines.push(l) });
  return { fake, lines: lines.join('\n'), code };
}
test('--check is read only and reports ok', async () => {
  const r = await run(['--check']);
  assert.strictEqual(r.code, 0); assert.match(r.lines, /kobestarr .*OK/); assert.strictEqual(r.fake.writes().length, 0);
});
test('--check on missing pipelines reports them, writes nothing, exits 0', async () => {
  const r = await run(['--check'], { pipelines: false });
  assert.match(r.lines, /MISSING/); assert.strictEqual(r.fake.writes().length, 0);
});
test('--plan lists the stages and writes nothing', async () => {
  const r = await run(['--plan'], { pipelines: false });
  assert.match(r.lines, /1\. Replied/); assert.match(r.lines, /7\. Lost/); assert.match(r.lines, /Nothing was written/);
  assert.strictEqual(r.fake.writes().length, 0);
});
test('--apply creates one pipeline per sub-account; second run is a no-op', async () => {
  const r = await run(['--apply'], { pipelines: false });
  assert.strictEqual(r.fake.writes().length, 3); assert.match(r.lines, /CREATED/);
  const again = await main(['--apply'], { fetch: r.fake.fetch, creds: FAKE_CREDS, cli: null, throttle: async () => {}, out: () => {} });
  assert.strictEqual(r.fake.writes().length, 3); assert.strictEqual(again, 0);
});
test('--apply --brand only touches that sub-account', async () => {
  const r = await run(['--apply', '--brand', 'dealflow'], { pipelines: false });
  assert.deepStrictEqual(r.fake.writes().map((w) => w.body.locationId), ['LOC_D']);
});
test('no mode or two modes or bad brand is refused', async () => {
  assert.strictEqual((await run([])).code, 2); assert.strictEqual((await run(['--check', '--apply'])).code, 2);
  assert.strictEqual((await run(['--check', '--brand', 'x'])).code, 2);
});
test('mismatch exits non-zero', async () => {
  const fake = makeFakeGhl(); fake.state.pipelines.LOC_K[0].stages.pop();
  const code = await main(['--check'], { fetch: fake.fetch, creds: FAKE_CREDS, cli: null, throttle: async () => {}, out: () => {} });
  assert.strictEqual(code, 1);
});

test('with an injected CLI, --check goes through it', async () => {
  const { makeFakeExec } = require('./fake-ghl');
  const fake = makeFakeGhl(); const fx = makeFakeExec(fake);
  const code = await main(['--check'], { fetch: fake.fetch, creds: { kobestarr: { locationId: 'LOC_K' }, stripped: { locationId: 'LOC_S' }, dealflow: { locationId: 'LOC_D' } }, cli: { exec: fx.exec, ghlp: '/x/ghlp' }, throttle: async () => {}, out: () => {} });
  assert.strictEqual(code, 0); assert.ok(fx.calls.length >= 6);
});

test('prints the id and name GHL returned, not a hard-coded one', async () => {
  const r = await run(['--check']);
  assert.match(r.lines, /Kobestarr Digital \(LOC_K\)/); assert.match(r.lines, /DealFlow Media \(LOC_D\)/);
});
test('a sub-account whose name does not match is refused and exits non-zero, nothing written', async () => {
  const r = await run(['--apply'], { pipelines: false, locationNames: { LOC_S: 'Totally Different Ltd' } });
  assert.strictEqual(r.code, 1); assert.match(r.lines, /Identity check failed/);
  assert.deepStrictEqual(r.fake.writes().map((w) => w.body.locationId).sort(), ['LOC_D', 'LOC_K']);
});
