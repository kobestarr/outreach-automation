const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { createGhlTracker, loadGhlCreds, brandForMailbox, createThrottle, statusFromCliError, STAGES: TRACKER_STAGES } = require('../shared/outreach-core/crm/ghl-tracker');
const { makeFakeGhl, makeFakeExec, FAKE_CREDS, STAGES } = require('./fake-ghl');

const noSleep = async () => {};
const noThrottle = async () => {};
const tmp = (p = 'ghlt-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
function mk(opts = {}) {
  const fake = makeFakeGhl(opts.fake);
  const cliFx = opts.cli ? makeFakeExec(fake, opts.cli === true ? {} : opts.cli) : null;
  const tracker = createGhlTracker({ fetch: fake.fetch, creds: opts.creds || FAKE_CREDS, log: () => {}, sleep: noSleep, throttle: noThrottle,
    lockDir: tmp('ghll-'), ...(cliFx ? { cli: { exec: cliFx.exec, ghlp: '/cli/ghlp' } } : {}), ...opts.tracker });
  return { fake, tracker, fx: cliFx };
}
const evt = (o = {}) => ({ email: 'a@acme.co.uk', firstName: 'Ann', company: 'Acme Ltd', campaign: 'ksd-pro-services',
  label: 'warm', text: 'Yes, tell me more.', mailbox: 'kobi@trykobestarrdigital.com', date: '2026-10-18', ...o });
const notesOf = (fake) => Object.values(fake.state.notes).flat().map((n) => n.body);

test('stage list matches the spec order', () => assert.deepStrictEqual(TRACKER_STAGES, STAGES));

// ---------- credentials ----------
function tmpFiles(vault, claude) {
  const d = tmp('ghlc-'); const v = path.join(d, 'v.json'); const c = path.join(d, 'c.json');
  fs.writeFileSync(v, JSON.stringify(vault)); fs.writeFileSync(c, JSON.stringify(claude));
  return { vaultPath: v, claudeJsonPath: c };
}
const mcp = (t, l) => ({ headers: { Authorization: `Bearer ${t}`, locationId: l } });
test('creds: vault wins and token+location always come from the SAME source', () => {
  const p = tmpFiles({ ghl: { kobestarr: { token: 'vault-k', location_id: 'LK' }, stripped: { token: 'vault-s' } } },
    { mcpServers: { 'ghl-kobestarr': mcp('mcp-k', 'XK'), 'ghl-stripped': mcp('mcp-s', 'MCP_S_LOC'), 'ghl-dealflow': mcp('mcp-d', 'LD') } });
  const c = loadGhlCreds(p);
  assert.deepStrictEqual(c.kobestarr, { token: 'vault-k', locationId: 'LK', source: 'vault' });
  assert.strictEqual(c.stripped.token, 'vault-s');
  assert.strictEqual(c.stripped.locationId, 'HZxQ2NMNDVGkqkpOeXru', 'must not borrow the MCP location for a vault token');
  assert.deepStrictEqual(c.dealflow, { token: 'mcp-d', locationId: 'LD', source: 'mcp' });
});
test('creds: falls back to the CLI .env.<brand> file; missing files give an empty map', () => {
  const d = tmp('ghle-'); fs.writeFileSync(path.join(d, '.env.stripped'), 'GHL_API_KEY=pit-env-s\nGHL_LOCATION_ID=ENVLOC\n');
  const c = loadGhlCreds({ vaultPath: '/nope', claudeJsonPath: '/nope', cliDir: d });
  assert.deepStrictEqual(c.stripped, { token: 'pit-env-s', locationId: 'ENVLOC', source: 'cli-env' });
  assert.deepStrictEqual(loadGhlCreds({ vaultPath: '/nope/a', claudeJsonPath: '/nope/b' }), {});
});

// ---------- brand routing ----------
test('brandForMailbox: nine domains, case, display names; unknown or empty is null', () => {
  const cases = { 'a@kobestarrdigital.com': 'kobestarr', 'a@kobestarr.digital': 'kobestarr', 'a@trykobestarrdigital.com': 'kobestarr',
    'a@strippedmedia.co.uk': 'stripped', 'a@strippedmedia.org': 'stripped', 'a@gostripped.media': 'stripped',
    'a@dealflowmedia.co': 'dealflow', 'a@dealflowmedia.pro': 'dealflow', 'a@dealflowmedia.group': 'dealflow',
    'A@DealflowMedia.Pro': 'dealflow', 'Kobi <kobi@gostripped.media>': 'stripped', 'x@gmail.com': null, '': null, 'nonsense': null };
  for (const [k, v] of Object.entries(cases)) assert.strictEqual(brandForMailbox(k), v, k);
  assert.strictEqual(brandForMailbox(undefined), null); assert.strictEqual(brandForMailbox(null), null);
});
test('unknown or empty mailbox: skipped, zero calls, never defaults to Kobestarr', async () => {
  for (const mailbox of ['someone@unknown.io', '', undefined]) {
    const { tracker, fake } = mk();
    const r = await tracker.trackReply(evt({ mailbox }));
    assert.strictEqual(r.skipped, 'unknown_brand'); assert.strictEqual(fake.state.calls.length, 0); assert.strictEqual(fake.state.contacts.length, 0);
  }
});
test('explicit e.brand is validated against the known brands', async () => {
  const { tracker, fake } = mk();
  assert.strictEqual((await tracker.trackReply(evt({ brand: 'acme' }))).skipped, 'unknown_brand');
  assert.strictEqual(fake.state.calls.length, 0);
  assert.strictEqual((await tracker.trackReply(evt({ brand: 'Dealflow' }))).brand, 'dealflow');
});
test('replies go to the sub-account of the sending brand, with that brand token only', async () => {
  const { tracker, fake } = mk();
  await tracker.trackReply(evt({ mailbox: 'x@gostripped.media' }));
  assert.ok(fake.state.calls.every((c) => c.auth === 'Bearer tok-s'));
  assert.strictEqual(fake.state.contacts[0].locationId, 'LOC_S');
});

// ---------- basic flow ----------
test('warm: contact, tags kept additive, deal at Interested, note with date/campaign/mailbox/text', async () => {
  const { tracker, fake } = mk();
  const r = await tracker.trackReply(evt());
  const c = fake.state.contacts[0];
  assert.deepStrictEqual(c.tags.sort(), ['brand:kobestarr', 'campaign:ksd-pro-services', 'cold-email']);
  assert.strictEqual(fake.state.calls.find((x) => x.path === '/contacts/upsert').body.tags, undefined);
  const deals = fake.dealsFor('a@acme.co.uk'); assert.strictEqual(deals.length, 1);
  assert.strictEqual(deals[0].pipelineStageId, 'LOC_K_Interested'); assert.strictEqual(deals[0].status, 'open');
  const note = notesOf(fake)[0];
  for (const s of ['2026-10-18', 'ksd-pro-services', 'kobi@trykobestarrdigital.com', 'Yes, tell me more.']) assert.ok(note.includes(s), s);
  assert.strictEqual(r.stage, 'Interested'); assert.strictEqual(r.created, true);
});
test('label to stage mapping, including unread', async () => {
  const want = { warm: 'Interested', maybe: 'Replied', referral: 'Replied', no: 'Lost', left_company: 'Lost', unread: 'Replied' };
  for (const [label, stage] of Object.entries(want)) {
    const { tracker, fake } = mk();
    const r = await tracker.trackReply(evt({ label }));
    assert.strictEqual(r.stage, stage, label);
    const d = fake.dealsFor('a@acme.co.uk'); assert.strictEqual(d.length, 1, label);
    assert.strictEqual(d[0].pipelineStageId, `LOC_K_${stage}`, label); assert.strictEqual(d[0].status, stage === 'Lost' ? 'lost' : 'open', label);
  }
});
test('unread: note says text not captured, stage Replied only if no deal exists', async () => {
  const { tracker, fake } = mk();
  await tracker.trackReply(evt({ label: 'warm' }));
  await tracker.trackReply(evt({ label: 'unread', text: undefined, date: '2026-10-19' }));
  assert.ok(notesOf(fake).some((n) => n.includes('Reply in Mailead Unibox, text not captured')));
  assert.strictEqual(fake.dealsFor('a@acme.co.uk')[0].pipelineStageId, 'LOC_K_Interested');
});
test('unknown label: note only, never throws, no deal', async () => {
  const { tracker, fake } = mk();
  const r = await tracker.trackReply(evt({ label: 'weird_new_label' }));
  assert.strictEqual(r.noteAdded, true); assert.strictEqual(fake.state.opps.length, 0);
  assert.ok(notesOf(fake)[0].includes('weird_new_label'));
});
test('label is case-insensitive; auto does nothing and makes zero calls', async () => {
  const { tracker, fake } = mk();
  assert.strictEqual((await tracker.trackReply(evt({ label: ' WARM ' }))).stage, 'Interested');
  const x = mk(); const r = await x.tracker.trackReply(evt({ label: 'auto' }));
  assert.strictEqual(r.action, 'skipped'); assert.strictEqual(x.fake.state.calls.length, 0);
});
test('referral note names the referral; no / left_company notes carry a lost reason; text trimmed to 1500', async () => {
  let x = mk(); await x.tracker.trackReply(evt({ label: 'referral', referral: 'Bob Smith', text: 'Speak to Bob' }));
  assert.match(notesOf(x.fake)[0], /Referral: Bob Smith/);
  x = mk(); await x.tracker.trackReply(evt({ label: 'no', text: 'Not interested' }));
  assert.match(notesOf(x.fake)[0], /Lost reason: not interested/i);
  x = mk(); await x.tracker.trackReply(evt({ label: 'left_company', text: 'I left in May' }));
  assert.match(notesOf(x.fake)[0], /Lost reason: .*left/i);
  x = mk(); await x.tracker.trackReply(evt({ text: 'x'.repeat(5000) }));
  assert.ok(!notesOf(x.fake)[0].includes('x'.repeat(1501))); assert.ok(notesOf(x.fake)[0].length < 1900);
});
test('invalid email errors clearly', async () => {
  await assert.rejects(() => mk().tracker.trackReply(evt({ email: 'nope' })), /valid email/);
});

// ---------- email normalisation ----------
test('emails are trimmed and lowercased; plus addressing is left alone', async () => {
  const { tracker, fake } = mk();
  await tracker.trackReply(evt({ email: '  A@Acme.CO.UK ' }));
  await tracker.trackReply(evt({ email: 'a@acme.co.uk', text: 'again', date: '2026-10-19' }));
  assert.strictEqual(fake.state.contacts.length, 1); assert.strictEqual(fake.state.opps.length, 1);
  assert.strictEqual(fake.state.contacts[0].email, 'a@acme.co.uk');
  await tracker.trackReply(evt({ email: 'a+news@acme.co.uk' }));
  assert.strictEqual(fake.state.contacts.length, 2);
});

// ---------- closed deals ----------
test('Won deal: warm reply adds a note only, deal untouched, still one deal', async () => {
  const { tracker, fake } = mk();
  await tracker.trackReply(evt()); await tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Won');
  const before = { ...fake.state.opps[0] };
  const r = await tracker.trackReply(evt({ text: 'another thing', date: '2026-12-01' }));
  assert.deepStrictEqual(fake.state.opps[0], before); assert.strictEqual(fake.dealsFor('a@acme.co.uk').length, 1);
  assert.strictEqual(r.noteAdded, true); assert.strictEqual(r.moved, false);
  await tracker.trackReply(evt({ label: 'no', text: 'x', date: '2026-12-02' }));
  assert.strictEqual(fake.state.opps[0].status, 'won');
});
test('Lost deal + warm: the SAME deal is reopened at Interested (open), never a second deal', async () => {
  const { tracker, fake } = mk();
  await tracker.trackReply(evt({ label: 'no', text: 'no thanks' }));
  const id = fake.state.opps[0].id;
  const r = await tracker.trackReply(evt({ label: 'warm', text: 'actually yes', date: '2026-11-01' }));
  assert.strictEqual(fake.dealsFor('a@acme.co.uk').length, 1);
  const d = fake.state.opps[0]; assert.strictEqual(d.id, id); assert.strictEqual(d.status, 'open'); assert.strictEqual(d.pipelineStageId, 'LOC_K_Interested');
  assert.strictEqual(r.reopened, true);
});
test('Lost deal + anything else: note only, still Lost, still one deal', async () => {
  for (const label of ['maybe', 'referral', 'no', 'left_company', 'unread']) {
    const { tracker, fake } = mk();
    await tracker.trackReply(evt({ label: 'no', text: 'no thanks' }));
    const r = await tracker.trackReply(evt({ label, text: 'later ' + label, date: '2026-11-02' }));
    assert.strictEqual(fake.dealsFor('a@acme.co.uk').length, 1, label);
    assert.strictEqual(fake.state.opps[0].status, 'lost', label); assert.strictEqual(r.noteAdded, true, label);
  }
});
test('never a second deal for a contact in a pipeline, whatever the sequence', async () => {
  const { tracker, fake } = mk();
  for (const [label, d] of [['maybe', 1], ['warm', 2], ['no', 3], ['warm', 4], ['maybe', 5], ['no', 6], ['unread', 7]]) await tracker.trackReply(evt({ label, text: label + d, date: `2026-11-0${d}` }));
  assert.strictEqual(fake.dealsFor('a@acme.co.uk').length, 1);
});

// ---------- auto-Lost limits ----------
test('no from Replied, Interested or Not now goes to Lost', async () => {
  for (const start of ['Replied', 'Interested', 'Not now']) {
    const { tracker, fake } = mk();
    await tracker.trackReply(evt({ label: start === 'Replied' ? 'maybe' : 'warm' }));
    if (start === 'Not now') await tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Not now');
    const r = await tracker.trackReply(evt({ label: 'no', text: 'no', date: '2026-10-25' }));
    assert.strictEqual(fake.state.opps[0].pipelineStageId, 'LOC_K_Lost', start); assert.strictEqual(fake.state.opps[0].status, 'lost', start);
    assert.ok(!r.needsReview, start);
  }
});
test('no from Call booked or Proposal sent: note + needs-review tag + needsReview, deal NOT moved', async () => {
  for (const stage of ['Call booked', 'Proposal sent']) for (const label of ['no', 'left_company']) {
    const { tracker, fake } = mk();
    await tracker.trackReply(evt()); await tracker.moveStage('a@acme.co.uk', 'kobestarr', stage);
    const r = await tracker.trackReply(evt({ label, text: 'changed mind', date: '2026-10-26' }));
    assert.strictEqual(r.needsReview, true, stage); assert.strictEqual(fake.state.opps[0].pipelineStageId, `LOC_K_${stage}`);
    assert.strictEqual(fake.state.opps[0].status, 'open'); assert.ok(fake.state.contacts[0].tags.includes('needs-review'));
    assert.ok(notesOf(fake).some((n) => /NEEDS REVIEW/.test(n)));
  }
});

// ---------- no backwards ----------
test('later maybe never moves Call booked back; warm moves Replied forward', async () => {
  const { tracker, fake } = mk();
  await tracker.trackReply(evt({ label: 'maybe', text: 'hmm' }));
  await tracker.trackReply(evt({ label: 'warm', text: 'ok yes', date: '2026-10-19' }));
  assert.strictEqual(fake.state.opps[0].pipelineStageId, 'LOC_K_Interested');
  await tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Call booked');
  const r = await tracker.trackReply(evt({ label: 'maybe', text: 'question', date: '2026-10-20' }));
  assert.strictEqual(fake.state.opps[0].pipelineStageId, 'LOC_K_Call booked'); assert.strictEqual(r.moved, false);
});

// ---------- idempotency, dry run ----------
test('same reply twice creates no duplicate contact, deal, tag or note', async () => {
  const { tracker, fake } = mk();
  await tracker.trackReply(evt()); const r2 = await tracker.trackReply(evt());
  assert.strictEqual(fake.state.contacts.length, 1); assert.strictEqual(fake.state.opps.length, 1);
  assert.strictEqual(fake.state.contacts[0].tags.length, 3); assert.strictEqual(notesOf(fake).length, 1);
  assert.strictEqual(r2.noteAdded, false);
});
test('dryRun makes zero calls of any kind', async () => {
  const { tracker, fake } = mk({ tracker: { dryRun: true } });
  const r = await tracker.trackReply(evt());
  assert.strictEqual(fake.state.calls.length, 0); assert.strictEqual(r.dryRun, true); assert.strictEqual(r.stage, 'Interested');
});

// ---------- identity guard ----------
test('guard: wrong location name refuses every write for that brand', async () => {
  const { tracker, fake } = mk({ fake: { locationNames: { LOC_K: 'Some Other Business' } } });
  await assert.rejects(() => tracker.trackReply(evt()), /Identity check failed.*Some Other Business/);
  assert.strictEqual(fake.writes().length, 0);
  await assert.rejects(() => tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Won'), /Identity check/);
  assert.strictEqual(fake.writes().length, 0);
});
test('guard: a returned id that differs from the expected location refuses writes', async () => {
  const { tracker, fake } = mk({ fake: { locationIds: { LOC_K: 'LOC_OTHER' } } });
  await assert.rejects(() => tracker.trackReply(evt()), /returned location LOC_OTHER, expected LOC_K/);
  assert.strictEqual(fake.writes().length, 0);
});
test('guard: token that belongs to a different location is refused (403), no writes', async () => {
  const { tracker, fake } = mk({ creds: { ...FAKE_CREDS, kobestarr: { token: 'tok-s', locationId: 'LOC_K' } } });
  await assert.rejects(() => tracker.trackReply(evt()), /Identity check failed/);
  assert.strictEqual(fake.writes().length, 0);
});
test('guard: runs once per brand per tracker, ahead of any write', async () => {
  const { tracker, fake } = mk();
  await tracker.trackReply(evt()); await tracker.trackReply(evt({ text: 'two', date: '2026-10-19' })); await tracker.trackReply(evt({ mailbox: 'q@gostripped.media' }));
  assert.strictEqual(fake.state.calls.filter((c) => c.path.startsWith('/locations/')).length, 2);
  const firstWrite = fake.state.calls.findIndex((c) => c.write);
  assert.ok(fake.state.calls.findIndex((c) => c.path.startsWith('/locations/')) < firstWrite);
});
test('guard with CLI: checks BOTH the API and `ghlp <brand> locations get`', async () => {
  const { tracker, fake, fx } = mk({ cli: true });
  await tracker.trackReply(evt());
  assert.ok(fx.calls.some((c) => c.args[2] === 'locations' && c.args[3] === 'get'));
  assert.ok(fake.state.calls.some((c) => c.path === '/locations/LOC_K' && c.auth === 'Bearer tok-k'));
});
test('guard with CLI: a profile pointing at the wrong account is refused before any write', async () => {
  const { tracker, fake } = mk({ cli: { profileMap: { stripped: 'dealflow' } } });
  await assert.rejects(() => tracker.trackReply(evt({ mailbox: 'x@gostripped.media' })), /Identity check failed/);
  assert.strictEqual(fake.writes().length, 0);
});

// ---------- retries, throttle, redaction ----------
const only = (path, extra) => ({ times: 99, status: 503, match: (m, p) => p === path, ...extra });
test('429 on a POST is retried, honouring Retry-After', async () => {
  const sleeps = [];
  const { tracker, fake } = mk({ fake: { failures: [{ times: 2, status: 429, headers: { 'retry-after': '3' }, match: (m, p) => p === '/contacts/upsert' }] }, tracker: { sleep: async (ms) => sleeps.push(ms) } });
  await tracker.trackReply(evt());
  assert.strictEqual(fake.state.contacts.length, 1); assert.deepStrictEqual(sleeps.slice(0, 2), [3000, 3000]);
});
test('5xx after the write LANDED: re-read finds it, no second attempt (upsert, deal create, note, update)', async () => {
  const { tracker, fake } = mk({ fake: { failures: [
    { times: 1, status: 503, afterApply: true, match: (m, p) => m === 'POST' && p === '/contacts/upsert' },
    { times: 1, status: 502, afterApply: true, match: (m, p) => m === 'POST' && p === '/opportunities/' },
    { times: 1, status: 500, afterApply: true, match: (m, p) => m === 'POST' && /notes$/.test(p) },
    { times: 1, status: 500, afterApply: true, match: (m, p) => m === 'POST' && /tags$/.test(p) },
  ] } });
  await tracker.trackReply(evt());
  const n = (m, re) => fake.state.calls.filter((c) => c.method === m && re.test(c.path)).length;
  assert.strictEqual(n('POST', /upsert/), 1); assert.strictEqual(n('POST', /^\/opportunities\/$/), 1);
  assert.strictEqual(n('POST', /notes$/), 1); assert.strictEqual(n('POST', /tags$/), 1);
  assert.strictEqual(fake.state.opps.length, 1); assert.strictEqual(notesOf(fake).length, 1);
  await tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Call booked'); // clean
  const f2 = mk({ fake: { failures: [{ times: 1, status: 503, afterApply: true, match: (m, p) => m === 'PUT' }] } });
  await f2.tracker.trackReply(evt({ label: 'maybe' })); await f2.tracker.trackReply(evt({ label: 'warm', text: 'w', date: '2026-10-19' }));
  assert.strictEqual(f2.fake.state.calls.filter((c) => c.method === 'PUT').length, 1);
  assert.strictEqual(f2.fake.state.opps[0].pipelineStageId, 'LOC_K_Interested');
});
test('5xx where the write did NOT land: re-read finds nothing, then it is retried', async () => {
  const { tracker, fake } = mk({ fake: { failures: [{ times: 2, status: 503, match: (m, p) => m === 'POST' && p === '/opportunities/' }] } });
  await tracker.trackReply(evt());
  assert.strictEqual(fake.state.opps.length, 1);
  assert.strictEqual(fake.state.calls.filter((c) => c.method === 'POST' && c.path === '/opportunities/').length, 3);
});
test('timeout on a write also re-reads before retrying', async () => {
  const { tracker, fake } = mk({ fake: { failures: [{ times: 1, abort: true, afterApply: true, match: (m, p) => m === 'POST' && p === '/contacts/upsert' }] } });
  await tracker.trackReply(evt());
  assert.strictEqual(fake.state.calls.filter((c) => c.path === '/contacts/upsert').length, 1); assert.strictEqual(fake.state.contacts.length, 1);
});
test('persistent 5xx: clear error naming the call, bounded attempts, no token', async () => {
  const { tracker, fake } = mk({ fake: { failures: [only('/contacts/upsert')] } });
  await assert.rejects(() => tracker.trackReply(evt()), (e) => /POST \/contacts\/upsert/.test(e.message) && /503/.test(e.message) && !/tok-k/.test(e.message));
  assert.strictEqual(fake.state.calls.filter((c) => c.path === '/contacts/upsert').length, 4);
});
test('GET 5xx is retried; other 4xx is not', async () => {
  let x = mk({ fake: { failures: [{ times: 2, status: 500, match: (m, p) => m === 'GET' && p === '/opportunities/pipelines' }] } });
  await x.tracker.trackReply(evt()); assert.strictEqual(x.fake.state.opps.length, 1);
  x = mk({ fake: { failures: [only('/opportunities/pipelines', { status: 401 })] } });
  await assert.rejects(() => x.tracker.trackReply(evt()), /401/);
  assert.strictEqual(x.fake.state.calls.filter((c) => c.path === '/opportunities/pipelines').length, 1);
});
test('network timeout surfaces as a clear error', async () => {
  const t = createGhlTracker({ fetch: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }, creds: FAKE_CREDS, log: () => {}, sleep: noSleep, throttle: noThrottle, lockDir: tmp() });
  await assert.rejects(() => t.trackReply(evt()), /timed out/);
});
test('requests carry a 30 s abort signal and the version header', async () => {
  const { tracker, fake } = mk(); let seen;
  const wrapped = createGhlTracker({ fetch: async (u, o) => { seen = o; return fake.fetch(u, o); }, creds: FAKE_CREDS, log: () => {}, sleep: noSleep, throttle: noThrottle });
  await wrapped.ensurePipelines({ dryRun: true, brands: ['kobestarr'] });
  assert.ok(seen.signal); assert.strictEqual(seen.headers.Version, '2021-07-28');
});
test('every bearer token is redacted from errors, not only pit- ones', async () => {
  const leaky = async () => ({ status: 400, ok: false, headers: { get: () => null }, text: async () => JSON.stringify({ message: 'bad Bearer abc.DEF-123_xyz and token tok-k and pit-zzz-1' }) });
  const t = createGhlTracker({ fetch: leaky, creds: FAKE_CREDS, log: () => {}, sleep: noSleep, throttle: noThrottle, lockDir: tmp() });
  await assert.rejects(() => t.trackReply(evt()), (e) => !/abc\.DEF|tok-k|pit-zzz/.test(e.message));
});
test('throttle: never more than max in the window, waits for the oldest to age out', async () => {
  let t = 0; const sleeps = [];
  const th = createThrottle({ max: 3, windowMs: 1000, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } });
  for (let i = 0; i < 3; i++) await th();
  assert.deepStrictEqual(sleeps, []); await th(); assert.deepStrictEqual(sleeps, [1000]);
});
test('every request (fetch and CLI) goes through the shared throttle, default ceiling under 100', async () => {
  let n = 0; const { tracker, fake } = mk({ tracker: { throttle: async () => { n++; } } });
  await tracker.trackReply(evt()); assert.strictEqual(n, fake.state.calls.length);
  let t = 0; let slept = 0; const th = createThrottle({ now: () => t, sleep: async (ms) => { slept++; t += ms; } });
  for (let i = 0; i < 90; i++) await th(); assert.strictEqual(slept, 0); await th(); assert.strictEqual(slept, 1);
});
test('CLI error status is read from status codes only, not any number', () => {
  assert.strictEqual(statusFromCliError('API Error (429): slow down'), 429);
  assert.strictEqual(statusFromCliError('503 Server Error: Bad Gateway for url'), 503);
  assert.strictEqual(statusFromCliError('HTTP 502'), 502);
  assert.strictEqual(statusFromCliError('contact 5123456 not found, id 4290000'), undefined);
  assert.strictEqual(statusFromCliError('Error: opportunity 500abc failed'), undefined);
});
test('CLI: 429 retried; a hard error with an id that looks like a 5xx is NOT retried; token never shown', async () => {
  let x = mk({ cli: { failures: [{ times: 2, stderr: 'API Error (429): Too Many Requests' }] } });
  await x.tracker.trackReply(evt()); assert.strictEqual(x.fake.state.opps.length, 1);
  x = mk({ cli: { failures: [{ times: 9, stderr: 'Error: record 5001234 invalid Bearer pit-abcd-1234' }] } });
  await assert.rejects(() => x.tracker.trackReply(evt()), (e) => !/pit-abcd/.test(e.message));
  assert.strictEqual(x.fx.calls.length, 1);
});

// ---------- concurrency ----------
test('two simultaneous replies for the same person produce ONE deal and two notes', async () => {
  const { tracker, fake } = mk();
  await Promise.all([tracker.trackReply(evt({ text: 'one' })), tracker.trackReply(evt({ text: 'two', email: 'A@ACME.co.uk' })), tracker.trackReply(evt({ text: 'three', label: 'maybe' }))]);
  assert.strictEqual(fake.dealsFor('a@acme.co.uk').length, 1); assert.strictEqual(notesOf(fake).length, 3); assert.strictEqual(fake.state.contacts.length, 1);
});
test('a fresh file lock held by another process blocks, a stale one is taken over, and the lock is released', async () => {
  const lockDir = tmp('ghlk-'); const key = 'kobestarr:a@acme.co.uk';
  const file = path.join(lockDir, crypto.createHash('sha1').update(key).digest('hex') + '.lock');
  const { tracker, fake } = mk({ tracker: { lockDir, lockTimeoutMs: 150 } });
  fs.writeFileSync(file, 'other-process');
  await assert.rejects(() => tracker.trackReply(evt()), /lock/); assert.strictEqual(fake.writes().length, 0);
  const old = new Date(Date.now() - 120000); fs.utimesSync(file, old, old);
  await tracker.trackReply(evt()); assert.strictEqual(fake.state.opps.length, 1); assert.ok(!fs.existsSync(file));
});
test('after creating a deal it re-searches and keeps the most advanced one when another run raced', async () => {
  const fake = makeFakeGhl();
  const racing = async (u, o) => {
    const r = await fake.fetch(u, o);
    if ((o.method === 'POST') && new URL(u).pathname === '/opportunities/' && !racing.done) {
      racing.done = true; const mine = fake.state.opps[0];
      fake.state.opps.push({ ...mine, id: 'rival', pipelineStageId: 'LOC_K_Call booked' });
    }
    return r;
  };
  const tracker = createGhlTracker({ fetch: racing, creds: FAKE_CREDS, log: () => {}, sleep: noSleep, throttle: noThrottle, lockDir: tmp() });
  const r = await tracker.trackReply(evt({ label: 'maybe' }));
  assert.strictEqual(r.opportunityId, 'rival'); assert.strictEqual(r.duplicateDeals, 1);
});

// ---------- moveStage ----------
test('moveStage: missing contact or deal reported; unknown stage lists the real ones', async () => {
  const { tracker } = mk();
  assert.strictEqual((await tracker.moveStage('ghost@x.com', 'kobestarr', 'Won')).moved, false);
  await tracker.trackReply(evt());
  await assert.rejects(() => tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Nope'), /Unknown stage "Nope".*Replied/);
});
test('moveStage: forward only, Won sets status won, closed deals need allowBackwards', async () => {
  const { tracker, fake } = mk();
  await tracker.trackReply(evt());
  await tracker.moveStage('A@acme.co.uk ', 'kobestarr', 'Proposal sent');
  assert.strictEqual((await tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Call booked')).moved, false);
  assert.strictEqual((await tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Won')).moved, true);
  assert.strictEqual(fake.state.opps[0].status, 'won');
  assert.strictEqual((await tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Call booked')).moved, false);
  assert.strictEqual((await tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Call booked', { allowBackwards: true })).moved, true);
  assert.strictEqual(fake.state.opps[0].status, 'open');
});
test('moveStage works on another pipeline (Marketplace) via the pipeline option', async () => {
  const { tracker, fake } = mk();
  fake.state.pipelines.LOC_K.push({ id: 'pl_mkt', name: 'Marketplace', locationId: 'LOC_K', stages: ['New', 'Quoted', 'Booked'].map((n, i) => ({ id: 'mkt_' + n, name: n, position: i + 1 })) });
  await tracker.trackReply(evt());
  const c = fake.state.contacts[0];
  fake.state.opps.push({ id: 'mk1', locationId: 'LOC_K', pipelineId: 'pl_mkt', pipelineStageId: 'mkt_New', contactId: c.id, status: 'open', name: 'x' });
  assert.strictEqual((await tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Quoted', { pipeline: 'Marketplace' })).moved, true);
  assert.strictEqual(fake.state.opps.find((o) => o.id === 'mk1').pipelineStageId, 'mkt_Quoted');
  assert.strictEqual((await tracker.moveStage('a@acme.co.uk', 'kobestarr', 'New', { pipeline: 'Marketplace' })).moved, false);
  assert.strictEqual(fake.state.opps.find((o) => o.pipelineId === 'pl_LOC_K').pipelineStageId, 'LOC_K_Interested', 'Cold Email deal untouched');
});

// ---------- pipelines ----------
test('missing Cold Email pipeline gives an actionable error', async () => {
  await assert.rejects(() => mk({ fake: { pipelines: false } }).tracker.trackReply(evt()), /ghl-setup\.js --apply/);
});
test('two pipelines named Cold Email is an error, never silently picked', async () => {
  const { tracker, fake } = mk();
  fake.state.pipelines.LOC_K.push({ id: 'dup', name: 'cold email', locationId: 'LOC_K', stages: [] });
  await assert.rejects(() => tracker.trackReply(evt()), /Two pipelines named "Cold Email"/);
  const r = await tracker.ensurePipelines({ brands: ['kobestarr'] });
  assert.strictEqual(r[0].status, 'error'); assert.match(r[0].detail, /Two pipelines/);
});
test('pipeline cache expires after 10 minutes', async () => {
  let t = 1000; const { tracker, fake } = mk({ tracker: { now: () => t } });
  const pipeCalls = () => fake.state.calls.filter((c) => c.path === '/opportunities/pipelines').length;
  await tracker.trackReply(evt()); await tracker.trackReply(evt({ text: 'b', date: '2026-10-19' }));
  assert.strictEqual(pipeCalls(), 1);
  t += 11 * 60 * 1000; await tracker.trackReply(evt({ text: 'c', date: '2026-10-20' }));
  assert.strictEqual(pipeCalls(), 2);
});
test('ensurePipelines: ok writes nothing; create sends 7 stages in order with positions from 1; dry run writes nothing', async () => {
  let x = mk();
  const ok = await x.tracker.ensurePipelines({});
  assert.deepStrictEqual(ok.map((r) => r.status), ['ok', 'ok', 'ok']); assert.strictEqual(x.fake.writes().length, 0);
  assert.deepStrictEqual(ok.map((r) => r.locationName), ['Kobestarr Digital', 'Stripped Media', 'DealFlow Media']);
  x = mk({ fake: { pipelines: false } });
  assert.deepStrictEqual((await x.tracker.ensurePipelines({ dryRun: true })).map((r) => r.status), ['would_create', 'would_create', 'would_create']);
  assert.strictEqual(x.fake.writes().length, 0);
  const r = await x.tracker.ensurePipelines({ brands: ['stripped'] });
  assert.strictEqual(r[0].status, 'created');
  const w = x.fake.writes(); assert.strictEqual(w.length, 1);
  assert.deepStrictEqual(w[0].body.stages.map((s) => s.name), STAGES); assert.deepStrictEqual(w[0].body.stages.map((s) => s.position), [1, 2, 3, 4, 5, 6, 7]);
});
test('ensurePipelines: wrong stages reported not edited; brand without credentials reported; guard failure reported', async () => {
  let x = mk(); x.fake.state.pipelines.LOC_K[0].stages.pop();
  const r = await x.tracker.ensurePipelines({});
  assert.strictEqual(r[0].status, 'mismatch'); assert.match(r[0].detail, /Lost/); assert.strictEqual(x.fake.writes().length, 0);
  x = mk({ creds: { kobestarr: FAKE_CREDS.kobestarr } });
  assert.strictEqual((await x.tracker.ensurePipelines({})).find((q) => q.brand === 'stripped').status, 'no_credentials');
  x = mk({ fake: { pipelines: false, locationNames: { LOC_K: 'Wrong' } } });
  const g = await x.tracker.ensurePipelines({ brands: ['kobestarr'], dryRun: false });
  assert.strictEqual(g[0].status, 'error'); assert.strictEqual(x.fake.writes().length, 0);
});

// ---------- CLI transport ----------
test('cli: covered calls use the CLI (never a list command), gaps use fetch', async () => {
  const { tracker, fake, fx } = mk({ cli: true });
  await tracker.trackReply(evt());
  const cmds = fx.calls.map((c) => `${c.args[2]} ${c.args[3]}`);
  assert.deepStrictEqual(cmds, ['locations get', 'contacts add-tag', 'opportunities pipelines', 'opportunities create']);
  assert.ok(fx.calls.every((c) => c.file === '/cli/ghlp' && c.args[0] === 'kobestarr' && c.args[1] === '--json'));
  const paths = fake.state.calls.map((c) => c.path);
  for (const p of ['/contacts/upsert', '/opportunities/search']) assert.ok(paths.includes(p), p);
});
test('cli: brand routes to the matching ghlp profile; no-backwards and idempotency hold', async () => {
  const { tracker, fake, fx } = mk({ cli: true });
  await tracker.trackReply(evt({ mailbox: 'x@dealflowmedia.pro' }));
  assert.ok(fx.calls.every((c) => c.args[0] === 'dealflow'));
  const k = mk({ cli: true });
  await k.tracker.trackReply(evt()); await k.tracker.moveStage('a@acme.co.uk', 'kobestarr', 'Call booked');
  await k.tracker.trackReply(evt({ label: 'maybe', text: 'q', date: '2026-10-20' })); await k.tracker.trackReply(evt({ label: 'maybe', text: 'q', date: '2026-10-20' }));
  assert.strictEqual(k.fake.state.opps.length, 1); assert.strictEqual(k.fake.state.opps[0].pipelineStageId, 'LOC_K_Call booked'); assert.strictEqual(notesOf(k.fake).length, 2);
});
test('cli: dry run makes no calls; 5xx after a CLI write re-reads (no duplicate deal)', async () => {
  let x = mk({ cli: true, tracker: { dryRun: true } });
  await x.tracker.trackReply(evt()); assert.strictEqual(x.fx.calls.length + x.fake.state.calls.length, 0);
  x = mk({ cli: true, fake: { failures: [{ times: 1, status: 503, afterApply: true, match: (m, p) => m === 'POST' && p === '/opportunities/' }] } });
  await x.tracker.trackReply(evt()); assert.strictEqual(x.fake.state.opps.length, 1);
});
test('cli: ensurePipelines check works with no stored tokens (guard via CLI only)', async () => {
  const x = mk({ cli: true, creds: { kobestarr: { locationId: 'LOC_K' }, stripped: { locationId: 'LOC_S' }, dealflow: { locationId: 'LOC_D' } } });
  assert.deepStrictEqual((await x.tracker.ensurePipelines({})).map((r) => r.status), ['ok', 'ok', 'ok']);
});
