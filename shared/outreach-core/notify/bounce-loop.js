/**
 * Mailead bounces -> Buzz alert AND the email finder's memory (so a bounced address and its wrong format are unlearned).
 *  - data/bounces-imported.txt is the ledger of addresses already imported: an address is imported once, ever.
 *    data/bounced.txt is the plain bounce list; lines in it that were never imported are imported once on the first run.
 *  - If the finder cannot load or throws, the alert still posts, the address waits in data/bounces-queue.txt and ONE
 *    Buzz notice says so. The next run that can reach the finder imports the queue first and clears it.
 *  - Anything that must not be lost (queue write, Buzz post) throws, so the caller leaves the event-log offset where it was.
 * The bounced address comes from the receiver's leadEmail() rule, never from formatEvent, and never our own mailboxes.
 */
const fs = require('fs'), path = require('path');
const { formatEvent } = require('./buzz-alerts');
const { leadEmail } = require('./lead-email');

const lc = s => String(s == null ? '' : s).trim().toLowerCase();

function fileLedger(file, { today = () => new Date().toISOString().slice(0, 10) } = {}) {
  const have = new Set();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith('#')) have.add(lc(t.split(/\s+/)[0]));
    }
  }
  return {
    has: e => have.has(lc(e)),
    all: () => [...have],
    add(e, campaign = '') {
      const a = lc(e);
      if (!a || have.has(a)) return;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${a} ${today()} campaign:${campaign}\n`);
      have.add(a);
    },
  };
}

function fileQueue(file) {
  const read = () => (fs.existsSync(file) ? [...new Set(fs.readFileSync(file, 'utf8').split(/\r?\n/).map(lc).filter(Boolean))] : []);
  const write = list => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, list.length ? list.join('\n') + '\n' : ''); };
  return {
    list: read,
    add(e) { const l = read(); const a = lc(e); if (a && !l.includes(a)) { l.push(a); write(l); } },
    remove(e) { const a = lc(e); const l = read(); if (l.includes(a)) write(l.filter(x => x !== a)); },
  };
}

/**
 * The Mailead payload carries no documented hard/soft field (receiver sample data has none). Until it does, a bounce is HARD
 * unless the event says otherwise. Only hard bounces teach the finder; soft ones (mailbox full, temporary) are logged.
 */
function bounceKind(ev) {
  const hint = [ev && ev.bounce_type, ev && ev.bounceType, ev && ev.type, ev && ev.bounce_reason, ev && ev.reason, ev && ev.error]
    .filter(x => typeof x === 'string').join(' ');
  return /soft|temporar|transient|mailbox full|over quota|\b4\.\d\.\d\b/i.test(hint) ? 'soft' : 'hard';
}

/**
 * ledger  = addresses already imported into the finder (bounces-imported.txt)
 * record  = the plain bounce list (bounced.txt); new imports are added to it too
 * backlog = addresses from the old bounced.txt that were never imported; imported once, idempotently
 */
async function handleEvents(events, { post, importBounce, ledger, queue, record = null, backlog = [], dryRun = false, log = () => {} }) {
  const out = { posted: 0, imported: 0, queued: 0, skipped: 0 };

  // 1. Drain the queue and the never-imported backlog first (a finder that was down earlier may be back).
  if (!dryRun) {
    const pending = [...new Set([...queue.list(), ...backlog.map(lc)])];
    for (const addr of pending) {
      if (ledger.has(addr)) { queue.remove(addr); continue; }
      try { await importBounce(addr, 'mailead bounce (queued or earlier)'); ledger.add(addr, 'queued'); queue.remove(addr); out.imported++; }
      catch (e) { log(`queued ${addr} still not imported: ${e.message}`); }
    }
  }

  // 2. This run's events: import first, then the alert.
  const newlyQueued = [];
  let lastError = '';
  for (const ev of events) {
    if (ev && ev.event_type === 'email_bounced' && !dryRun) {
      const addr = lc(leadEmail(ev));
      if (!addr) { out.skipped++; log('bounce with only our own mailboxes in it: not imported'); }
      else if (bounceKind(ev) === 'soft') { out.skipped++; log(`soft bounce for ${addr}: not imported (only hard bounces teach the finder)`); }
      else if (ledger.has(addr)) { out.skipped++; }
      else {
        try { await importBounce(addr, `mailead bounce ${ev.campaign_name || ''}`.trim()); ledger.add(addr, ev.campaign_name || ''); if (record && !record.has(addr)) record.add(addr, ev.campaign_name || ''); queue.remove(addr); out.imported++; }
        catch (e) {
          lastError = e.message;
          queue.add(addr); // if this throws the run throws and the offset stays put
          if (!newlyQueued.includes(addr)) newlyQueued.push(addr);
        }
      }
    }
    const msg = formatEvent(ev);
    if (msg) { await post(msg); out.posted++; }
  }

  // 3. One notice per run when the finder could not take new bounces.
  out.queued = newlyQueued.length;
  if (newlyQueued.length) {
    await post(`Email finder could not take ${newlyQueued.length} bounce${newlyQueued.length > 1 ? 's' : ''} (${lastError}). Queued in data/bounces-queue.txt and retried automatically on the next run. Nothing is lost.`);
    out.posted++;
  }
  return out;
}

module.exports = { bounceKind, handleEvents, fileLedger, fileQueue };
