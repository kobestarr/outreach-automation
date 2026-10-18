// tests/reply-wiring.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { main, readRemote, resolveDataDir, writeAtomic, DEFAULT_DATA_DIR } = require('../reply-engine');

const root = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'reply-wiring-'));

test('the wrapper and the plist put ~/.local/bin on PATH and the plist sets OA_DATA_DIR', () => {
  const sh = fs.readFileSync(path.join(root, 'reply-engine.sh'), 'utf8');
  const plist = fs.readFileSync(path.join(root, 'config/launchd/com.kobestarr.reply-engine.plist'), 'utf8');
  assert.match(sh, /\.local\/bin/);
  assert.match(plist, /\/\.local\/bin/);
  assert.match(plist, /<key>OA_DATA_DIR<\/key>\s*<string>\/Users\/kobestarr\/Development\/One Hour Vibe Coder\/outreach-automation\/data<\/string>/);
});

test('block wiring calls the finder by absolute path', async () => {
  const { makeFinderSuppress } = require('../shared/outreach-core/replies/block');
  const seen = [];
  await makeFinderSuppress(async (bin, args) => seen.push([bin, args]))('a@b.com', 'x');
  assert.ok(path.isAbsolute(seen[0][0]));
});

test('data dir: OA_DATA_DIR wins, default is the main checkout', () => {
  assert.strictEqual(resolveDataDir({ OA_DATA_DIR: '/x/data' }), '/x/data');
  assert.strictEqual(resolveDataDir({}), DEFAULT_DATA_DIR);
  assert.strictEqual(DEFAULT_DATA_DIR, '/Users/kobestarr/Development/One Hour Vibe Coder/outreach-automation/data');
});

test('a live run from a worktree refuses unless OA_DATA_DIR is set', async () => {
  const lines = [];
  const ssh = () => { throw new Error('must not reach ssh'); };
  const code = await main(['--once'], { env: { REPLY_ENGINE_STATE_DIR: path.join(tmp(), 's') }, log: l => lines.push(l), isWorktree: () => true, ssh });
  assert.strictEqual(code, 2);
  assert.match(lines.join('\n'), /OA_DATA_DIR/);
});

// ---- readRemote with an injected ssh ----
function fakeSsh(files) {
  const calls = [];
  const ssh = cmd => {
    calls.push(cmd);
    const f = Object.keys(files).find(k => cmd.includes(k));
    let m;
    if ((m = cmd.match(/wc -l/))) return f == null ? '0\n' : `${files[f].split('\n').filter(Boolean).length}\n`;
    if ((m = cmd.match(/sed -n '(\d+),(\d+)p'/))) { const lines = files[f].split('\n').filter(Boolean); return lines.slice(+m[1] - 1, +m[2]).join('\n') + '\n'; }
    throw new Error('unexpected ' + cmd);
  };
  return { ssh, calls };
}
const L = n => Array.from({ length: n }, (_, i) => JSON.stringify({ kind: 'inbound', msgid: `<${i}>` })).join('\n') + '\n';

test('first run never re-posts old replies: it baselines at the end and reads nothing', () => {
  const dir = tmp(); const off = path.join(dir, 'off');
  const { ssh, calls } = fakeSsh({ '/root/data/replies.jsonl': L(40) });
  const r = readRemote('/root/data/replies.jsonl', off, false, ssh);
  assert.deepStrictEqual([r.items.length, r.total, r.first], [0, 40, true]);
  assert.ok(!calls.some(c => c.includes('sed -n')), 'must not even fetch old lines');
});

test('later runs read only lines after the saved offset', () => {
  const dir = tmp(); const off = path.join(dir, 'off'); fs.writeFileSync(off, '40');
  const { ssh } = fakeSsh({ '/root/data/replies.jsonl': L(43) });
  const r = readRemote('/root/data/replies.jsonl', off, false, ssh);
  assert.deepStrictEqual(r.items.map(i => i.msgid), ['<40>', '<41>', '<42>']);
  assert.strictEqual(r.total, 43);
});

test('--from-start reads everything on a first run', () => {
  const { ssh } = fakeSsh({ '/root/data/replies.jsonl': L(3) });
  assert.strictEqual(readRemote('/root/data/replies.jsonl', path.join(tmp(), 'off'), true, ssh).items.length, 3);
});

test('a missing remote file counts as 0 lines, never a throw', () => {
  const { ssh, calls } = fakeSsh({});
  const r = readRemote('/root/data/replies.jsonl', path.join(tmp(), 'off'), false, ssh);
  assert.deepStrictEqual([r.items.length, r.total, r.first], [0, 0, true]);
  assert.match(calls[0], /\[ -f \/root\/data\/replies\.jsonl \]/);
});

test('a rotated or truncated log restarts from the top', () => {
  const dir = tmp(); const off = path.join(dir, 'off'); fs.writeFileSync(off, '50');
  const { ssh } = fakeSsh({ '/root/data/replies.jsonl': L(2) });
  assert.strictEqual(readRemote('/root/data/replies.jsonl', off, false, ssh).items.length, 2);
});

test('writeAtomic leaves no temp file and replaces in one step', () => {
  const dir = tmp(); const f = path.join(dir, 'state.json');
  writeAtomic(f, '{"a":1}'); writeAtomic(f, '{"a":2}');
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '{"a":2}');
  assert.deepStrictEqual(fs.readdirSync(dir), ['state.json']);
});

// ---- whole runs with injected effects ----
function liveOpts(dir, extra = {}) {
  const posts = [];
  return { posts, opts: { env: { REPLY_ENGINE_STATE_DIR: dir, OA_DATA_DIR: dir }, log: () => {}, isWorktree: () => false,
    post: async t => { posts.push(t); }, llm: { classify: undefined, draft: async () => 'Hi,\n\nx [BOOKING LINK]\n\nKobi' }, now: () => new Date('2026-10-20T12:00:00Z'), ...extra } };
}

test('--answered silences a reminder by hand and needs no network', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'reply-engine-state.json'), JSON.stringify({ awaiting: { 'dana@editpep.bio': { ts: Date.parse('2026-10-18T09:00:00Z'), label: 'warm', reAlerted: false } } }));
  const { opts } = liveOpts(dir, { ssh: () => { throw new Error('no network for --answered'); } });
  const code = await main(['--answered', 'Dana@EditPep.bio'], opts);
  assert.strictEqual(code, 0);
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'reply-engine-state.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(st.awaiting), []);
  assert.ok(st.sent['dana@editpep.bio'] > 0);
});

test('a failed VPS read still runs the 24h reminder and does not move the offsets', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'reply-engine-replies-offset'), '10');
  fs.writeFileSync(path.join(dir, 'reply-engine-events-offset'), '10');
  fs.writeFileSync(path.join(dir, 'reply-engine-state.json'), JSON.stringify({ awaiting: { 'dana@editpep.bio': { ts: Date.parse('2026-10-18T09:00:00Z'), label: 'warm', firstName: 'Dana', reAlerted: false } } }));
  const { opts, posts } = liveOpts(dir, { ssh: () => { throw new Error('ssh down'); } });
  const code = await main(['--once'], opts);
  assert.strictEqual(code, 1);
  assert.ok(posts.some(p => /Still unanswered/.test(p)));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'reply-engine-replies-offset'), 'utf8'), '10');
});

test('missing GHL tracker module triggers the daily warning on a live run', async () => {
  const dir = tmp();
  const { opts, posts } = liveOpts(dir, { ssh: cmd => (/wc -l/.test(cmd) ? '0\n' : ''), tracker: null });
  await main(['--once'], opts);
  assert.ok(posts.some(p => /tracker/i.test(p)));
});

test('state is written atomically and pruned', async () => {
  const dir = tmp();
  const old = Date.parse('2026-08-01T00:00:00Z');
  fs.writeFileSync(path.join(dir, 'reply-engine-state.json'), JSON.stringify({ seen: { '<old>': old, '<new>': Date.parse('2026-10-19T00:00:00Z') } }));
  const { opts } = liveOpts(dir, { ssh: cmd => (/wc -l/.test(cmd) ? '0\n' : ''), tracker: { trackReply: async () => {} } });
  await main(['--once'], opts);
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'reply-engine-state.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(st.seen), ['<new>']);
  assert.ok(!fs.readdirSync(dir).some(f => f.endsWith('.tmp')));
});
