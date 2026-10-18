const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createGhlTracker, loadGhlCreds, brandForMailbox, STAGES: TRACKER_STAGES } = require('../shared/outreach-core/crm/ghl-tracker');
const { makeFakeGhl, FAKE_CREDS, STAGES } = require('./fake-ghl');

const noSleep = async () => {};
function mk(opts = {}) {
  const fake = makeFakeGhl(opts.fake);
  const tracker = createGhlTracker({ fetch: fake.fetch, creds: FAKE_CREDS, log: () => {}, sleep: noSleep, ...opts.tracker });
  return { fake, tracker };
}
const evt = (o = {}) => ({ email: 'a@acme.co.uk', firstName: 'Ann', company: 'Acme Ltd', campaign: 'ksd-pro-services',
  label: 'warm', text: 'Yes, tell me more.', mailbox: 'kobi@trykobestarrdigital.com', date: '2026-10-18', ...o });

test('stage list matches the spec order', () => assert.deepStrictEqual(TRACKER_STAGES, STAGES));

// 1 credentials
function tmpFiles(vault, claude) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ghlc-'));
  const v = path.join(d, 'v.json'); const c = path.join(d, 'c.json');
  fs.writeFileSync(v, JSON.stringify(vault)); fs.writeFileSync(c, JSON.stringify(claude));
  return { vaultPath: v, claudeJsonPath: c };
}
const mcp = (t, l) => ({ headers: { Authorization: `Bearer ${t}`, locationId: l } });
test('creds: vault ghl.<brand> wins, MCP headers fill the gaps', () => {
  const p = tmpFiles({ ghl: { kobestarr: { token: 'vault-k', location_id: 'LK' }, agency: { private_integration_token: 'ag' } } },
    { mcpServers: { 'ghl-kobestarr': mcp('mcp-k', 'XK'), 'ghl-stripped': mcp('mcp-s', 'LS'), 'ghl-dealflow': mcp('mcp-d', 'LD') } });
  const c = loadGhlCreds(p);
  assert.deepStrictEqual(c.kobestarr, { token: 'vault-k', locationId: 'LK' });
  assert.deepStrictEqual(c.stripped, { token: 'mcp-s', locationId: 'LS' });
  assert.strictEqual(c.dealflow.token, 'mcp-d');
});
test('creds: missing files give an empty map and a missing brand errors without leaking tokens', async () => {
  const c = loadGhlCreds({ vaultPath: '/nope/a.json', claudeJsonPath: '/nope/b.json' });
  assert.deepStrictEqual(c, {});
  const t = createGhlTracker({ fetch: async () => { throw new Error('no'); }, creds: { kobestarr: { token: 'SECRET', locationId: 'L' } }, log: () => {} });
  await assert.rejects(() => t.trackReply(evt({ mailbox: 'x@strippedmedia.co.uk' })), (e) => /stripped/.test(e.message) && !/SECRET/.test(e.message));
});

// 2 brand routing
test('brandForMailbox maps all nine domains, case and display-name forms, unknown -> kobestarr', () => {
  const { tracker } = mk();
  const cases = { 'a@kobestarrdigital.com': 'kobestarr', 'a@kobestarr.digital': 'kobestarr', 'a@trykobestarrdigital.com': 'kobestarr',
    'a@strippedmedia.co.uk': 'stripped', 'a@strippedmedia.org': 'stripped', 'a@gostripped.media': 'stripped',
    'a@dealflowmedia.co': 'dealflow', 'a@dealflowmedia.pro': 'dealflow', 'a@dealflowmedia.group': 'dealflow',
    'A@DealflowMedia.Pro': 'dealflow', 'Kobi <kobi@gostripped.media>': 'stripped', 'x@gmail.com': 'kobestarr', '': 'kobestarr', undefined: 'kobestarr' };
  for (const [k, v] of Object.entries(cases)) assert.strictEqual(tracker.brandForMailbox(k === 'undefined' ? undefined : k), v, k);
  assert.strictEqual(brandForMailbox('a@dealflowmedia.co'), 'dealflow');
});
test('replies route to the sub-account of the sending brand', async () => {
  const { tracker, fake } = mk();
  await tracker.trackReply(evt({ mailbox: 'x@gostripped.media' }));
  const up = fake.state.calls.find((c) => c.path === '/contacts/upsert');
  assert.strictEqual(up.body.locationId, 'LOC_S'); assert.strictEqual(up.auth, 'Bearer tok-s');
  assert.ok(fake.state.calls.every((c) => c.auth === 'Bearer tok-s'));
});
test('unknown mailbox lands in Kobestarr', async () => {
  const { tracker, fake } = mk();
  const r = await tracker.trackReply(evt({ mailbox: 'someone@unknown.io' }));
  assert.strictEqual(r.brand, 'kobestarr'); assert.strictEqual(fake.state.contacts[0].locationId, 'LOC_K');
});
test('explicit brand overrides the mailbox', async () => {
  const { tracker } = mk();
  assert.strictEqual((await tracker.trackReply(evt({ brand: 'dealflow' }))).brand, 'dealflow');
});

// 4 trackReply
test('warm: contact upserted, tags added (campaign, brand), opportunity at Interested, note written', async () => {
  const { tracker, fake } = mk();
  const r = await tracker.trackReply(evt());
  const c = fake.state.contacts[0];
  assert.deepStrictEqual(c.tags.sort(), ['brand:kobestarr', 'campaign:ksd-pro-services', 'cold-email']);
  assert.strictEqual(fake.state.opps.length, 1);
  const o = fake.state.opps[0];
  assert.strictEqual(o.pipelineId, 'pl_LOC_K'); assert.strictEqual(o.pipelineStageId, 'LOC_K_Interested');
  assert.strictEqual(o.status, 'open'); assert.strictEqual(o.contactId, c.id);
  const note = fake.state.notes[c.id][0].body;
  for (const s of ['2026-10-18', 'ksd-pro-services', 'kobi@trykobestarrdigital.com', 'Yes, tell me more.']) assert.ok(note.includes(s), s);
  assert.strictEqual(r.stage, 'Interested'); assert.strictEqual(r.created, true);
});
test('upsert call itself does not send tags (would overwrite existing ones)', async () => {
  const { tracker, fake } = mk();
  await tracker.trackReply(evt());
  assert.strictEqual(fake.state.calls.find((c) => c.path === '/contacts/upsert').body.tags, undefined);
});
test('label to stage mapping', async () => {
  const want = { warm: 'Interested', maybe: 'Replied', referral: 'Replied', no: 'Lost', left_company: 'Lost' };
  for (const [label, stage] of Object.entries(want)) {
    const { tracker, fake } = mk();
    const r = await tracker.trackReply(evt({ label }));
    assert.strictEqual(r.stage, stage, label);
    assert.strictEqual(fake.state.opps[0].pipelineStageId, `LOC_K_${stage}`, label);
    assert.strictEqual(fake.state.opps[0].status, stage === 'Lost' ? 'lost' : 'open', label);
  }
});
test('referral note names the referral; no / left_company notes carry a lost reason', async () => {
  let x = mk(); await x.tracker.trackReply(evt({ label: 'referral', referral: 'Bob Smith', text: 'Speak to Bob' }));
  assert.match(Object.values(x.fake.state.notes)[0][0].body, /Referral: Bob Smith/);
  x = mk(); await x.tracker.trackReply(evt({ label: 'no', text: 'Not interested' }));
  assert.match(Object.values(x.fake.state.notes)[0][0].body, /Lost reason: .*not interested/i);
  x = mk(); await x.tracker.trackReply(evt({ label: 'left_company', text: 'I left in May' }));
  assert.match(Object.values(x.fake.state.notes)[0][0].body, /Lost reason: .*left/i);
});
test('reply text trimmed to 1500 chars', async () => {
  const { tracker, fake } = mk();
  await tracker.trackReply(evt({ text: 'x'.repeat(5000) }));
  const body = Object.values(fake.state.notes)[0][0].body;
  assert.ok(body.length < 1900); assert.ok(!body.includes('x'.repeat(1501)));
});
test('auto label does nothing and makes zero calls', async () => {
  const { tracker, fake } = mk();
  const r = await tracker.trackReply(evt({ label: 'auto' }));
  assert.strictEqual(r.action, 'skipped'); assert.strictEqual(fake.state.calls.length, 0);
});
test('invalid input errors clearly', async () => {
  const { tracker } = mk();
  await assert.rejects(() => tracker.trackReply(evt({ email: 'nope' })), /valid email/);
  await assert.rejects(() => tracker.trackReply(evt({ label: 'weird' })), /label/);
});

// 5 no backwards
test('later maybe never moves Call booked back; warm moves Replied forward', async () => {
  const { tracker, fake } = mk();
  await tracker.trackReply(evt({ label: 'maybe', text: 'hmm' }));
  await tracker.trackReply(evt({ label: 'warm', text: 'ok yes', date: '2026-10-19' }));
  assert.strictEqual(fake.state.opps[0].pipelineStageId, 'LOC_K_Interested');
  await tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Call booked');
  const r = await tracker.trackReply(evt({ label: 'maybe', text: 'question', date: '2026-10-20' }));
  assert.strictEqual(fake.state.opps[0].pipelineStageId, 'LOC_K_Call booked');
  assert.strictEqual(r.moved, false); assert.strictEqual(fake.state.opps.length, 1);
});
test('no after Call booked marks it Lost; Won is never touched by replies', async () => {
  let x = mk();
  await x.tracker.trackReply(evt()); await x.tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Call booked');
  await x.tracker.trackReply(evt({ label: 'no', text: 'changed mind', date: '2026-10-21' }));
  assert.strictEqual(x.fake.state.opps[0].pipelineStageId, 'LOC_K_Lost'); assert.strictEqual(x.fake.state.opps[0].status, 'lost');
  x = mk();
  await x.tracker.trackReply(evt()); await x.tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Won');
  assert.strictEqual(x.fake.state.opps[0].status, 'won');
  await x.tracker.trackReply(evt({ label: 'no', text: 'x', date: '2026-12-01' }));
  assert.strictEqual(x.fake.state.opps[0].pipelineStageId, 'LOC_K_Won'); assert.strictEqual(x.fake.state.opps[0].status, 'won');
});
test('a new warm reply after Lost opens a fresh deal', async () => {
  const { tracker, fake } = mk();
  await tracker.trackReply(evt({ label: 'no', text: 'no thanks' }));
  await tracker.trackReply(evt({ label: 'warm', text: 'actually yes', date: '2026-11-01' }));
  assert.strictEqual(fake.state.opps.length, 2);
  assert.strictEqual(fake.state.opps[1].pipelineStageId, 'LOC_K_Interested');
});

// 6 idempotency + dry run
test('same reply twice creates no duplicate contact, opportunity, tag or note', async () => {
  const { tracker, fake } = mk();
  await tracker.trackReply(evt()); const r2 = await tracker.trackReply(evt());
  assert.strictEqual(fake.state.contacts.length, 1); assert.strictEqual(fake.state.opps.length, 1);
  assert.strictEqual(fake.state.contacts[0].tags.length, 3);
  assert.strictEqual(Object.values(fake.state.notes)[0].length, 1);
  assert.strictEqual(r2.noteAdded, false); assert.strictEqual(r2.created, false);
});
test('two different replies from one person add two notes, one deal', async () => {
  const { tracker, fake } = mk();
  await tracker.trackReply(evt()); await tracker.trackReply(evt({ text: 'another', date: '2026-10-19' }));
  assert.strictEqual(Object.values(fake.state.notes)[0].length, 2); assert.strictEqual(fake.state.opps.length, 1);
});
test('dryRun makes zero calls of any kind and describes the plan', async () => {
  const { tracker, fake } = mk({ tracker: { dryRun: true } });
  const r = await tracker.trackReply(evt());
  assert.strictEqual(fake.state.calls.length, 0);
  assert.strictEqual(r.dryRun, true); assert.strictEqual(r.stage, 'Interested'); assert.strictEqual(r.brand, 'kobestarr');
});

// 7 moveStage
test('moveStage reports when there is no contact or no open deal', async () => {
  const { tracker } = mk();
  assert.strictEqual((await tracker.moveStage('ghost@x.com', 'kobestarr', 'Won')).moved, false);
  await assert.rejects(() => tracker.moveStage('a@b.co', 'kobestarr', 'Nope'), /stage/i);
});
test('moveStage Proposal sent then Won; backwards refused unless allowed', async () => {
  const { tracker, fake } = mk();
  await tracker.trackReply(evt());
  await tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Proposal sent');
  assert.strictEqual((await tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Call booked')).moved, false);
  assert.strictEqual((await tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Call booked', { allowBackwards: true })).moved, true);
  assert.strictEqual(fake.state.opps[0].pipelineStageId, 'LOC_K_Call booked');
});

// 3 http core
test('429 is retried honouring Retry-After, then succeeds', async () => {
  const sleeps = [];
  const fake = makeFakeGhl({ failures: [{ times: 2, status: 429, headers: { 'retry-after': '3' }, match: (m, p) => p === '/contacts/upsert' }] });
  const tracker = createGhlTracker({ fetch: fake.fetch, creds: FAKE_CREDS, log: () => {}, sleep: async (ms) => sleeps.push(ms) });
  await tracker.trackReply(evt());
  assert.strictEqual(fake.state.contacts.length, 1); assert.deepStrictEqual(sleeps.slice(0, 2), [3000, 3000]);
});
test('5xx retried then gives a clear error naming the call, no token', async () => {
  const fake = makeFakeGhl({ failures: [{ times: 99, status: 503, match: (m, p) => p === '/contacts/upsert' }] });
  const tracker = createGhlTracker({ fetch: fake.fetch, creds: FAKE_CREDS, log: () => {}, sleep: noSleep });
  await assert.rejects(() => tracker.trackReply(evt()), (e) => /POST \/contacts\/upsert/.test(e.message) && /503/.test(e.message) && !/tok-k/.test(e.message));
  assert.strictEqual(fake.state.calls.filter((c) => c.path === '/contacts/upsert').length, 4);
});
test('4xx other than 429 is not retried', async () => {
  const fake = makeFakeGhl({ failures: [{ times: 99, status: 401, match: (m, p) => p === '/opportunities/pipelines' }] });
  const tracker = createGhlTracker({ fetch: fake.fetch, creds: FAKE_CREDS, log: () => {}, sleep: noSleep });
  await assert.rejects(() => tracker.trackReply(evt()), /401/);
  assert.strictEqual(fake.state.calls.filter((c) => c.path === '/opportunities/pipelines').length, 1);
});
test('requests carry a 30 s abort signal and version header', async () => {
  let seen;
  const tracker = createGhlTracker({ fetch: async (u, o) => { seen = o; return { status: 200, ok: true, headers: { get: () => null }, text: async () => '{"pipelines":[]}' }; }, creds: FAKE_CREDS, log: () => {} });
  await tracker.ensurePipelines({ dryRun: true, brands: ['kobestarr'] });
  assert.ok(seen.signal); assert.strictEqual(seen.headers.Version, '2021-07-28');
});
test('network timeouts surface as a clear error', async () => {
  const tracker = createGhlTracker({ fetch: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }, creds: FAKE_CREDS, log: () => {}, sleep: noSleep });
  await assert.rejects(() => tracker.trackReply(evt()), /timed out/);
});
test('missing Cold Email pipeline gives an actionable error', async () => {
  const { tracker } = mk({ fake: { pipelines: false } });
  await assert.rejects(() => tracker.trackReply(evt()), /ghl-setup\.js --apply/);
});

// 8 ensurePipelines
test('ensurePipelines: existing correct pipeline is ok and nothing is written', async () => {
  const { tracker, fake } = mk();
  const r = await tracker.ensurePipelines({});
  assert.deepStrictEqual(r.map((x) => x.status), ['ok', 'ok', 'ok']); assert.strictEqual(fake.writes().length, 0);
});
test('ensurePipelines: missing pipeline is created with the seven stages in order, then verified', async () => {
  const { tracker, fake } = mk({ fake: { pipelines: false } });
  const r = await tracker.ensurePipelines({ brands: ['stripped'] });
  assert.strictEqual(r[0].status, 'created');
  const w = fake.writes(); assert.strictEqual(w.length, 1);
  assert.strictEqual(w[0].path, '/opportunities/pipelines'); assert.strictEqual(w[0].body.locationId, 'LOC_S');
  assert.deepStrictEqual(w[0].body.stages.map((s) => s.name), STAGES);
  assert.deepStrictEqual(w[0].body.stages.map((s) => s.position), [0, 1, 2, 3, 4, 5, 6]);
});
test('ensurePipelines dryRun: reports would_create, zero writes', async () => {
  const { tracker, fake } = mk({ fake: { pipelines: false } });
  const r = await tracker.ensurePipelines({ dryRun: true });
  assert.deepStrictEqual(r.map((x) => x.status), ['would_create', 'would_create', 'would_create']); assert.strictEqual(fake.writes().length, 0);
});
test('ensurePipelines: wrong stages are reported, never edited or duplicated', async () => {
  const { tracker, fake } = mk();
  fake.state.pipelines.LOC_K[0].stages.pop();
  const r = await tracker.ensurePipelines({});
  assert.strictEqual(r[0].status, 'mismatch'); assert.match(r[0].detail, /Lost/); assert.strictEqual(fake.writes().length, 0);
});
test('ensurePipelines: a brand with no credentials is reported, not thrown', async () => {
  const fake = makeFakeGhl();
  const tracker = createGhlTracker({ fetch: fake.fetch, creds: { kobestarr: FAKE_CREDS.kobestarr }, log: () => {}, sleep: noSleep });
  const r = await tracker.ensurePipelines({});
  assert.strictEqual(r.find((x) => x.brand === 'stripped').status, 'no_credentials');
});

// ---- CLI transport (gohighlevel-cli ghlp), per Kobi: CLI first, fetch only for gaps ----
const { makeFakeExec } = require('./fake-ghl');
function mkCli(opts = {}) {
  const fake = makeFakeGhl(opts.fake);
  const fx = makeFakeExec(fake, { failures: opts.cliFailures });
  const tracker = createGhlTracker({ fetch: fake.fetch, creds: opts.creds || FAKE_CREDS, log: () => {}, sleep: noSleep,
    cli: { exec: fx.exec, ghlp: '/cli/ghlp' }, ...opts.tracker });
  return { fake, fx, tracker };
}
test('cli: full warm reply works end to end, CLI used for covered calls, fetch only for gaps', async () => {
  const { tracker, fake, fx } = mkCli();
  const r = await tracker.trackReply(evt());
  assert.strictEqual(r.stage, 'Interested'); assert.strictEqual(fake.state.opps.length, 1);
  const cmds = fx.calls.map((c) => `${c.args[2]} ${c.args[3]}`);
  assert.deepStrictEqual(cmds, ['contacts add-tag', 'opportunities pipelines', 'opportunities list', 'opportunities create']);
  assert.ok(fx.calls.every((c) => c.file === '/cli/ghlp' && c.args[0] === 'kobestarr' && c.args[1] === '--json'));
  const fetchPaths = fake.state.calls.map((c) => c.path).filter((p) => !/^\/(opportunities|contacts\/[^/]+\/tags)/.test(p) || p === '/opportunities/pipelines' && false);
  assert.ok(fetchPaths.includes('/contacts/upsert')); assert.ok(fetchPaths.some((p) => /notes$/.test(p)));
});
test('cli: brand routes to the matching ghlp profile', async () => {
  const { tracker, fx } = mkCli();
  await tracker.trackReply(evt({ mailbox: 'x@dealflowmedia.pro' }));
  assert.ok(fx.calls.every((c) => c.args[0] === 'dealflow'));
});
test('cli: contact filtering and no-backwards still hold; idempotent', async () => {
  const { tracker, fake } = mkCli();
  await tracker.trackReply(evt()); await tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Call booked');
  await tracker.trackReply(evt({ label: 'maybe', text: 'q', date: '2026-10-20' }));
  await tracker.trackReply(evt({ label: 'maybe', text: 'q', date: '2026-10-20' }));
  assert.strictEqual(fake.state.opps.length, 1); assert.strictEqual(fake.state.opps[0].pipelineStageId, 'LOC_K_Call booked');
  assert.strictEqual(Object.values(fake.state.notes)[0].length, 2);
});
test('cli: a second contact does not see the first contact\'s deal', async () => {
  const { tracker, fake } = mkCli();
  await tracker.trackReply(evt()); await tracker.trackReply(evt({ email: 'b@other.co.uk', label: 'maybe' }));
  assert.strictEqual(fake.state.opps.length, 2);
});
test('cli: full page of 100 falls back to the API contact-filtered search', async () => {
  const { tracker, fake } = mkCli();
  await tracker.trackReply(evt());
  const base = fake.state.opps[0];
  for (let i = 0; i < 100; i++) fake.state.opps.push({ ...base, id: 'f' + i, contactId: 'other' + i });
  fake.state.opps.reverse(); // the real one is now past nothing, still found via the API path
  const r = await tracker.trackReply(evt({ label: 'maybe', text: 'again', date: '2026-10-21' }));
  assert.strictEqual(r.created, false);
  assert.ok(fake.state.calls.some((c) => c.path === '/opportunities/search' && c.query.contactId));
});
test('cli: 429 in stderr is retried; hard errors are not and never show a token', async () => {
  let x = mkCli({ cliFailures: [{ times: 2, stderr: 'HTTP 429 Too Many Requests' }] });
  await x.tracker.trackReply(evt()); assert.strictEqual(x.fake.state.opps.length, 1);
  x = mkCli({ cliFailures: [{ times: 9, stderr: 'HTTP 401 Bearer pit-abcd-1234 unauthorised' }] });
  await assert.rejects(() => x.tracker.trackReply(evt()), (e) => /401/.test(e.message) && !/pit-abcd/.test(e.message));
  assert.strictEqual(x.fx.calls.length, 1);
});
test('cli: dry run makes no CLI or fetch calls', async () => {
  const { tracker, fake, fx } = mkCli({ tracker: { dryRun: true } });
  await tracker.trackReply(evt()); assert.strictEqual(fx.calls.length + fake.state.calls.length, 0);
});
test('cli: ensurePipelines check uses CLI only, create falls to the API (gap), works with no stored tokens', async () => {
  let x = mkCli({ creds: {} });
  assert.deepStrictEqual((await x.tracker.ensurePipelines({})).map((r) => r.status), ['ok', 'ok', 'ok']);
  assert.strictEqual(x.fake.state.calls.length, 3); // fake CLI -> fake http only
  x = mkCli({ fake: { pipelines: false } });
  const r = await x.tracker.ensurePipelines({ brands: ['stripped'] });
  assert.strictEqual(r[0].status, 'created'); assert.strictEqual(x.fake.writes().filter((w) => w.path === '/opportunities/pipelines').length, 1);
});
test('creds: falls back to the CLI .env.<brand> file', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ghle-'));
  fs.writeFileSync(path.join(d, '.env.stripped'), 'GHL_API_KEY=pit-env-s\nGHL_LOCATION_ID=ENVLOC\n');
  const c = loadGhlCreds({ vaultPath: '/nope', claudeJsonPath: '/nope', cliDir: d });
  assert.deepStrictEqual(c.stripped, { token: 'pit-env-s', locationId: 'ENVLOC' });
});
