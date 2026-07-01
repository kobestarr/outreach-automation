#!/usr/bin/env node
/**
 * Process the monthly "1K - Current Month" funded-startups CSV.
 *
 * 1. Loosened ICP filter: English-speaking geo + decision-maker role + has email
 *    (any funding round — seed/pre-seed welcome).
 * 2. Bucket each by pitch: kobestarr (AI/martech/SaaS) / stripped (media) / dealflow (default).
 * 3. TRUTH-CHECK the site (do not trust the "Needs Website" flag): fetch it, classify
 *    dead / parked / thin / ok.
 * 4. AI-SEARCH readiness score (AEO/GEO): JSON-LD schema, meta description, content depth,
 *    FAQ, blog/resources. Low score = invisible to ChatGPT/Perplexity/Google AI = the hook.
 *
 * Usage: node process-funded-startups.js "<csv path>" [--limit=N] [--bucket=kobestarr]
 * Output: exports/funded-startups-<month>-checked.csv  + console summary.
 */
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || '/Users/kobestarr/Downloads/1K - Current Month (7).csv';
const arg = Object.fromEntries(process.argv.slice(3).flatMap(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [[m[1], m[2] ?? true]] : []; }));
const LIMIT = arg.limit ? parseInt(arg.limit, 10) : Infinity;
const ONLY_BUCKET = arg.bucket || null;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

function parseCsv(t) {
  const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i+1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else { if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i+1] === '\n') i++; row.push(f); if (row.length > 1 || row[0] !== '') rows.push(row); row = []; f = ''; } else f += c; } }
  if (f !== '' || row.length) { row.push(f); rows.push(row); } return rows;
}

const GEO = new Set(['United Kingdom','United States','Canada','Australia','New Zealand','Ireland','Netherlands','Sweden','Denmark','Norway','Finland','Switzerland','Germany','Belgium','France','Spain','Italy']);
const DM = /\b(founder|co-founder|ceo|cmo|coo|cto|chief|president|owner|director|head of|vp |vice president|managing)\b/i;
const STRIP = /\b(media|entertainment|film|tv|television|broadcast|sports|gaming|video|music|publishing|streaming|content production|podcast)\b/i;
const KSD = /\b(artificial intelligence|generative ai|machine learning|marketing|advertising|martech|saas|software|app|platform|e-commerce|fintech|health)\b/i;
const bucketOf = ind => STRIP.test(ind) ? 'stripped' : KSD.test(ind) ? 'kobestarr' : 'dealflow';

async function checkSite(url) {
  const out = { status: 'no-url', live: false, thin: false, parked: false, aiScore: 0, signals: '', err: '' };
  if (!url || !/^https?:\/\//i.test(url)) { if (url) url = 'https://' + url; else return out; }
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctrl.signal });
    clearTimeout(t);
    const html = await r.text();
    const low = html.toLowerCase();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    out.parked = /(domain (is )?for sale|buy this domain|parked|godaddy|sedo|under construction|coming soon|website is being)/i.test(low);
    const jsonLd = /<script[^>]+application\/ld\+json/i.test(html);
    const metaDesc = /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{20,}/i.test(html);
    const hasH1 = /<h1[\s>]/i.test(html);
    const faq = /faq|frequently asked/i.test(low);
    const blog = /\b(blog|resources|insights|articles|case stud|guides)\b/i.test(low);
    const og = /<meta[^>]+property=["']og:/i.test(html);
    out.live = r.status < 400 && !out.parked;
    out.thin = out.live && text.length < 600;
    out.aiScore = [jsonLd, metaDesc, text.length > 1500, faq, blog].filter(Boolean).length;
    out.signals = [jsonLd && 'schema', metaDesc && 'metaDesc', og && 'og', hasH1 && 'h1', faq && 'faq', blog && 'blog', `txt:${text.length}`].filter(Boolean).join('+');
    out.status = !out.live ? (r.status >= 400 ? 'http' + r.status : 'parked') : (out.thin ? 'thin' : 'ok');
  } catch (e) { clearTimeout(t); out.status = 'error'; out.err = e.code || e.name || (e.message || '').slice(0, 30); }
  return out;
}

(async () => {
  const rows = parseCsv(fs.readFileSync(SRC, 'utf8'));
  const H = rows[0].map(h => h.replace(/^﻿/, '').trim()); const ix = n => H.indexOf(n);
  const col = (r, n) => r[ix(n)] || '';
  const data = rows.slice(1).filter(r => r.length >= H.length - 2);

  let cands = data.filter(r => GEO.has(col(r, 'Country')) && DM.test(col(r, 'Decision Maker Position')) && col(r, 'Decision Maker Email').includes('@'))
    .map(r => ({
      name: col(r, 'Organization Name'), website: col(r, 'Website'), country: col(r, 'Country'),
      dm: col(r, 'Decision Maker Name'), pos: col(r, 'Decision Maker Position'), email: col(r, 'Decision Maker Email'),
      li: col(r, 'Decision Maker LinkedIn URL'), industries: col(r, 'Industries'),
      round: col(r, 'Last Funding Type'), fundUsd: col(r, 'Total Funding Amount (in USD)'),
      flagNeedsWeb: col(r, 'Needs Website').trim(), bucket: bucketOf(col(r, 'Industries')),
    }));
  if (ONLY_BUCKET) cands = cands.filter(c => c.bucket === ONLY_BUCKET);
  if (cands.length > LIMIT) cands = cands.slice(0, LIMIT);

  console.log(`Checking ${cands.length} ICP candidates' websites (truth-check + AI-search score)...\n`);
  const results = [];
  const CONC = 8;
  for (let i = 0; i < cands.length; i += CONC) {
    const batch = await Promise.all(cands.slice(i, i + CONC).map(async c => ({ ...c, check: await checkSite(c.website) })));
    results.push(...batch);
    if ((i / CONC) % 5 === 0) process.stdout.write(`  ${Math.min(i + CONC, cands.length)}/${cands.length}\r`);
  }

  // Verdicts
  for (const r of results) {
    const s = r.check.status;
    // genuine need: parked, thin, 404, 5xx. uncertain (likely bot-blocked, has a site): error, 403.
    if (s === 'parked' || s === 'thin' || s === 'http404' || /^http5/.test(s)) r.realNeed = 'YES';
    else if (s === 'error' || s === 'http403' || /^http4/.test(s)) r.realNeed = 'maybe';
    else r.realNeed = 'no';
    r.aiInvisible = (r.check.live && r.check.aiScore <= 1) ? 'YES' : 'no';
    r.hot = (r.realNeed === 'YES' || r.aiInvisible === 'YES') ? 1 : 0;
  }

  // Flag accuracy
  const flagYes = results.filter(r => r.flagNeedsWeb === 'Yes');
  const flagYesConfirmed = flagYes.filter(r => r.realNeed === 'YES').length;
  const flagNoButNeeds = results.filter(r => r.flagNeedsWeb !== 'Yes' && r.realNeed === 'YES').length;

  console.log(`\n\n=== RESULTS (${results.length}) ===`);
  console.log(`Real website need (dead/parked/thin):`, results.filter(r => r.realNeed === 'YES').length);
  console.log(`AI-invisible (live site, aiScore<=1):`, results.filter(r => r.aiInvisible === 'YES').length);
  console.log(`HOT (need site OR ai-invisible):`, results.filter(r => r.hot).length);
  console.log(`\nFlag accuracy: "Needs Website=Yes" count ${flagYes.length}, of which truly need ${flagYesConfirmed} (${Math.round(flagYesConfirmed/Math.max(1,flagYes.length)*100)}%)`);
  console.log(`Flag MISSED (said No, but site is dead/thin): ${flagNoButNeeds}  <-- the list is not gospel`);
  const byBucket = {}; results.filter(r=>r.hot).forEach(r=>byBucket[r.bucket]=(byBucket[r.bucket]||0)+1);
  console.log(`\nHOT leads by bucket:`, JSON.stringify(byBucket));

  // Write CSV
  const monthTag = (typeof arg.tag === 'string' && arg.tag) || (col(data[0], 'Data Month') || 'current').replace(/[^0-9-]/g, '') || 'current';
  const outDir = path.join(__dirname, 'exports'); fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `funded-startups-${monthTag}-checked.csv`);
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const headers = ['name','website','country','dm','pos','email','li','bucket','round','fundUsd','flagNeedsWeb','siteStatus','realNeed','aiScore','aiInvisible','signals','hot'];
  const lines = [headers.join(',')];
  results.sort((a,b)=> b.hot - a.hot || a.check.aiScore - b.check.aiScore);
  for (const r of results) lines.push([r.name,r.website,r.country,r.dm,r.pos,r.email,r.li,r.bucket,r.round,r.fundUsd,r.flagNeedsWeb,r.check.status,r.realNeed,r.check.aiScore,r.aiInvisible,r.check.signals,r.hot].map(esc).join(','));
  fs.writeFileSync(outPath, lines.join('\n'));
  console.log(`\nWrote ${outPath}`);
  console.log(`\nTop 12 hot leads:`);
  for (const r of results.filter(r=>r.hot).slice(0, 12)) console.log(`  [${r.bucket}] ${r.name} | ${r.dm} (${r.pos}) | ${r.country} | ${r.round} | site:${r.check.status} aiScore:${r.check.aiScore} | ${r.email}`);
})();
