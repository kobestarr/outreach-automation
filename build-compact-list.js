// Joins send CSV to LeadByte batches by email; writes compact list + funding-date map (free, no API).
const fs = require('fs'); const { parseCSV } = require('./shared/outreach-core/csv/csv-util');
const rd = f => { const r = parseCSV(fs.readFileSync(f, 'utf8')); const H = r[0]; return r.slice(1).map(x => Object.fromEntries(H.map((h, i) => [h, x[i] || '']))); };
const send = rd('exports/funded-send-2026-10-19.csv'); const lb = {};
for (const f of fs.readdirSync('exports').filter(f => /^funded-batch-.*\.csv$/.test(f)).sort()) for (const r of rd('exports/' + f)) { const e = (r['Decision Maker Email'] || '').toLowerCase(); if (e) lb[e] = r; }
const meta = {}, lines = [];
send.forEach((r, i) => { const l = lb[r.email.toLowerCase()] || {}; let fd = (l['Last Funding Date'] || '').slice(0, 10);
  if (!fd && /^reserve-2026-(\d{4}-\d\d)/.test(r.source)) fd = r.source.match(/(\d{4}-\d\d)$/)[1] + '-15';
  if (!fd && r.source === 'leadbyte-2026-09') fd = '2026-09-15';
  meta[r.email] = { fd, joined: !!l.Description || !!l['Industries'] };
  lines.push(`${i}|${r.company_name}|${(l.Industries || '').split(',').slice(0, 3).join(',')}|${(l.Description || l['Full Description'] || '').replace(/\s+/g, ' ').slice(0, 130)}`); });
fs.writeFileSync('exports/icebreaker-cache/funding-dates.json', JSON.stringify(meta));
fs.writeFileSync('exports/icebreaker-cache/compact.txt', lines.join('\n'));
console.log(lines.length, Object.values(meta).filter(m => m.joined).length, 'joined');
