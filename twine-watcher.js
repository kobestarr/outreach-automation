#!/usr/bin/env node
/**
 * twine-watcher.js — free, zero-dependency Twine job watcher.
 *
 * Twine has no public API, but every role listing page server-renders its 10
 * newest briefs into `window.__data` (Redux state) as clean JSON: budget,
 * currency, location, remote flag, role, posted timestamp, hire-intent answers,
 * and the job URL. We poll the role pages we care about, dedup against a small
 * state file, score each new brief, and WhatsApp the good ones to Kobi via the
 * clawdbot bridge. No Zapier, no paid tooling, no login.
 *
 * Usage:
 *   node twine-watcher.js              # poll once, notify new+relevant briefs
 *   node twine-watcher.js --seed       # mark everything currently live as seen, no notify (first run)
 *   node twine-watcher.js --dry-run    # poll + score + print, never notify, never write state
 *   node twine-watcher.js --all        # notify every new brief regardless of score (debug)
 *
 * Designed to run on clawdbot under cron (Node 22, no npm install needed).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ---- config -------------------------------------------------------------
const ROLES = [
  'web-developers', 'wordpress-developers', 'full-stack-developers',
  'web-designers', 'seo-experts', 'digital-marketers', 'ppc-managers',
  'social-media-managers', 'content-creators', 'podcast-producers',
  'podcast-editors',
];

// GBP-equivalent floor. Briefs below this (when a budget is stated) are skipped.
const MIN_BUDGET_GBP = 400;
const FX = { gbp: 1, usd: 0.79, eur: 0.86, aud: 0.52, cad: 0.58 };

// UK locations score up (substring match, case-insensitive). Remote is neutral
// (it's the default, not a quality signal) and handled separately.
const UK_LOCATION = /united kingdom|\buk\b|england|london|manchester|scotland|wales|birmingham|leeds|bristol/i;

const STATE_FILE = path.join(__dirname, 'data', 'twine-watcher-state.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const WHATSAPP_NUMBER = '447989746146';

// ---- args ---------------------------------------------------------------
const args = new Set(process.argv.slice(2));
const SEED = args.has('--seed');
const DRY = args.has('--dry-run');
const NOTIFY_ALL = args.has('--all');

// ---- helpers ------------------------------------------------------------
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(get(res.headers.location));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

// Minimal raw-JSON decoder: find `window.__data=` then balance-scan the object.
function extractData(html) {
  const marker = 'window.__data=';
  const i = html.indexOf(marker);
  if (i < 0) return null;
  let s = i + marker.length;
  // balance braces, respecting strings/escapes
  let depth = 0, inStr = false, esc = false, start = -1;
  for (let j = s; j < html.length; j++) {
    const ch = html[j];
    if (start === -1) { if (ch === '{') { start = j; depth = 1; } continue; }
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) {
      try { return JSON.parse(html.slice(start, j + 1)); } catch (e) { return null; }
    } }
  }
  return null;
}

function briefsFrom(data) {
  const b = data && data.entities && data.entities.briefs;
  return b ? Object.values(b) : [];
}

function budgetGBP(brief) {
  const amt = brief.amount ?? brief.budget;
  if (amt == null || amt < 0) return null; // -1 = not stated / negotiable
  const rate = FX[(brief.currency || 'gbp').toLowerCase()] ?? 0.79;
  return Math.round((amt / 100) * rate); // amount is in minor units (pennies/cents)
}

function score(brief) {
  let s = 0;
  const reasons = [];
  const gbp = budgetGBP(brief);
  if (gbp != null) {
    if (gbp >= 1500) { s += 3; reasons.push(`£${gbp} budget`); }
    else if (gbp >= MIN_BUDGET_GBP) { s += 2; reasons.push(`£${gbp} budget`); }
    else { s -= 2; reasons.push(`low £${gbp}`); }
  } else {
    reasons.push('budget negotiable');
  }
  const loc = brief.location || (brief.remote ? 'Remote' : '');
  if (UK_LOCATION.test(loc)) { s += 2; reasons.push(loc); }
  else if (loc) { reasons.push(loc); } // remote / overseas: neutral, just shown
  if (brief.priority === 'high') { s += 1; reasons.push('urgent'); }
  // hire-intent: "ready to make a paid hire" is the strongest signal
  const qa = JSON.stringify(brief.questions || []).toLowerCase();
  if (qa.includes('ready to make a paid hire')) { s += 2; reasons.push('ready to hire'); }
  if (qa.includes('larger project') || qa.includes('follow up work')) { s += 1; reasons.push('repeat potential'); }
  return { score: s, reasons };
}

function whatsapp(message) {
  // Uses the clawdbot bridge running locally on clawdbot (this script runs there).
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    const payload = JSON.stringify({ to: WHATSAPP_NUMBER, message, source: 'twine-watcher' });
    const cmd = `TOKEN=$(cat /root/.trendmine-internal-token); curl -s -X POST ` +
      `-H "X-Internal-Token: $TOKEN" -H "Content-Type: application/json" ` +
      `-d '${payload.replace(/'/g, "'\\''")}' http://localhost:3848/send-direct`;
    execFile('bash', ['-c', cmd], { timeout: 15000 }, (err, stdout) => {
      if (err) console.error('whatsapp send failed:', err.message);
      resolve();
    });
  });
}

function loadState() {
  try { return new Set(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).seen || []); }
  catch { return new Set(); }
}
function saveState(seen) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  // cap stored ids so the file can't grow forever
  const arr = [...seen].slice(-4000);
  fs.writeFileSync(STATE_FILE, JSON.stringify({ updated: new Date().toISOString(), seen: arr }, null, 0));
}

// ---- main ---------------------------------------------------------------
(async () => {
  const seen = loadState();
  const fresh = [];
  for (const role of ROLES) {
    try {
      const html = await get(`https://www.twine.net/jobs/${role}`);
      const data = extractData(html);
      const briefs = briefsFrom(data);
      for (const b of briefs) {
        const id = String(b.id ?? (b.links && b.links.main_relative));
        if (!id || seen.has(id)) continue;
        seen.add(id);
        fresh.push(b);
      }
      await new Promise((r) => setTimeout(r, 800)); // be polite
    } catch (e) {
      console.error(`role ${role}: ${e.message}`);
    }
  }

  if (SEED) {
    if (!DRY) saveState(seen);
    console.log(`Seeded ${seen.size} live briefs as seen. No notifications sent.`);
    return;
  }

  const scored = fresh
    .map((b) => ({ b, ...score(b) }))
    .sort((x, y) => y.score - x.score);

  const toNotify = NOTIFY_ALL ? scored : scored.filter((x) => x.score >= 2);

  console.log(`${fresh.length} new briefs, ${toNotify.length} worth notifying.`);

  for (const { b, score: sc, reasons } of toNotify) {
    const gbp = budgetGBP(b);
    const url = (b.links && b.links.main) || '';
    const title = (b.text || '').slice(0, 120);
    const msg = `🎯 Twine: ${b.role}\n${title}\n` +
      `${gbp != null ? '£' + gbp : 'Negotiable'} · ${b.location || (b.remote ? 'Remote' : '')}\n` +
      `${reasons.join(' · ')}\n${url}`;
    console.log('---\n' + msg);
    if (!DRY) await whatsapp(msg);
  }

  if (!DRY) saveState(seen);
})();
