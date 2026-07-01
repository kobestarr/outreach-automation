#!/usr/bin/env node
/**
 * ICP reaction runner — linkedapi.io reactions ONLY (per the tool-boundary rule:
 * Prosp owns connects/sequences, this owns reactions). Warms ICPs by liking their
 * recent post before/while the email + Prosp connect land.
 *
 * Pipeline per ICP:
 *   1. Resolve the profile's most recent post URL
 *      - if the input CSV has a `post_url` column, use it directly (no read needed)
 *      - else resolve via linkdapi.com (read-only)  [endpoint marked CONFIRM below]
 *   2. Skip if already reacted (state file dedup)
 *   3. st.reactToPost via linkedapi.io, poll the workflow to completion
 *   4. Human-paced throttle; stop at the daily cap
 *
 * SAFETY: defaults to DRY-RUN. A live run requires BOTH --go AND an
 * identification-token (from app.linkedapi.io once your account is connected).
 *
 * GROUNDED 2026-06-28 from linkedapi.io docs:
 *   POST https://api.linkedapi.io/workflows
 *     headers: linked-api-token, identification-token
 *     body: { actionType: "st.reactToPost", postUrl, reactionType }
 *   GET  https://api.linkedapi.io/workflows/{id}  -> poll workflowStatus
 *   reactionType in: LIKE | CELEBRATE | SUPPORT | LOVE | INSIGHTFUL | FUNNY
 *
 * Usage:
 *   node linkedin-react-runner.js <icp.csv> --dry-run            # default; shows plan
 *   node linkedin-react-runner.js <icp.csv> --go --daily-cap=25  # live (needs id-token)
 *   node linkedin-react-runner.js <icp.csv> --reaction=LIKE --throttle-ms=45000
 *   id-token via:  --id-token=...  | env LINKEDAPI_IDENTIFICATION_TOKEN | cred linkedapi_io.identificationToken
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const keys = require(path.join(os.homedir(), '.credentials/api-keys.json'));
const arg = Object.fromEntries(process.argv.slice(3).flatMap(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [[m[1], m[2] ?? true]] : [];
}));
const SRC = process.argv[2];
const GO = !!arg.go;                          // live switch; otherwise dry-run
const DRY = !GO;
const REACTION = (arg.reaction || 'LIKE').toUpperCase();
const DAILY_CAP = arg['daily-cap'] ? parseInt(arg['daily-cap'], 10) : 25;   // conservative default
const THROTTLE = arg['throttle-ms'] ? parseInt(arg['throttle-ms'], 10) : 40000; // ~40s, human pace
const MAX = arg.max ? parseInt(arg.max, 10) : Infinity;
const STATE_FILE = path.join(__dirname, 'data/linkedin-reacted-state.json');

const LINKED_API_TOKEN = keys.linkedapi_io && keys.linkedapi_io.apiKey;
const ID_TOKEN = arg['id-token'] || process.env.LINKEDAPI_IDENTIFICATION_TOKEN
  || (keys.linkedapi_io && keys.linkedapi_io.identificationToken);
const LINKDAPI = keys.linkdapi || {};

if (!SRC || !fs.existsSync(SRC)) { console.error('Usage: node linkedin-react-runner.js <icp.csv> [--go]'); process.exit(1); }
const VALID_REACTIONS = ['LIKE', 'CELEBRATE', 'SUPPORT', 'LOVE', 'INSIGHTFUL', 'FUNNY'];
if (!VALID_REACTIONS.includes(REACTION)) { console.error(`--reaction must be one of ${VALID_REACTIONS.join(', ')}`); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c; }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

// minimal HTTPS JSON helper
function req(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = https.request({ method, hostname: u.hostname, path: u.pathname + u.search, headers: { 'Accept': 'application/json', ...headers } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { const t = Buffer.concat(chunks).toString('utf8'); try { resolve({ status: res.statusCode, json: t ? JSON.parse(t) : {} }); } catch { resolve({ status: res.statusCode, json: {}, raw: t }); } });
    });
    r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}

// --- linkdapi.com (read): resolve a profile's most recent post URL ---
// CONFIRM the exact posts endpoint against https://linkdapi.com/docs (Posts section)
// before live use. Auth header + base come from the stored credential.
async function resolveRecentPostUrl(profileUrl) {
  const base = LINKDAPI.baseUrl || 'https://linkdapi.com/api/v1';
  const header = { [LINKDAPI.authHeader || 'X-linkdapi-apikey']: LINKDAPI.apiKey };
  // TODO(confirm): exact path, e.g. `${base}/posts/by-profile?url=...` -> first item's postUrl
  const { status, json } = await req('GET', `${base}/posts/by-profile?url=${encodeURIComponent(profileUrl)}&limit=1`, header);
  if (status !== 200) return null;
  const posts = json.data || json.posts || [];
  return posts[0] && (posts[0].postUrl || posts[0].url || null);
}

// --- linkedapi.io (action): react to a post, poll to completion ---
async function reactToPost(postUrl) {
  const headers = { 'linked-api-token': LINKED_API_TOKEN, 'identification-token': ID_TOKEN, 'Content-Type': 'application/json' };
  // linkedapi.io expects `type` (lowercase reaction), not `reactionType`.
  const start = await req('POST', 'https://api.linkedapi.io/workflows', headers, { actionType: 'st.reactToPost', postUrl, type: REACTION.toLowerCase() });
  const wfId = start.json && (start.json.workflowId || (start.json.result && start.json.result.workflowId));
  if (!wfId) return { ok: false, detail: start.json };
  for (let i = 0; i < 20; i++) {
    await sleep(5000);
    const p = await req('GET', `https://api.linkedapi.io/workflows/${wfId}`, headers);
    const st = p.json && p.json.result && p.json.result.workflowStatus;
    if (st === 'completed') return { ok: true };
    if (st === 'failed') return { ok: false, detail: p.json };
  }
  return { ok: false, detail: 'poll timeout' };
}

(async () => {
  const rows = parseCSV(fs.readFileSync(SRC, 'utf8'));
  const header = rows[0].map(h => h.toLowerCase());
  const liIdx = header.findIndex(h => /linkedin/.test(h));
  const postIdx = header.findIndex(h => h === 'post_url');
  const data = rows.slice(1);
  const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : { reacted: {} };

  console.log(`Source: ${SRC} | ${data.length} ICPs | reaction: ${REACTION}`);
  console.log(`Mode: ${DRY ? 'DRY-RUN (no actions)' : 'LIVE'} | daily-cap: ${DAILY_CAP} | throttle: ${THROTTLE}ms`);
  if (!LINKED_API_TOKEN) console.log('⚠️  no linked-api-token (cred linkedapi_io.apiKey) — fix before live.');
  if (!ID_TOKEN) console.log('⚠️  no identification-token yet — connect the account in app.linkedapi.io, then pass --id-token / set it in creds. DRY-RUN only until then.');
  if (GO && (!LINKED_API_TOKEN || !ID_TOKEN)) { console.error('\nRefusing live run without both tokens.'); process.exit(1); }

  let done = 0, skipped = 0;
  for (const r of data) {
    if (done >= Math.min(DAILY_CAP, MAX)) { console.log(`Hit cap (${DAILY_CAP}). Stopping.`); break; }
    const profile = liIdx >= 0 ? (r[liIdx] || '').trim() : '';
    let postUrl = postIdx >= 0 ? (r[postIdx] || '').trim() : '';
    // Dry-run stays zero-API: only resolve via linkdapi when live, or --resolve is set.
    if (!postUrl && profile && (!DRY || arg.resolve)) postUrl = (await resolveRecentPostUrl(profile)) || '';
    if (DRY) {
      if (postUrl && state.reacted[postUrl]) { skipped++; continue; }
      console.log(`  [would ${REACTION}] ${postUrl || `resolve-then-react for ${profile || '(no profile)'}`}`);
      done++; continue;
    }
    if (!postUrl) { skipped++; continue; }
    if (state.reacted[postUrl]) { skipped++; continue; }
    const res = await reactToPost(postUrl);
    if (res.ok) { state.reacted[postUrl] = new Date().toISOString(); fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); console.log(`  ✓ ${REACTION} ${postUrl}`); done++; }
    else { console.log(`  ✗ failed ${postUrl}: ${JSON.stringify(res.detail).slice(0, 120)}`); }
    await sleep(THROTTLE);
  }
  console.log(`\nDone: ${done} reaction(s) ${DRY ? '(planned)' : 'fired'}, ${skipped} skipped (no post / already reacted).`);
})();
