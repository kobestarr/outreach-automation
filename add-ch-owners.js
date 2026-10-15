#!/usr/bin/env node
/**
 * Add the owner (longest-serving active director) from Companies House to every row with a company_number.
 * Usage: node add-ch-owners.js <in.csv> --out <out.csv>
 * Adds: owner_first, owner_last, owner_full, owner_role, owner_since, other_directors, owner_err
 */
const fs = require('fs');
const { lookupOwner } = require('./shared/outreach-core/enrichment/ch-owner');
const IN = process.argv[2]; const oi = process.argv.indexOf('--out'); const OUT = oi > 0 ? process.argv[oi + 1] : IN.replace(/\.csv$/, '-owners.csv');
function parseCSV(t) { const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); if (row.length > 1) rows.push(row); row = []; f = ''; } else f += c; }
  if (f || row.length) { row.push(f); rows.push(row); }
  const H = rows[0]; return rows.slice(1).map(r => Object.fromEntries(H.map((h, i) => [h, r[i] || ''])));
}
const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
(async () => {
  const rows = parseCSV(fs.readFileSync(IN, 'utf8'));
  for (const [i, r] of rows.entries()) {
    const o = r.company_number ? await lookupOwner(r.company_number) : { none: true };
    Object.assign(r, { owner_first: o.first || '', owner_last: o.last || '', owner_full: o.full || '', owner_role: o.role || '',
      owner_since: o.appointed_on || '', other_directors: o.other_directors ?? '', owner_err: o.error || (o.none ? 'no active human director' : '') });
    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${rows.length}`);
    await new Promise(res => setTimeout(res, 600)); // well under 600 requests / 5 min
  }
  const H = Object.keys(rows[0]);
  fs.writeFileSync(OUT, [H.join(','), ...rows.map(r => H.map(h => esc(r[h])).join(','))].join('\n'));
  console.log(`owners found ${rows.filter(r => r.owner_first).length}/${rows.length} -> ${OUT}`);
})();
