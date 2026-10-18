const fs = require('fs'); const rules = require('./market-rules'); const subs = require('./market-subrules');
const { parseCSV } = require('./shared/outreach-core/csv/csv-util');
const r = parseCSV(fs.readFileSync('exports/funded-send-2026-10-19.csv', 'utf8')); const H = r[0];
const rows = r.slice(1).map(x => Object.fromEntries(H.map((h, i) => [h, x[i] || ''])));
const comp = fs.readFileSync('exports/icebreaker-cache/compact.txt', 'utf8').split('\n').map(l => l.split('|'));
const sn = JSON.parse(fs.readFileSync('exports/icebreaker-cache/snippets.json', 'utf8'));
const over = fs.existsSync('exports/icebreaker-cache/market-overrides.json') ? JSON.parse(fs.readFileSync('exports/icebreaker-cache/market-overrides.json', 'utf8')) : {};
const out = {}, other = [];
rows.forEach((row, i) => { const c = comp[i]; const text = `${c[2]} ${c[3]} ${(sn[row.email] || '').split('\n').slice(0, 2).join(' ')}`;
  let m = over[i]; if (!m) { const hit = rules.find(([, re]) => re.test(text)); m = hit ? hit[0] : null; if (m && subs[m]) { const sh = subs[m].find(([, re]) => re.test(text)); if (sh) m = sh[0]; } }
  if (m) out[row.email] = m; else other.push(`${i}|${row.company_name}|${text.slice(0, 120)}`); });
fs.writeFileSync('exports/icebreaker-cache/markets.json', JSON.stringify(out));
const counts = {}; Object.values(out).forEach(m => counts[m] = (counts[m] || 0) + 1);
console.log(Object.keys(counts).length, 'markets;', other.length, 'unclassified');
if (process.argv[2] === 'other') console.log(other.join('\n')); else console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(e => e[1] + ' ' + e[0]).join('\n'));
