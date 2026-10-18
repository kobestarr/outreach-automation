#!/usr/bin/env node
/**
 * Post new Mailead replies and bounces to the Buzz ~outreach channel.
 * Run every 5 min by LaunchAgent com.kobestarr.mailead-alerts-buzz.
 * Reads new lines of clawdbot:/opt/mailead-webhook/events.jsonl since the saved line offset.
 * First run (no offset file) starts at the current end: old events are never re-posted.
 * Each bounce is also imported into the email finder's memory (once, ledgered in data/bounced.txt); if the finder
 * cannot be reached the address waits in data/bounces-queue.txt and one Buzz notice says so (shared/outreach-core/notify/bounce-loop.js).
 *
 * Usage: node mailead-alerts-buzz.js [--dry-run] [--post "message"]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseNewEvents } = require('./shared/outreach-core/notify/buzz-alerts');
const { handleEvents, fileLedger, fileQueue } = require('./shared/outreach-core/notify/bounce-loop');
const { resolveDataDir } = require('./shared/outreach-core/campaigns/send-guards');

const CHANNEL = '22517fe0-56ff-48d6-96a6-e2c668032c6f'; // Buzz ~outreach
const LOG = '/opt/mailead-webhook/events.jsonl';
const STATE_DIR = path.join(os.homedir(), '.config', 'outreach-alerts');
const OFFSET_FILE = path.join(STATE_DIR, 'events-offset');
const BUZZ = path.join(os.homedir(), '.local', 'bin', 'buzz');
const DRY = process.argv.includes('--dry-run');

function buzzEnv() {
  const env = { ...process.env };
  const file = path.join(os.homedir(), '.buzz', '.secrets', 'buzz.env');
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

function post(content) {
  if (DRY) { console.log('[dry-run] would post:\n' + content + '\n'); return; }
  execFileSync(BUZZ, ['messages', 'send', '--channel', CHANNEL, '--content', '-'], { input: content, env: buzzEnv(), stdio: ['pipe', 'ignore', 'inherit'] });
}

const ssh = cmd => execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'clawdbot', cmd], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });

async function main() {
  const t = Math.max(process.argv.indexOf('--post'), process.argv.indexOf('--test'));
  if (t >= 0) { post(process.argv[t + 1] || 'Outreach alerts test'); console.log('posted'); return; }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  const total = parseInt(ssh(`wc -l < ${LOG}`).trim(), 10);
  if (!Number.isFinite(total)) throw new Error('could not read event log length');
  if (!fs.existsSync(OFFSET_FILE)) { fs.writeFileSync(OFFSET_FILE, String(total)); console.log(`first run: starting at line ${total}`); return; }

  let offset = parseInt(fs.readFileSync(OFFSET_FILE, 'utf8'), 10) || 0;
  if (total < offset) offset = 0; // log was rotated or truncated
  if (total === offset) return;

  const chunk = ssh(`sed -n '${offset + 1},${total}p' ${LOG}`);
  const dataDir = resolveDataDir({ dryRun: DRY });
  // The finder opens lazily, only if there is a bounce to import; a load failure surfaces as an import failure (queued, one notice).
  let finder = null;
  const importBounce = (email, why) => {
    if (!finder) finder = require('./shared/outreach-core/enrichment/email-finder-adapter').openFinder({ maxCredits: 0, maxIcypeas: 0 });
    return finder.importBounce(email, why);
  };
  const bouncedList = fileLedger(path.join(dataDir, 'bounced.txt'));
  let res;
  try {
    res = await handleEvents(parseNewEvents(chunk), {
      post, importBounce, dryRun: DRY, log: console.log,
      skipReplies: !!(JSON.parse(fs.readFileSync(path.join(__dirname, 'config/harvey.json'), 'utf8')).replyEngineLive),
      ledger: fileLedger(path.join(dataDir, 'bounces-imported.txt')),
      record: bouncedList,
      backlog: bouncedList.bounces(),
      queue: fileQueue(path.join(dataDir, 'bounces-queue.txt')),
    });
  } finally {
    try { if (finder) finder.close(); } catch { /* best effort */ }
  }
  if (!DRY) fs.writeFileSync(OFFSET_FILE, String(total)); // only after every import-or-queue and every post succeeded
  console.log(`${new Date().toISOString()} lines ${offset + 1}-${total}, posted ${res.posted}, bounces imported ${res.imported}, queued ${res.queued}`);
}

module.exports = { handleEvents };

if (require.main === module) {
  main().catch(e => { console.error(`${new Date().toISOString()} ${e.message}`); process.exit(1); });
}
