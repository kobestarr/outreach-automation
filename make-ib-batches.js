// Writes ib-in-N.txt batches (48 rows) for icebreaker drafting: idx|first|company|mode|roundphrase|month|snippet
const fs = require('fs'); const { parseCSV } = require('./shared/outreach-core/csv/csv-util'); const I = require('./shared/outreach-core/enrichment/icebreaker-lib');
const r = parseCSV(fs.readFileSync('exports/funded-send-2026-10-19.csv', 'utf8')); const H = r[0];
const rows = r.slice(1).map(x => Object.fromEntries(H.map((h, i) => [h, x[i] || ''])));
const sn = JSON.parse(fs.readFileSync('exports/icebreaker-cache/snippets.json', 'utf8')); const fd = JSON.parse(fs.readFileSync('exports/icebreaker-cache/funding-dates.json', 'utf8'));
const lines = [];
rows.forEach((row, i) => { const s = (sn[row.email] || '').replace(/\n/g, ' // ').slice(0, 650); const f = I.fundingMode(row.round, fd[row.email].fd);
  if (s.length < 60) return; lines.push(`${i}|${row.company_name}|${f.mode}|${s}`); });
let n = 0; for (let i = 0; i < lines.length; i += 48) fs.writeFileSync(`exports/icebreaker-cache/ib-in-${++n}.txt`, lines.slice(i, i + 48).join('\n'));
console.log(lines.length, 'rows with snippets;', n, 'batches; no snippet:', rows.length - lines.length);
