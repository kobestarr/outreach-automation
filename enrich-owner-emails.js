#!/usr/bin/env node
/**
 * For each row (needs website + owner_first from add-ch-owners.js): scrape the site, pick the best email to reach
 * the OWNER (owner-email.js), and confirm guessed owner addresses with Reoon ("safe" only).
 * Resumable: results append to <out>.jsonl; finished rows are skipped. Writes <out> CSV at the end.
 * Usage: node enrich-owner-emails.js <in.csv> --out <out.csv> [--no-guess] [--limit N]
 */
const fs = require('fs');
const { scrapeWebsite } = require('./shared/outreach-core/enrichment/website-scraper');
const { resolveOwnerEmail } = require('./shared/outreach-core/enrichment/owner-email');
const { verifyEmails } = require('./shared/outreach-core/email-verification/reoon-verifier');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d; };
const IN = process.argv[2], OUT = arg('out', IN.replace(/\.csv$/, '-emails.csv')), JL = OUT + '.jsonl';
const NO_GUESS = !!arg('no-guess', false), LIMIT = parseInt(arg('limit', '0'), 10);
function parseCSV(t) { const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); if (row.length > 1) rows.push(row); row = []; f = ''; } else f += c; }
  if (f || row.length) { row.push(f); rows.push(row); }
  const H = rows[0]; return rows.slice(1).map(r => Object.fromEntries(H.map((h, i) => [h, r[i] || ''])));
}
const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
const verify = async es => (await verifyEmails(es)).map((r, i) => ({ ...r, email: r.email || es[i] }));
(async () => {
  let rows = parseCSV(fs.readFileSync(IN, 'utf8'));
  if (LIMIT) rows = rows.slice(0, LIMIT);
  const done = new Map(fs.existsSync(JL) ? fs.readFileSync(JL, 'utf8').trim().split('\n').filter(Boolean).map(l => { const o = JSON.parse(l); return [o.company_number, o]; }) : []);
  for (const r of rows) {
    if (done.has(r.company_number)) continue;
    let res = { company_number: r.company_number, scraped: [], email: '', rule: 'no-website', guesses_tried: 0 };
    if (r.website && ['yes', 'probable', 'check'].includes(r.maps_match)) {
      let s;
      try { s = await Promise.race([scrapeWebsite(r.website), new Promise((_, j) => setTimeout(() => j(new Error('timeout')), 60000))]); }
      catch (e) { s = { emails: [], error: e.message }; }
      const pick = await resolveOwnerEmail({ emails: s.emails || [], website: r.website, owner: { first: r.owner_first, last: r.owner_last } },
        { verify: NO_GUESS ? null : verify });
      res = { ...res, scraped: s.emails || [], email: pick.email || '', rule: pick.rule, fallback: pick.fallback || '',
        guesses_tried: NO_GUESS ? 0 : Math.min(3, (pick.guesses || []).length), error: s.error || '' };
    }
    fs.appendFileSync(JL, JSON.stringify(res) + '\n'); done.set(r.company_number, res);
    console.log(`${done.size}/${rows.length} ${String(r.company_name).slice(0, 30)} -> ${res.email || '-'} (${res.rule})`);
  }
  const H = [...Object.keys(rows[0]), 'email', 'email_rule', 'email_fallback', 'emails_scraped'];
  const lines = rows.map(r => { const d = done.get(r.company_number) || {};
    return H.map(h => esc(h === 'email' ? d.email : h === 'email_rule' ? d.rule : h === 'email_fallback' ? d.fallback : h === 'emails_scraped' ? (d.scraped || []).join(' ') : r[h])).join(','); });
  fs.writeFileSync(OUT, [H.join(','), ...lines].join('\n'));
  const by = {}; [...done.values()].forEach(d => by[d.rule] = (by[d.rule] || 0) + 1);
  console.log('RULES:', JSON.stringify(by), '| wrote', OUT);
  process.exit(0);
})();
