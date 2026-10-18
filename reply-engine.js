#!/usr/bin/env node
/**
 * Reply engine CLI. Run every 5 min by LaunchAgent com.kobestarr.reply-engine (reply-engine.sh).
 * Reads new replies from the VPS collector (clawdbot:/root/data/replies.jsonl) and new Mailead webhook events
 * (clawdbot:/opt/mailead-webhook/events.jsonl), then classifies, blocks, drafts and posts to Buzz ~outreach.
 * Never sends email.
 *
 * Usage: node reply-engine.js [--once] [--dry-run] [--live-llm] [--from-start]
 *                             [--replies-file F --events-file F]   (dry-run only: read local files, no ssh)
 *   --dry-run     print what would happen: no posts, no blocks, no state or offset writes, model stubbed
 *   --live-llm    with --dry-run, still call the real model (costs pennies)
 *   --from-start  first run reads the whole logs instead of starting at the end
 * First real run (no offset files) starts at the END of both logs so old replies are never re-posted.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');

const { processNew, emptyState } = require('./shared/outreach-core/replies/engine');
const { classifyReply } = require('./shared/outreach-core/replies/classify');
const { draftReply } = require('./shared/outreach-core/replies/draft');
const { blockEverywhere, makeFinderSuppress } = require('./shared/outreach-core/replies/block');
const { makeAnthropicLlm, loadAnthropicKey, MODELS } = require('./shared/outreach-core/replies/llm');
const { parseNewEvents } = require('./shared/outreach-core/notify/buzz-alerts');

const REPLIES_LOG = '/root/data/replies.jsonl';
const EVENTS_LOG = '/opt/mailead-webhook/events.jsonl';
const ssh = cmd => execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'clawdbot', cmd], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });

function readOffset(file) { try { return parseInt(fs.readFileSync(file, 'utf8'), 10) || 0; } catch { return null; } }

// New lines of a remote jsonl since the saved line offset. Returns { items, total, first }.
function readRemote(log, offsetFile, fromStart) {
  const total = parseInt(ssh(`wc -l < ${log}`).trim(), 10);
  if (!Number.isFinite(total)) throw new Error(`could not read length of ${log}`);
  let offset = readOffset(offsetFile);
  if (offset === null) {
    if (!fromStart) return { items: [], total, first: true };
    offset = 0;
  }
  if (total < offset) offset = 0; // rotated or truncated
  if (total === offset) return { items: [], total };
  return { items: parseNewEvents(ssh(`sed -n '${offset + 1},${total}p' ${log}`)), total };
}

const readLocal = f => ({ items: parseNewEvents(fs.readFileSync(f, 'utf8')), total: 0 });

function acquireLock(file) {
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < 10 * 60_000) return false; // another run is in progress
  } catch { /* no lock */ }
  fs.writeFileSync(file, String(process.pid));
  return true;
}

async function main(argv = process.argv.slice(2), { env = process.env, log = console.log, now = () => new Date() } = {}) {
  const has = f => argv.includes(f);
  const val = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const DRY = has('--dry-run');
  const repliesFile = val('--replies-file'), eventsFile = val('--events-file');
  if ((repliesFile || eventsFile) && !DRY) { log('--replies-file/--events-file are for --dry-run only'); return 2; }

  const root = __dirname;
  const stateDir = env.REPLY_ENGINE_STATE_DIR || path.join(os.homedir(), '.config', 'outreach-alerts');
  const stateFile = path.join(stateDir, 'reply-engine-state.json');
  const offReplies = path.join(stateDir, 'reply-engine-replies-offset');
  const offEvents = path.join(stateDir, 'reply-engine-events-offset');
  const lockFile = path.join(stateDir, 'reply-engine.lock');
  const dncPath = env.REPLY_ENGINE_DNC || path.join(root, 'data', 'do-not-contact.txt');
  const ledgerPath = env.REPLY_ENGINE_LEDGER || path.join(root, 'data', 'sent-ledger.txt');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'harvey.json'), 'utf8'));

  if (!DRY) {
    fs.mkdirSync(stateDir, { recursive: true });
    if (!acquireLock(lockFile)) { log('another run is in progress, skipping'); return 0; }
  }
  try {
    // ---- inputs
    const rep = repliesFile ? readLocal(repliesFile) : readRemote(REPLIES_LOG, offReplies, has('--from-start'));
    const ev = eventsFile ? readLocal(eventsFile) : readRemote(EVENTS_LOG, offEvents, has('--from-start'));
    if (!DRY) {
      if (rep.first) fs.writeFileSync(offReplies, String(rep.total));
      if (ev.first) fs.writeFileSync(offEvents, String(ev.total));
    }
    let state = emptyState();
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* first run */ }
    if (DRY) state = JSON.parse(JSON.stringify(state));

    // ---- model (stubbed in dry-run unless --live-llm)
    const useModel = !DRY || has('--live-llm');
    let classifyLlm, draftLlm;
    if (useModel) {
      const key = loadAnthropicKey();
      classifyLlm = makeAnthropicLlm({ apiKey: key, model: MODELS.classify, maxTokens: 300 });
      draftLlm = makeAnthropicLlm({ apiKey: key, model: MODELS.draft, maxTokens: 700 });
    } else {
      draftLlm = async () => 'Hi there,\n\n(dry run: Sonnet would write the draft here)\n\n[BOOKING LINK]\n\nKobi';
    }

    // ---- effects (dry-run prints instead)
    const dry = s => log(`[dry-run] ${s}`);
    const deps = {
      now,
      classify: r => classifyReply(r, { llm: classifyLlm, now: now() }),
      draft: a => draftReply(a, { llm: draftLlm, config }),
      post: DRY ? async t => dry(`would post:\n${t}\n`) : require('./shared/outreach-core/notify/buzz-post').post,
      block: DRY
        ? async (email, reason, label) => { dry(`would block ${email} (${label}: ${reason}) in Mailead, email finder, do-not-contact, ledger`); return { complete: true }; }
        : async (email, reason, label) => blockEverywhere(email, reason, {
          label, maileadReq: require('./shared/outreach-core/campaigns/mailead-client').req,
          finderSuppress: makeFinderSuppress(promisify(execFile)),
          readFile: p => fs.readFileSync(p, 'utf8'), appendFile: (p, t) => fs.appendFileSync(p, t),
          dncPath, ledgerPath, now, source: 'reply-engine',
        }),
      tracker: DRY ? { trackReply: async e => dry(`would track ${e.email} as ${e.label}`) } : loadTracker(root),
    };

    const res = await processNew({ replies: rep.items, events: ev.items, state }, deps);
    for (const a of res.actions) log(`${DRY ? '[dry-run] ' : ''}${a.type} ${a.label} ${a.email}${a.reason ? ` (${a.reason})` : ''}`);
    for (const e of res.errors) log(`ERROR ${e.where} ${e.email || ''}: ${e.message}`);

    if (!DRY) {
      fs.writeFileSync(stateFile, JSON.stringify(state));
      // a reply that errored (say Buzz was down) is re-read next run; msgids already handled are skipped via state
      if (!rep.first && !res.errors.some(e => e.where === 'reply')) fs.writeFileSync(offReplies, String(rep.total));
      if (!ev.first) fs.writeFileSync(offEvents, String(ev.total));
    }
    log(`${now().toISOString()} replies ${rep.items.length}, events ${ev.items.length}, actions ${res.actions.length}, errors ${res.errors.length}`);
    return res.errors.length ? 1 : 0;
  } finally {
    if (!DRY) { try { fs.unlinkSync(lockFile); } catch { /* already gone */ } }
  }
}

// GHL tracker is built by another engineer: use it if it is there, otherwise do nothing.
function loadTracker(root) {
  try { return require(path.join(root, 'shared', 'outreach-core', 'replies', 'tracker')); } catch { return undefined; }
}

if (require.main === module) main().then(c => process.exit(c)).catch(e => { console.error(`${new Date().toISOString()} ${e.message}`); process.exit(1); });
module.exports = { main };
