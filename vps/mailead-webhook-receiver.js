#!/usr/bin/env node
// vps/mailead-webhook-receiver.js — receives Mailead webhook events (clawdbot VPS).
// Registered via Mailead POST /create_webhook {campaign_id, enabled_events, url}.
// Payload shape (from @taskmagic/piece-mailead sampleData):
//   { timestamp, event_type, campaign_name, lead_email_account, firstName,
//     lastName, companyName, companyWebsite, step, from_email_account }
// Actions:
//   email_bounced  -> remove lead from campaign + global blocklist + WhatsApp note
//   email_answered -> WhatsApp Kobi (audit needed) — OOO filtering happens at the Gmail layer
//   everything     -> append to EVENTS_LOG (jsonl) as source of truth
//
// Env/files: MAILEAD_KEY_FILE (default /root/.mailead-api-key)
//            WA_TOKEN_FILE    (default /root/.trendmine-internal-token)
//            PORT (default 3849), HOOK_SECRET (required, path segment)
const http = require('http');
const fs = require('fs');

const PORT = parseInt(process.env.PORT || '3849', 10);
const HOOK_SECRET = process.env.HOOK_SECRET;
const EVENTS_LOG = process.env.EVENTS_LOG || '/opt/mailead-webhook/events.jsonl';
const MAILEAD_KEY_FILE = process.env.MAILEAD_KEY_FILE || '/root/.mailead-api-key';
const WA_TOKEN_FILE = process.env.WA_TOKEN_FILE || '/root/.trendmine-internal-token';
const WA_BRIDGE = process.env.WA_BRIDGE || 'http://localhost:3848/send-direct';
const WA_TO = process.env.WA_TO || '447989746146';
const MAILEAD_BASE = 'https://2dxrjrlgtbxdztp2zjyksrus6a0bujtv.lambda-url.eu-central-1.on.aws';
const DRY = process.env.DRY === '1'; // log + classify only, no outbound actions

if (!HOOK_SECRET) { console.error('HOOK_SECRET required'); process.exit(1); }

const maileadKey = () => fs.readFileSync(MAILEAD_KEY_FILE, 'utf8').trim();

let campaignCache = { at: 0, byTitle: {} };
async function campaignIdByTitle(title) {
  if (Date.now() - campaignCache.at > 10 * 60 * 1000) {
    const r = await fetch(`${MAILEAD_BASE}/get_user_campaigns`, {
      method: 'POST', headers: { 'X-API-Key': maileadKey() }, signal: AbortSignal.timeout(20000),
    });
    const j = await r.json();
    campaignCache = { at: Date.now(), byTitle: Object.fromEntries((j.data?.campaigns || []).map(c => [c.title, c.id])) };
  }
  return campaignCache.byTitle[title] ?? null;
}

async function mailead(endpoint, body) {
  const r = await fetch(`${MAILEAD_BASE}/${endpoint}`, {
    method: 'POST', headers: { 'X-API-Key': maileadKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  return r.json().catch(() => ({}));
}

async function whatsapp(message) {
  const token = fs.readFileSync(WA_TOKEN_FILE, 'utf8').trim();
  await fetch(WA_BRIDGE, {
    method: 'POST',
    headers: { 'X-Internal-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: WA_TO, message, source: 'mailead-webhook' }),
    signal: AbortSignal.timeout(15000),
  }).catch(e => console.error('whatsapp failed:', e.message));
}

function logEvent(ev) {
  try {
    fs.mkdirSync(require('path').dirname(EVENTS_LOG), { recursive: true });
    fs.appendFileSync(EVENTS_LOG, JSON.stringify({ receivedAt: new Date().toISOString(), ...ev }) + '\n');
  } catch (e) { console.error('log failed:', e.message); }
}

// The lead's address: for replies the sample shows from_email_account = the replier.
// For bounces the bounced lead should be lead_email_account, but shapes are undocumented,
// so prefer whichever field is present and not one of our own sending domains.
const OWN_DOMAIN_HINTS = ['kobestarr', 'dealflowmedia', 'stripped', 'trykobestarr'];
function leadEmail(ev) {
  const cands = [ev.from_email_account, ev.lead_email_account].filter(Boolean);
  for (const c of cands) if (!OWN_DOMAIN_HINTS.some(h => String(c).toLowerCase().includes(h))) return c;
  return cands[0] || null;
}

async function handle(ev) {
  logEvent(ev);
  const email = leadEmail(ev);
  // NB: never use ev.lastName in notifications — in carrier campaigns it holds the insight phrase.
  const who = ev.firstName || email || 'unknown';
  const company = ev.companyName || 'unknown company';
  const campaign = ev.campaign_name || 'unknown campaign';

  if (ev.event_type === 'email_bounced' && email) {
    console.log(`bounce: ${email} (${campaign})`);
    if (!DRY) {
      const cid = await campaignIdByTitle(campaign);
      if (cid) await mailead('remove_lead', { campaign_id: cid, email_to_remove: email });
      await mailead('update_blacklist', { email_to_block: email });
      await whatsapp(`Mailead bounce: ${email} (${company}) removed from "${campaign}" + blocklisted.`);
    }
    return { action: 'bounce-cleaned', email };
  }

  if (ev.event_type === 'email_answered') {
    console.log(`reply: ${email} (${campaign})`);
    if (!DRY) {
      await whatsapp(`REPLY from ${who} at ${company} ("${campaign}", step ${ev.step ?? '?'}): ${email}. If it's a real reply, audit needed same-day.`);
    }
    return { action: 'reply-notified', email };
  }

  return { action: 'logged', event_type: ev.event_type };
}

const server = http.createServer((req, res) => {
  const ok = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.method !== 'POST' || req.url !== `/mailead-hook/${HOOK_SECRET}`) return ok(404, { error: 'not found' });
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', async () => {
    let ev; try { ev = JSON.parse(body); } catch { return ok(400, { error: 'bad json' }); }
    try { ok(200, await handle(ev)); }
    catch (e) { console.error('handle failed:', e.message); ok(200, { action: 'logged-with-error' }); }
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`mailead-webhook-receiver on :${PORT} (dry=${DRY})`));
module.exports = { handle, leadEmail };
