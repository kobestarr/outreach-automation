#!/usr/bin/env node
// Assembles final CSVs from: markets.json, market-cache/search-*.json (AI web search (Claude), NOT ChatGPT),
// icebreaker-cache/ib-out-*.json (drafted phrases), snippets.json, funding-dates.json. No API calls.
const fs = require('fs'); const { parseCSV, toCSV } = require('./shared/outreach-core/csv/csv-util');
const I = require('./shared/outreach-core/enrichment/icebreaker-lib'); const M = require('./shared/outreach-core/enrichment/market-lib');
const C = 'exports/icebreaker-cache/', MC = 'exports/market-cache/';
const rd = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const r = parseCSV(fs.readFileSync('exports/funded-send-2026-10-19.csv', 'utf8')); const H = r[0];
const rows = r.slice(1).map(x => Object.fromEntries(H.map((h, i) => [h, x[i] || ''])));
const markets = rd(C + 'markets.json'), sn = rd(C + 'snippets.json'), fd = rd(C + 'funding-dates.json');
const search = {}; for (const f of fs.readdirSync(MC).filter(f => /^search-\d+\.json$/.test(f))) Object.assign(search, rd(MC + f));
const drafts = {}; for (const f of fs.readdirSync(C).filter(f => /^ib-out-\d+\.json$/.test(f))) Object.assign(drafts, rd(C + f));
const snipText = s => String(s || '').split('\n').map(l => l.replace(/^[TMHB]: /, '')).join(' ');
const out = [], held = []; let appearN = 0;
const cols = [...H, 'icebreaker', 'market', 'ai_appears', 'ai_position', 'named_instead', 'ai_source'];
rows.forEach((row, i) => {
  const market = markets[row.email]; const s = search[market];
  let appears = '', pos = '', instead = '';
  if (s) { const answers = [{ text: s.named.map((n, k) => `${k + 1}. **${n}**`).join('\n'), urls: [] }];
    const m = M.matchCompany({ company: row.company_name, website: row.website }, answers); appears = m.appears ? 'yes' : 'no'; pos = m.position; instead = m.named_instead.join('; '); if (m.appears) appearN++; }
  const d = drafts[i]; let reason = '', line = '';
  if (!d) reason = 'no_icebreaker:no_usable_site_detail';
  else { const f = I.fundingMode(row.round, fd[row.email].fd); const phrase = String(d.phrase || '').trim(), clause = String(d.clause || '').trim();
    const text = snipText(sn[row.email]);
    if (f.mode !== 'recent' && !clause.toLowerCase().includes(phrase.toLowerCase())) reason = 'no_icebreaker:observation_not_in_line';
    else { line = I.assemble(f, { phrase, clause }); const v = I.validateIcebreaker(line, { phrase, clause, siteText: text, mode: f.mode, round: row.round }); if (!v.ok) { reason = 'no_icebreaker:' + v.reason; line = ''; } } }
  const rec = { ...row, icebreaker: line, market: market || '', ai_appears: appears, ai_position: pos, named_instead: instead, ai_source: 'AI web search (Claude)' };
  if (line) out.push(rec); else held.push({ ...rec, held_reason: reason });
});
fs.writeFileSync('exports/funded-send-final-2026-10-19.csv', toCSV([cols, ...out.map(o => cols.map(c => o[c]))]));
fs.writeFileSync('exports/funded-held-2026-10-19.csv', toCSV([[...cols, 'held_reason'], ...held.map(o => [...cols, 'held_reason'].map(c => o[c]))]));
const reasons = {}; held.forEach(h => reasons[h.held_reason] = (reasons[h.held_reason] || 0) + 1);
console.log({ sendable: out.length, held: held.length, reasons, markets: new Set(Object.values(markets)).size, searched: Object.keys(search).length, appearsInSearch: appearN });
if (process.argv[2] === 'samples') out.filter((_, k) => k % Math.floor(out.length / 10) === 0).slice(0, 10).forEach(o => console.log(o.company_name + ' | ' + o.icebreaker));
