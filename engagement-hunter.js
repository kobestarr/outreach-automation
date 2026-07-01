#!/usr/bin/env node
/**
 * LinkedIn Engagement Hunter — sources warm, active, ICP-fit people by mining the
 * COMMENTERS on ICP-relevant posts. Commenters are real, active profiles by
 * definition (unlike the funded list whose guessed handles 94% don't resolve).
 *
 * READ-ONLY. This tool only reads linkdapi.com and writes a CSV. It fires NO
 * reactions / LinkedIn actions — that's a separate step (linkedin-react-runner.js
 * consumes the `post_url` column this writes).
 *
 * Mechanism (validated 2026-06, see scratchpad scan-funded-active.py):
 *   linkdapi.com read API. Auth header `X-linkdapi-apikey` = cred linkdapi.apiKey.
 *   CLOUDFLARE GOTCHA: plain urllib/https gets a 403 (error 1010). Every call goes
 *   via `curl` with a browser User-Agent. We use child_process->curl for all reads.
 *   Endpoints (JSON: { success, data }):
 *     /profile/username-to-urn?username=<h>        -> data.urn
 *     /posts/all?urn=<urn>&start=0&count=N         -> data.posts[] {url, postedAt.fullDate}
 *     /posts/comments?urn=<activity_urn>           -> data.comments[] {author:{name,headline,url,urn,type}}
 *
 * Pipeline:
 *   1. Seed = profile handle  -> resolve urn, pull recent posts (count up to ~5) as seed posts.
 *      Seed = post activity urn -> use directly.
 *   2. For each seed post: pull commenters via /posts/comments. Dedup across seeds.
 *   3. For each commenter: extract /in/<handle>, get latest post (count=1), keep only if
 *      last post is within --recent-days (default 90).
 *   4. Score headline against ICP title keywords (kobestarr / dealflow / stripped).
 *
 * Output: exports/engagement-hunter-<YYYY-MM-DD>.csv
 *   columns: post_url,name,handle,headline,icp_business,icp_score,last_post,source_seed
 *   sorted by icp_score desc, then recency.
 *
 * Usage:
 *   node engagement-hunter.js --seed-handle=<h> [--seed-post=<urn>] \
 *     [--recent-days=90] [--limit=N] [--dry-run]
 *   --seed-handle / --seed-post are repeatable.
 *   --dry-run does the curl reads but writes a *.dryrun.csv + prints a sample/plan.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// --- credentials ---
const keys = require(path.join(os.homedir(), '.credentials/api-keys.json'));
const LINKDAPI = keys.linkdapi || {};
const API_KEY = LINKDAPI.apiKey;
const AUTH_HEADER = LINKDAPI.authHeader || 'X-linkdapi-apikey';
const BASE = (LINKDAPI.baseUrl || 'https://linkdapi.com/api/v1').replace(/\/$/, '');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';

if (!API_KEY) { console.error('Missing credential linkdapi.apiKey in ~/.credentials/api-keys.json'); process.exit(1); }

// --- ICP definitions (title keywords) — mirrored from
// kobestarr-tools/linkedin-content-intel/src/icp-filter.js (the three Kobestarr-owned books). ---
const ICP_DEFINITIONS = {
  kobestarr: {
    name: 'Kobestarr Digital',
    titleKeywords: [
      'founder', 'owner', 'managing director', 'marketing manager',
      'head of marketing', 'marketing director', 'chief revenue officer',
      'business development manager', 'ceo',
    ],
  },
  dealflow: {
    name: 'DealFlow Media',
    titleKeywords: [
      'founder', 'ceo', 'consultant', 'author', 'coach', 'thought leader',
      'speaker', 'managing director', 'chief revenue officer',
      'vp marketing', 'vp sales', 'vp growth',
      'head of marketing', 'head of growth', 'head of content',
      'sales director', 'commercial director', 'growth director',
    ],
  },
  stripped: {
    name: 'Stripped Media',
    titleKeywords: [
      'film producer', 'film director', 'tv presenter', 'actor', 'actress',
      'cinema owner', 'creative director', 'executive producer', 'showrunner',
      'series producer', 'documentary producer', 'broadcast journalist',
      'film commissioner', 'commissioning editor', 'head of production',
      'production manager', 'post-production supervisor',
    ],
  },
};

// --- arg parsing (supports repeatable flags) ---
const argv = process.argv.slice(2);
const multi = { 'seed-handle': [], 'seed-post': [], 'seed-urn': [] };
const single = {};
for (const a of argv) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (!m) continue;
  const [, k, v] = m;
  if (k in multi) multi[k].push(v);
  else single[k] = v === undefined ? true : v;
}
const SEED_HANDLES = multi['seed-handle'].filter(Boolean);
const SEED_POSTS = multi['seed-post'].filter(Boolean);
const SEED_URNS = multi['seed-urn'].filter(Boolean);   // profile URN (skip handle->urn resolve)
const RECENT_DAYS = single['recent-days'] ? parseInt(single['recent-days'], 10) : 90;
const LIMIT = single.limit ? parseInt(single.limit, 10) : Infinity;
const DRY = !!single['dry-run'];

if (!SEED_HANDLES.length && !SEED_POSTS.length && !SEED_URNS.length) {
  console.error('Usage: node engagement-hunter.js --seed-handle=<h> [--seed-urn=<profile-urn>] [--seed-post=<activity-urn>] [--recent-days=90] [--limit=N] [--dry-run]');
  console.error('       --seed-handle / --seed-urn / --seed-post are repeatable.');
  console.error('       --seed-handle resolves a public handle to a urn; --seed-urn uses a profile urn directly.');
  process.exit(1);
}

// recent cutoff date string (YYYY-MM-DD)
const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - RECENT_DAYS);
const CUTOFF = cutoff.toISOString().slice(0, 10);

const ROOT = __dirname;
const today = new Date().toISOString().slice(0, 10);
const OUT = path.join(ROOT, 'exports', `engagement-hunter-${today}${DRY ? '.dryrun' : ''}.csv`);

// throttle + retry: linkdapi rate-limits if reads fire in a tight loop, returning
// transient empties. A small inter-call delay + one retry keeps runs from silently
// zeroing out. Tune via --throttle-ms (default 600).
const THROTTLE_MS = single['throttle-ms'] ? parseInt(single['throttle-ms'], 10) : 600;
function sleepSync(ms) {
  // synchronous sleep so the sequential read loop self-paces without async churn.
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

// --- linkdapi GET via curl (Cloudflare needs a browser UA) ---
function getOnce(url) {
  let out;
  try {
    out = execFileSync('curl', [
      '-s', '--max-time', '30',
      '-H', `${AUTH_HEADER}: ${API_KEY}`,
      '-H', `User-Agent: ${UA}`,
      url,
    ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    return null;
  }
  try { return JSON.parse(out); } catch { return null; }
}

function get(pathPart, params) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const url = `${BASE}${pathPart}?${qs}`;
  let res = getOnce(url);
  // retry once on a failed parse / unsuccessful response (transient rate-limit).
  if (!res || res.success === false) {
    sleepSync(1500);
    res = getOnce(url);
  }
  if (THROTTLE_MS > 0) sleepSync(THROTTLE_MS);
  return res || {};
}

function handleFromUrl(u) {
  if (!u) return null;
  const m = String(u).match(/\/in\/([^/?#]+)/);
  return m ? m[1] : null;
}

// /posts/comments keys on the bare activity urn (urn:li:activity:NNN), not the full
// feed url. Pull it out of whatever we were handed (post url, feed url, or raw urn).
function activityUrn(s) {
  if (!s) return s;
  const m = String(s).match(/urn:li:activity:\d+/);
  return m ? m[0] : s;
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// --- ICP scoring: title keyword match against headline.
// strong (full phrase) = 1.0 per hit cap; partial (long word from multi-word kw) = 0.5.
// Returns { business, score } for the best-scoring book, or { business:'', score:0 }. ---
function scoreHeadline(headline) {
  if (!headline) return { business: '', score: 0 };
  const lower = headline.toLowerCase();
  let best = { business: '', score: 0 };
  for (const [key, icp] of Object.entries(ICP_DEFINITIONS)) {
    let score = 0;
    for (const kw of icp.titleKeywords) {
      if (lower.includes(kw)) { score = Math.max(score, 1.0); continue; }
      const words = kw.split(/\s+/);
      if (words.length > 1) {
        for (const w of words) {
          if (w.length > 3 && lower.includes(w)) score = Math.max(score, 0.5);
        }
      }
    }
    if (score > best.score) best = { business: key, score };
  }
  return best;
}

(async () => {
  console.log(`Engagement Hunter ${DRY ? '(DRY-RUN)' : ''}`);
  console.log(`Seeds: ${SEED_HANDLES.length} handle(s), ${SEED_URNS.length} profile-urn(s), ${SEED_POSTS.length} post urn(s)`);
  console.log(`Recent cutoff: ${CUTOFF} (last ${RECENT_DAYS} days) | limit: ${LIMIT === Infinity ? 'none' : LIMIT}`);
  console.log('');

  // 1. Build the seed-post list: each entry { activityUrl, sourceSeed }
  const seedPosts = [];

  for (const handle of SEED_HANDLES) {
    const u = get('/profile/username-to-urn', { username: handle });
    const urn = u && u.data && u.data.urn;
    if (!urn) { console.log(`  ! seed handle ${handle}: could not resolve urn`); continue; }
    const pr = get('/posts/all', { urn, start: 0, count: 5 });
    const posts = (pr && pr.data && pr.data.posts) || [];
    if (!posts.length) { console.log(`  ! seed handle ${handle}: no posts`); continue; }
    let added = 0;
    for (const p of posts.slice(0, 5)) {
      if (p.url) { seedPosts.push({ activityUrl: p.url, sourceSeed: `handle:${handle}` }); added++; }
    }
    console.log(`  seed handle ${handle}: ${added} post(s) added`);
  }

  for (const urn of SEED_URNS) {
    const pr = get('/posts/all', { urn, start: 0, count: 5 });
    const posts = (pr && pr.data && pr.data.posts) || [];
    if (!posts.length) { console.log(`  ! seed urn ${urn}: no posts`); continue; }
    let added = 0;
    for (const p of posts.slice(0, 5)) {
      if (p.url) { seedPosts.push({ activityUrl: p.url, sourceSeed: `urn:${urn}` }); added++; }
    }
    console.log(`  seed urn ${urn}: ${added} post(s) added`);
  }

  for (const postUrn of SEED_POSTS) {
    // a post seed may be passed as an activity urn or a full post url — pass through.
    seedPosts.push({ activityUrl: postUrn, sourceSeed: `post:${postUrn}` });
    console.log(`  seed post ${postUrn}: added directly`);
  }

  if (!seedPosts.length) { console.error('\nNo seed posts resolved. Nothing to mine.'); process.exit(1); }

  // 2. Mine commenters from each seed post, dedup by handle.
  // For /posts/comments the API keys on the post's activity urn. The post url
  // returned by /posts/all is the reactable url; linkdapi accepts that url's
  // activity component. We pass the url through as `urn` (matches the documented
  // shape where the comments endpoint takes the activity identifier).
  const byHandle = new Map(); // handle -> { name, headline, handle, sourceSeed }
  let totalComments = 0;

  for (const sp of seedPosts) {
    const cr = get('/posts/comments', { urn: activityUrn(sp.activityUrl) });
    const comments = (cr && cr.data && cr.data.comments) || [];
    totalComments += comments.length;
    let kept = 0;
    for (const c of comments) {
      const author = c.author || {};
      if (author.type && author.type !== 'PERSON') continue;
      const handle = handleFromUrl(author.url);
      if (!handle) continue;
      if (byHandle.has(handle)) continue;
      byHandle.set(handle, {
        name: author.name || '',
        headline: author.headline || '',
        handle,
        sourceSeed: sp.sourceSeed,
      });
      kept++;
    }
    console.log(`  post ${sp.activityUrl.slice(-40)} -> ${comments.length} comment(s), ${kept} new person handle(s)`);
  }

  const commenters = [...byHandle.values()];
  console.log(`\n${commenters.length} distinct person commenter(s) across ${seedPosts.length} seed post(s) (${totalComments} raw comments).`);

  // 3. For each commenter: latest post + recency filter. Honour --limit on the
  //    number of commenters we spend reads on.
  const rows = [];
  let checked = 0, active = 0, dormant = 0, unresolved = 0;
  const slice = commenters.slice(0, LIMIT === Infinity ? commenters.length : LIMIT);
  console.log(`\nChecking recency for ${slice.length} commenter(s) (cap ${LIMIT === Infinity ? 'none' : LIMIT})...`);

  for (const c of slice) {
    checked++;
    if (checked % 20 === 0) console.log(`  ${checked}/${slice.length} (active ${active})`);
    const u = get('/profile/username-to-urn', { username: c.handle });
    const urn = u && u.data && u.data.urn;
    if (!urn) { unresolved++; continue; }
    const pr = get('/posts/all', { urn, start: 0, count: 1 });
    const posts = (pr && pr.data && pr.data.posts) || [];
    if (!posts.length) { dormant++; continue; }
    const when = ((posts[0].postedAt || {}).fullDate || '').slice(0, 10);
    if (!when || when < CUTOFF) { dormant++; continue; }
    active++;
    const { business, score } = scoreHeadline(c.headline);
    rows.push({
      post_url: posts[0].url || '',
      name: c.name,
      handle: c.handle,
      headline: c.headline,
      icp_business: business,
      icp_score: score,
      last_post: when,
      source_seed: c.sourceSeed,
    });
  }

  // 4. Sort: icp_score desc, then recency desc.
  rows.sort((a, b) => (b.icp_score - a.icp_score) || (a.last_post < b.last_post ? 1 : a.last_post > b.last_post ? -1 : 0));

  // --- write CSV ---
  const headerCols = ['post_url', 'name', 'handle', 'headline', 'icp_business', 'icp_score', 'last_post', 'source_seed'];
  const csv = [headerCols.join(',')]
    .concat(rows.map(r => headerCols.map(k => csvCell(r[k])).join(',')))
    .join('\n') + '\n';

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, csv);

  console.log(`\n=== DONE ===`);
  console.log(`checked ${checked} | active ${active} | dormant ${dormant} | unresolved ${unresolved}`);
  console.log(`${rows.length} warm ICP-fit target(s) -> ${OUT}`);
  if (DRY) console.log('(dry-run: wrote to *.dryrun.csv)');

  const sample = rows.slice(0, 5);
  if (sample.length) {
    console.log('\nSample (top by score then recency):');
    for (const r of sample) {
      console.log(`  [${r.icp_score} ${r.icp_business || '-'}] ${r.name} (${r.handle}) last ${r.last_post}`);
      console.log(`     ${(r.headline || '').slice(0, 80)}`);
      console.log(`     ${r.post_url}`);
    }
  }
})();
