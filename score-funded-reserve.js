#!/usr/bin/env node
/**
 * Score + rank the funded-reserve pool so the best leads get worked first.
 * Rubric (0-100), weights tunable at the top. Outputs a ranked CSV with a
 * leadScore column; the daily puller takes the top N not-yet-pulled.
 *
 * Usage: node score-funded-reserve.js <reserve.csv> [--out exports/funded-reserve-ranked.csv]
 */
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = (() => { const i = process.argv.indexOf('--out'); return i >= 0 ? process.argv[i + 1] : 'exports/funded-reserve-ranked.csv'; })();
if (!SRC || !fs.existsSync(SRC)) { console.error('Usage: node score-funded-reserve.js <reserve.csv> [--out file]'); process.exit(1); }

// ---- GEO TIERS (English + wealthy non-English get top marks) ----
const norm = s => (s || '').trim().toLowerCase();
const GEO_A = new Set(['united states','usa','us','united kingdom','uk','canada','australia','new zealand','ireland']); // English + rich
const GEO_B = new Set(['norway','switzerland','united arab emirates','uae','singapore','netherlands','sweden','denmark','germany','luxembourg','qatar','finland','belgium','austria','iceland','hong kong','israel','saudi arabia','kuwait','liechtenstein','monaco']); // rich non-English
const GEO_C = new Set(['france','spain','italy','japan','south korea','korea','portugal','czech republic','estonia','poland','slovenia','taiwan','malta','cyprus']);
function geoScore(country) { const c = norm(country); if (GEO_A.has(c)) return 25; if (GEO_B.has(c)) return 22; if (GEO_C.has(c)) return 12; return c ? 4 : 0; }

// ---- FUNDING RECENCY (newer raise = better "congrats" hook) ----
const NOW = Date.parse('2026-07-01');
function recencyScore(lastFundingDate) {
  const t = Date.parse(lastFundingDate); if (isNaN(t)) return 2;
  const months = (NOW - t) / (1000 * 60 * 60 * 24 * 30.4);
  if (months <= 6) return 25; if (months <= 12) return 18; if (months <= 24) return 10; if (months <= 36) return 5; return 2;
}

// ---- FUNDING SIZE (bigger raise = more budget) ----
function sizeScore(usd) {
  const n = parseFloat(String(usd).replace(/[^0-9.]/g, '')) || 0;
  if (n >= 50e6) return 20; if (n >= 20e6) return 17; if (n >= 5e6) return 14; if (n >= 1e6) return 10; if (n >= 1e5) return 6; return 3;
}

// ---- WEBSITE NEED (the AI-search / build fit) ----
function needScore(needsWeb, traffic, bounce, visits) {
  let s = 0;
  if (norm(needsWeb) === 'yes') s += 10;
  const weak = /low|weak|poor|declin|high bounce/i;
  if (weak.test(traffic || '') || weak.test(bounce || '')) s += 5;
  const v = parseInt(String(visits).replace(/[^0-9]/g, ''), 10) || 0;
  if (v > 0 && v < 1000) s += 3;
  return Math.min(15, s);
}

// ---- ICP ROLE FIT ----
function roleScore(pos) {
  const p = norm(pos);
  if (/founder|co-?founder|ceo|owner|president|chief executive/.test(p)) return 10;
  if (/cmo|cro|cto|coo|chief|vp|vice president|head of|director/.test(p)) return 7;
  return p ? 3 : 0;
}

// ---- COMPLETENESS ----
function completeScore(email, li) { if (email && li) return 5; if (email) return 3; return 0; }

// ---- CSV ----
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c; }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.length > 1);
}
const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

const rows = parseCSV(fs.readFileSync(SRC, 'utf8'));
const H = rows[0].map(h => h.replace(/^﻿/, '').trim());
const gi = name => H.findIndex(h => h.toLowerCase() === name.toLowerCase());
const IX = { country: gi('Country'), fund: gi('Total Funding Amount (in USD)'), date: gi('Last Funding Date'),
  needs: gi('Needs Website'), traffic: gi('Website Traffic Signals'), bounce: gi('Bounce Rate Signals'),
  visits: gi('Monthly Visits'), pos: gi('Decision Maker Position'), email: gi('Decision Maker Email'),
  li: gi('Decision Maker LinkedIn URL') };

const scored = rows.slice(1).map(r => {
  const g = geoScore(r[IX.country]), rec = recencyScore(r[IX.date]), sz = sizeScore(r[IX.fund]),
    nd = needScore(r[IX.needs], r[IX.traffic], r[IX.bounce], r[IX.visits]), ro = roleScore(r[IX.pos]),
    cp = completeScore(r[IX.email], r[IX.li]);
  return { r, score: g + rec + sz + nd + ro + cp, g, rec, sz, nd, ro, cp };
}).filter(x => x.r[IX.email]);
scored.sort((a, b) => b.score - a.score);

const outH = [...H, 'leadScore', 'sc_geo', 'sc_recency', 'sc_size', 'sc_need', 'sc_role', 'sc_complete'];
const lines = [outH.map(esc).join(',')];
for (const x of scored) lines.push([...x.r, x.score, x.g, x.rec, x.sz, x.nd, x.ro, x.cp].map(esc).join(','));
fs.writeFileSync(OUT, lines.join('\n') + '\n');

// distribution + top 12
const buckets = { '80+': 0, '70-79': 0, '60-69': 0, '50-59': 0, '<50': 0 };
scored.forEach(x => { const s = x.score; buckets[s >= 80 ? '80+' : s >= 70 ? '70-79' : s >= 60 ? '60-69' : s >= 50 ? '50-59' : '<50']++; });
console.log(`Scored ${scored.length} leads -> ${OUT}\n`);
console.log('Score distribution:', JSON.stringify(buckets));
console.log('\nTop 12:');
for (const x of scored.slice(0, 12)) console.log(`  ${String(x.score).padStart(3)}  ${(x.r[gi('Organization Name')]||'').slice(0,26).padEnd(26)} ${(x.r[IX.country]||'').slice(0,16).padEnd(16)} ${(x.r[IX.pos]||'').slice(0,22)}`);
