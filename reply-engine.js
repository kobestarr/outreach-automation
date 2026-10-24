#!/usr/bin/env node
/**
 * Reply engine CLI. Run every 5 min by LaunchAgent com.kobestarr.reply-engine (reply-engine.sh).
 * Reads new replies from the VPS collector (clawdbot:/root/data/replies.jsonl) and new Mailead webhook events
 * (clawdbot:/opt/mailead-webhook/events.jsonl), then classifies, blocks, drafts and posts to Buzz ~outreach.
 * Never sends email.
 *
 * Usage: node reply-engine.js [--once] [--dry-run] [--live-llm] [--from-start] [--answered <email>]
 *                             [--replies-file F --events-file F]   (dry-run only: read local files, no ssh)
 *   --dry-run     print what would happen: no posts, no blocks, no state or offset writes, model stubbed
 *   --live-llm    with --dry-run, still call the real model (costs pennies)
 *   --from-start  first run reads the whole logs instead of starting at the end
 *   --answered E  mark E as answered by hand (silences the 24h reminder, e.g. after answering in the Unibox)
 * Ledgers live in OA_DATA_DIR (default: the main checkout's data dir). A live run from a git worktree refuses without it.
 * First real run (no offset files) starts at the END of both logs so old replies are never re-posted.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');

const { processNew, emptyState, pruneState } = require('./shared/outreach-core/replies/engine');
const { classifyReply } = require('./shared/outreach-core/replies/classify');
const { draftReply } = require('./shared/outreach-core/replies/draft');
const { blockEverywhere, makeFinderSuppress } = require('./shared/outreach-core/replies/block');
const { makeAnthropicLlm, loadAnthropicKey, MODELS } = require('./shared/outreach-core/replies/llm');
const { parseNewEvents } = require('./shared/outreach-core/notify/buzz-alerts');

const REPLIES_LOG = '/root/data/replies.jsonl';
const EVENTS_LOG = '/opt/mailead-webhook/events.jsonl';
const DEFAULT_DATA_DIR = '/Users/kobestarr/Development/One Hour Vibe Coder/outreach-automation/data';
const resolveDataDir = env => env.OA_DATA_DIR || DEFAULT_DATA_DIR;
const realSsh = cmd => execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'clawdbot', cmd], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
const isWorktreeDir = root => { try { return fs.statSync(path.join(root, '.git')).isFile(); } catch { return false; } };

function readOffset(file) { try { return parseInt(fs.readFileSync(file, 'utf8'), 10) || 0; } catch { return null; } }

// write then rename, so a crash never leaves half a file
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// New lines of a remote jsonl since the saved line offset. Returns { items, total, first }.
// A log that does not exist yet counts as 0 lines. First run (no offset file) starts at the END
// so old replies are never re-posted, unless fromStart is set.
function readRemote(log, offsetFile, fromStart, ssh = realSsh) {
  const total = parseInt(ssh(`[ -f ${log} ] && wc -l < ${log} || echo 0`).trim(), 10);
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

async function main(argv = process.argv.slice(2), opts = {}) {
  const { env = process.env, log = console.log, now = () => new Date(), ssh = realSsh } = opts;
  const root = __dirname;
  const has = f => argv.includes(f);
  const val = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const DRY = has('--dry-run');
  const repliesFile = val('--replies-file'), eventsFile = val('--events-file');
  if ((repliesFile || eventsFile) && !DRY) { log('--replies-file/--events-file are for --dry-run only'); return 2; }

  const stateDir = env.REPLY_ENGINE_STATE_DIR || path.join(os.homedir(), '.config', 'outreach-alerts');
  const stateFile = path.join(stateDir, 'reply-engine-state.json');
  const offReplies = path.join(stateDir, 'reply-engine-replies-offset');
  const offEvents = path.join(stateDir, 'reply-engine-events-offset');
  const lockFile = path.join(stateDir, 'reply-engine.lock');
  const loadState = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return emptyState(); } };

  // by hand: "I answered this one in the Unibox"
  if (has('--answered')) {
    const email = String(val('--answered') || '').trim().toLowerCase();
    if (!email.includes('@')) { log('usage: node reply-engine.js --answered <email>'); return 2; }
    fs.mkdirSync(stateDir, { recursive: true });
    const st = loadState();
    st.sent = st.sent || {}; st.awaiting = st.awaiting || {};
    st.sent[email] = now().getTime();
    delete st.awaiting[email];
    writeAtomic(stateFile, JSON.stringify(st));
    log(`marked ${email} as answered`);
    return 0;
  }

  const dataDir = resolveDataDir(env);
  const dncPath = env.REPLY_ENGINE_DNC || path.join(dataDir, 'do-not-contact.txt');
  const ledgerPath = env.REPLY_ENGINE_LEDGER || path.join(dataDir, 'sent-ledger.txt');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'harvey.json'), 'utf8'));

  if (!DRY) {
    const worktree = (opts.isWorktree || isWorktreeDir)(root);
    if (worktree && !env.OA_DATA_DIR) { log('refusing to run live from a git worktree without OA_DATA_DIR (the ledgers live in the main checkout)'); return 2; }
    fs.mkdirSync(stateDir, { recursive: true });
    // fail closed: the do-not-contact list and ledger must already exist where we are pointed. Never created here.
    const missing = [dncPath, ledgerPath].filter(f => !fs.existsSync(f));
    if (missing.length) {
      log(`refusing to run: missing ${missing.join(', ')} (data dir ${dataDir})`);
      const marker = path.join(stateDir, 'reply-engine-data-alert');
      if (now().getTime() - (readOffset(marker) || 0) > 24 * 3600_000) {
        try {
          await (opts.post || require('./shared/outreach-core/notify/buzz-post').post)(`Reply engine NOT running: cannot find ${missing.map(f => path.basename(f)).join(' and ')} in ${dataDir}. Check OA_DATA_DIR. Nothing was blocked or posted. This alert repeats once a day.`);
          writeAtomic(marker, String(now().getTime()));
        } catch (e) { log(`could not post the alert: ${e.message}`); }
      }
      return 2;
    }
    if (!acquireLock(lockFile)) { log('another run is in progress, skipping'); return 0; }
  }
  try {
    // ---- inputs: a failed read must not stop the timers (Unibox fallback, 24h reminder)
    let readFailed = false;
    const safeRead = (fn, label) => { try { return fn(); } catch (e) { readFailed = true; log(`ERROR read ${label}: ${e.message}`); return { items: [], total: 0, failed: true }; } };
    const rep = repliesFile ? readLocal(repliesFile) : safeRead(() => readRemote(REPLIES_LOG, offReplies, has('--from-start'), ssh), 'replies');
    const ev = eventsFile ? readLocal(eventsFile) : safeRead(() => readRemote(EVENTS_LOG, offEvents, has('--from-start'), ssh), 'events');
    if (!DRY) {
      if (rep.first) writeAtomic(offReplies, String(rep.total));
      if (ev.first) writeAtomic(offEvents, String(ev.total));
    }
    let state = loadState();
    if (DRY) state = JSON.parse(JSON.stringify(state));

    // ---- model (stubbed in dry-run unless --live-llm)
    let classifyLlm, draftLlm;
    if (opts.llm) {
      classifyLlm = opts.llm.classify; draftLlm = opts.llm.draft;
    } else if (!DRY || has('--live-llm')) {
      const key = loadAnthropicKey();
      classifyLlm = makeAnthropicLlm({ apiKey: key, model: MODELS.classify, maxTokens: 300 });
      draftLlm = makeAnthropicLlm({ apiKey: key, model: MODELS.draft, maxTokens: 900 });
    } else {
      draftLlm = async () => 'Hi there,\n\n(dry run: Sonnet would write the draft here)\n\n[BOOKING LINK]\n\nKobi';
    }

    // ---- effects (dry-run prints instead)
    const dry = x => log(`[dry-run] ${x}`);
    const tracker = DRY ? { trackReply: async e => dry(`would track ${e.email} as ${e.label}`) } : (opts.tracker !== undefined ? opts.tracker : loadTracker(root));
    const deps = {
      now,
      classify: r => classifyReply(r, { llm: classifyLlm, now: now() }),
      draft: makeDraftDep(config, draftReply, draftLlm),
      post: DRY ? async t => dry(`would post:\n${t}\n`) : (opts.post || require('./shared/outreach-core/notify/buzz-post').post),
      block: DRY
        ? async (email, reason, label) => { dry(`would block ${email} (${label}: ${reason}) in Mailead, email finder, do-not-contact, ledger`); return { complete: true }; }
        : async (email, reason, label) => blockEverywhere(email, reason, {
          label, maileadReq: require('./shared/outreach-core/campaigns/mailead-client').req,
          finderSuppress: makeFinderSuppress(promisify(execFile)),
          readFile: p => fs.readFileSync(p, 'utf8'), appendFile: (p, t) => fs.appendFileSync(p, t),
          dncPath, ledgerPath, now, source: 'reply-engine',
        }),
      tracker: tracker || undefined,
      trackerMissing: !DRY && !tracker,
    };

    const res = await processNew({ replies: rep.items, events: ev.items, state }, deps);
    for (const a of res.actions) log(`${DRY ? '[dry-run] ' : ''}${a.type} ${a.label} ${a.email}${a.reason ? ` (${a.reason})` : ''}`);
    for (const e of res.errors) log(`ERROR ${e.where} ${e.email || ''}: ${e.message}`);

    if (!DRY) {
      pruneState(state, now().getTime());
      writeAtomic(stateFile, JSON.stringify(state));
      // a reply that errored (say Buzz was down) is re-read next run; msgids already handled are skipped via state
      if (!rep.first && !rep.failed && !res.errors.some(e => e.where === 'reply')) writeAtomic(offReplies, String(rep.total));
      if (!ev.first && !ev.failed) writeAtomic(offEvents, String(ev.total));
    }
    log(`${now().toISOString()} replies ${rep.items.length}, events ${ev.items.length}, actions ${res.actions.length}, errors ${res.errors.length}`);
    return res.errors.length || readFailed ? 1 : 0;
  } finally {
    if (!DRY) { try { fs.unlinkSync(lockFile); } catch { /* already gone */ } }
  }
}

// GHL tracker is built by another engineer: use it if it is there, otherwise do nothing.
function loadTracker(root) {
  try { return require(path.join(root, 'shared', 'outreach-core', 'replies', 'tracker')); } catch { return undefined; }
}

if (require.main === module) main().then(c => process.exit(c)).catch(e => { console.error(`${new Date().toISOString()} ${e.message}`); process.exit(1); });
// Kobi 20 Oct 2026: warm/maybe/referral replies alert only and we draft the answer together.
// config.draftReplies === false skips the model entirely; anything else keeps the old drafting.
function makeDraftDep(config, draftFn, llm) {
  if (config && config.draftReplies === false) return async () => ({ error: 'alert only: paste it to Claude and we draft it together' });
  return a => draftFn(a, { llm, config });
}

module.exports = { makeDraftDep, main, readRemote, resolveDataDir, writeAtomic, DEFAULT_DATA_DIR };
