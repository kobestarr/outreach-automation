#!/usr/bin/env node
// Naturalise UK firm names for casual cold-email copy.
// "Sheppards Chartered Accountants" -> "Sheppards", but keep "Jones & Partners",
// don't mangle "The Accountancy Partnership". One batched Haiku call.
// Outputs a review TSV + a candidate CSV (company column = short name, full kept as company_full).
// Nothing is uploaded; review the names first.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, 'exports/pilot-mailead-2026-06-16.csv');
const OUT_CSV = path.join(__dirname, 'exports/pilot-mailead-2026-06-22.csv');
const REVIEW = path.join(__dirname, 'exports/company-naturalise-review.tsv');
const keys = require(path.join(os.homedir(), '.credentials/api-keys.json'));
const API_KEY = keys.anthropic.apiKey;
const MODEL = 'claude-haiku-4-5-20251001';

// --- minimal CSV parser (handles double-quoted fields) ---
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function csvField(v) {
  v = v == null ? '' : String(v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

(async () => {
  const rows = parseCSV(fs.readFileSync(SRC, 'utf8')).filter(r => r.length > 1);
  const header = rows[0];
  const ci = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const data = rows.slice(1);
  const companies = [...new Set(data.map(r => r[ci.company]).filter(Boolean))];

  const prompt = `You are naturalising UK firm names so they read the way a person would casually refer to the firm in a friendly email. For each name, return the short, natural spoken version.

Rules:
- Remove legal suffixes: Ltd, Limited, LLP, PLC.
- Remove trailing professional descriptors when what remains is still a recognisable firm name: "Chartered Accountants", "Accountants", "Accountancy", "Chartered Certified Accountants", "Solicitors", "Solicitors LLP", "Law", "Legal", "& Co", "& Company", "Associates", "Partners" ONLY if a real name precedes it.
- KEEP ampersand surname pairs intact: "Jones & Partners" stays "Jones & Partners"; "Smith & Co" -> "Smith".
- DO NOT mangle names that are generic on purpose: "The Accountancy Partnership" stays "The Accountancy Partnership"; "Tax Assist" stays. If stripping would leave something generic, empty, or odd, keep more of the name.
- Never add words. Never invent. Keep original capitalisation/spelling.

Examples:
"Sheppards Chartered Accountants" -> "Sheppards"
"DSG Chartered Accountants Ltd" -> "DSG"
"Smith Cooper Solicitors LLP" -> "Smith Cooper"
"Jones & Partners LLP" -> "Jones & Partners"
"Hall Wood Accountants" -> "Hall Wood"
"The Accountancy Partnership" -> "The Accountancy Partnership"
"Cowgills Limited" -> "Cowgills"
"Beever and Struthers" -> "Beever and Struthers"

Return ONLY a JSON array of objects {"full": "...", "short": "..."} for these ${companies.length} names, in order:
${JSON.stringify(companies, null, 0)}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) { console.error('API error', res.status, await res.text()); process.exit(1); }
  const json = await res.json();
  let txt = json.content[0].text.trim();
  txt = txt.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/,'').trim();
  const map = new Map(JSON.parse(txt).map(o => [o.full, o.short]));

  // Review file (only the ones that actually changed shown first)
  const changed = [], same = [];
  for (const c of companies) {
    const s = map.get(c) || c;
    (s === c ? same : changed).push([c, s]);
  }
  const review = ['FULL\tSHORT\tCHANGED',
    ...changed.map(([f, s]) => `${f}\t${s}\tYES`),
    ...same.map(([f, s]) => `${f}\t${s}\t-`)].join('\n');
  fs.writeFileSync(REVIEW, review);

  // Candidate CSV: company column becomes short; append company_full
  const newHeader = [...header, 'company_full'];
  const lines = [newHeader.map(csvField).join(',')];
  for (const r of data) {
    const full = r[ci.company];
    const short = map.get(full) || full;
    const out = [...r];
    out[ci.company] = short;
    out.push(full);
    lines.push(out.map(csvField).join(','));
  }
  fs.writeFileSync(OUT_CSV, lines.join('\n') + '\n');

  console.log(`Total firms: ${companies.length}  |  shortened: ${changed.length}  |  unchanged: ${same.length}`);
  console.log(`Review: ${REVIEW}`);
  console.log(`Candidate CSV: ${OUT_CSV}`);
  console.log('\n--- CHANGED (first 30) ---');
  changed.slice(0, 30).forEach(([f, s]) => console.log(`${f}  ->  ${s}`));
})();
