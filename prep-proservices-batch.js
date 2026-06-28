#!/usr/bin/env node
/**
 * Prep the next accountants/solicitors batch for the KSD AI-Search Pro-Services campaign.
 * DB pull -> exclude already-sent (pilot 81) -> naturalise company names -> Mailead CSV.
 *
 * Usage:
 *   node prep-proservices-batch.js --dry-run      # counts + sample, no LLM, no write
 *   node prep-proservices-batch.js                # full run, writes the CSV
 *   node prep-proservices-batch.js --limit=50     # cap for testing
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DB = path.join(__dirname, 'ksd/local-outreach/orchestrator/data/businesses.db');
const EXCLUDE_CSV = path.join(__dirname, 'exports/pilot-mailead-2026-06-22.csv'); // the 81 already sent
const OUT = path.join(__dirname, 'exports/ksd-proservices-batch2-2026-06-24.csv');
const REVIEW = path.join(__dirname, 'exports/ksd-proservices-batch2-naturalise-review.tsv');
const keys = require(path.join(os.homedir(), '.credentials/api-keys.json'));
const API_KEY = keys.anthropic.apiKey;
const MODEL = 'claude-haiku-4-5-20251001';

const args = Object.fromEntries(process.argv.slice(2).flatMap(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [[m[1], m[2] ?? true]] : []; }));
const DRY = !!args['dry-run'];
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;

function csvField(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"' && text[i+1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else { if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c === '\r') {} else f += c; } }
  if (f.length || row.length) { row.push(f); rows.push(row); } return rows;
}

function normaliseCategory(cat) {
  const c = (cat || '').toLowerCase();
  if (c.includes('account')) return 'accountant';
  if (c.includes('solicit') || c.includes('law') || c.includes('legal')) return 'solicitor';
  return cat;
}

async function classifyBatch(items) {
  const prompt = `For each UK business below decide if it is a GENUINE accountancy or legal practice (a firm a local buyer would search for as "a good accountant/solicitor in <town>"), and give the naturalised short name. Use name + website + category.
Some rows are mis-categorised: the contact merely holds an "accountant"/"solicitor" job TITLE at a company that is NOT a practice (e.g. a fashion brand, energy drink, airline, manufacturer, recruiter, software product). Those must be dropped.
Return ONLY a JSON array of {"full":"<name verbatim>","short":"<naturalised>","keep":true|false} in the same order.
- keep=false ONLY when clearly NOT an accountancy/legal practice. Genuine firms (including brandable-named local ones like "Brecher" or "Myerson") -> keep=true. When genuinely unsure but it could be a practice, keep=true.
- short: naturalise for casual email — strip Ltd/Limited/LLP/PLC and trailing descriptors (Chartered Accountants, Accountants, Accountancy, Solicitors, Law, Legal, & Co, Associates) ONLY when a recognisable name remains; keep ampersand surname pairs; never reduce to a bare ambiguous single word or under 2 chars; never add words; keep original spelling/caps.
Items:
${JSON.stringify(items)}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const j = await res.json();
  let txt = j.content[0].text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();
  return JSON.parse(txt);
}

(async () => {
  // 1. pull candidates from DB
  const sql = `SELECT owner_first_name, owner_email, name, category, location, linkedin_url, website
    FROM businesses
    WHERE (lower(category) LIKE '%account%' OR lower(category) LIKE '%solicit%' OR lower(category) LIKE '%law%' OR lower(category) LIKE '%legal%')
      AND COALESCE(owner_first_name,'')<>'' AND COALESCE(owner_email,'')<>'' AND COALESCE(location,'')<>''
      AND (consulti_deliverable=1 OR reoon_deliverable=1 OR reoon_safe_to_send=1 OR email_verified=1)
      AND COALESCE(exported_to,'')=''`;
  const raw = execFileSync('sqlite3', ['-json', DB, sql], { maxBuffer: 64 * 1024 * 1024 }).toString().trim();
  let rows = raw ? JSON.parse(raw) : [];

  // 2. exclude the already-sent 81 (by email) + dedupe by email
  const ex = parseCSV(fs.readFileSync(EXCLUDE_CSV, 'utf8'));
  const exHdr = ex[0]; const exEmailIdx = exHdr.indexOf('email');
  const excluded = new Set(ex.slice(1).map(r => (r[exEmailIdx] || '').toLowerCase().trim()).filter(Boolean));
  const seen = new Set();
  rows = rows.filter(r => {
    const e = (r.owner_email || '').toLowerCase().trim();
    if (!e || excluded.has(e) || seen.has(e)) return false;
    seen.add(e); return true;
  });

  // drop obvious junk categories (marketing "Account Director" roles)
  rows = rows.filter(r => !/director|manager|programmatic|influencer/i.test(r.category || '') || /accountant|solicitor|accounting|law|legal/i.test(r.category || ''));

  if (LIMIT < rows.length) rows = rows.slice(0, LIMIT);

  console.log(`DB candidates after exclude+dedupe: ${rows.length}`);
  const byCat = {}; rows.forEach(r => { const c = normaliseCategory(r.category); byCat[c] = (byCat[c]||0)+1; });
  console.log('by category:', JSON.stringify(byCat));
  console.log('sample:', rows.slice(0, 4).map(r => `${r.owner_first_name} | ${r.name} | ${normaliseCategory(r.category)} | ${r.location}`));

  if (DRY) { console.log('\n[dry-run] no LLM, no write.'); return; }

  // 3. classify (keep genuine practices, drop role-misfits) + naturalise, in batches
  const byName = new Map();
  for (const r of rows) if (!byName.has(r.name)) byName.set(r.name, { website: r.website || '', category: r.category || '' });
  const uniqNames = [...byName.keys()];
  const map = new Map(); // name -> {short, keep}
  const BATCH = 80;
  for (let i = 0; i < uniqNames.length; i += BATCH) {
    const chunk = uniqNames.slice(i, i + BATCH);
    const items = chunk.map(n => ({ name: n, website: byName.get(n).website, category: byName.get(n).category }));
    let out;
    try { out = await classifyBatch(items); }
    catch (e) { console.error(`batch @${i} failed (${e.message}); keeping all in batch as fallback`); out = items.map(it => ({ full: it.name, short: it.name, keep: true })); }
    out.forEach(o => map.set(o.full, { short: o.short || o.full, keep: o.keep !== false }));
    console.log(`classified ${Math.min(i + BATCH, uniqNames.length)}/${uniqNames.length}`);
  }

  // 4. filter to kept practices, write Mailead CSV + dropped list
  const header = ['first_name','email','company','category','town','linkedin_url','website','company_full'];
  const lines = [header.join(',')];
  const dropped = [];
  let kept = 0;
  for (const r of rows) {
    const full = r.name || '';
    const m = map.get(full) || { short: full, keep: true };
    if (!m.keep) { dropped.push(`${full}\t${r.category}\t${r.location}`); continue; }
    let short = m.short || full;
    if (!short || short.length < 2) short = full;
    lines.push([
      r.owner_first_name, r.owner_email, short, normaliseCategory(r.category),
      r.location, r.linkedin_url || '', r.website || '', full,
    ].map(csvField).join(','));
    kept++;
  }
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  fs.writeFileSync(REVIEW, ['DROPPED (not a genuine practice)\tCATEGORY\tTOWN', ...dropped].join('\n'));
  console.log(`\nKept ${kept} genuine practices -> ${OUT}`);
  console.log(`Dropped ${dropped.length} non-practices -> ${REVIEW}`);
})();
