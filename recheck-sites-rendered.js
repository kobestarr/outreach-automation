#!/usr/bin/env node
/**
 * Re-check "parked" / "thin" verdicts in a REAL browser before anyone gets a "your site is broken" email.
 *
 * process-funded-startups.js reads raw HTML: JS-rendered sites (BAE Systems) look "thin", and any page that
 * mentions GoDaddy/Sedo/"coming soon" in a footer looks "parked". This renders the page, measures visible
 * text, and only keeps parked for genuine for-sale / parked-domain pages.
 *
 * Usage: node recheck-sites-rendered.js exports/funded-startups-2026-09-checked.csv [--dry-run]
 * Rewrites the CSV in place (backup at <file>.pre-recheck) and recomputes realNeed / aiInvisible / hot.
 */
const fs = require('fs');
const { chromium } = require('playwright');

const SRC = process.argv[2];
const DRY = process.argv.includes('--dry-run');
const PARKED = /(this domain (is|may be) for sale|buy this domain|domain (is )?parked|parked (free|domain)|is for sale!|make an offer on this domain|sedo domain parking|hugedomains)/i;
const SOON = /^(\s*(coming soon|under construction|website (is )?(coming soon|under construction))\W*)$/i;

function parseCsv(t) {
  const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); if (row.length > 1) rows.push(row); row = []; f = ''; }
    else f += c; }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

(async () => {
  const rows = parseCsv(fs.readFileSync(SRC, 'utf8'));
  const H = rows[0]; const ix = n => H.indexOf(n);
  const targets = rows.slice(1).filter(r => ['parked', 'thin'].includes(r[ix('siteStatus')]));
  console.log(`Re-checking ${targets.length} parked/thin sites in a rendered browser...`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' });
  const changes = {};
  for (let i = 0; i < targets.length; i += 6) {
    await Promise.all(targets.slice(i, i + 6).map(async r => {
      const before = r[ix('siteStatus')];
      let url = r[ix('website')]; if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      const page = await ctx.newPage();
      let after;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2500); // let JS frameworks paint
        const text = (await page.evaluate(() => document.body ? document.body.innerText : '')).replace(/\s+/g, ' ').trim();
        if (PARKED.test(text) || PARKED.test(await page.title())) after = 'parked';
        else if (SOON.test(text) || text.length < 300) after = 'thin';
        else after = 'ok';
        r.__rendered = text.length;
      } catch (e) { after = 'error'; }
      await page.close();
      r[ix('siteStatus')] = after;
      const k = `${before}->${after}`; changes[k] = (changes[k] || 0) + 1;
    }));
    process.stdout.write(`  ${Math.min(i + 6, targets.length)}/${targets.length}\r`);
  }
  await browser.close();

  // Recompute verdicts exactly as process-funded-startups.js does
  for (const r of rows.slice(1)) {
    const s = r[ix('siteStatus')];
    const realNeed = (s === 'parked' || s === 'thin' || s === 'http404' || /^http5/.test(s)) ? 'YES' : (s === 'error' || /^http4/.test(s)) ? 'maybe' : 'no';
    r[ix('realNeed')] = realNeed;
    // rendered-ok sites have no aiScore signal from this pass; keep their original aiInvisible
    if (s !== 'ok' && s !== 'thin') r[ix('aiInvisible')] = 'no';
    r[ix('hot')] = (realNeed === 'YES' || r[ix('aiInvisible')] === 'YES') ? 1 : 0;
  }
  console.log('\nVerdict changes:', JSON.stringify(changes));
  const hot = rows.slice(1).filter(r => String(r[ix('hot')]) === '1').length;
  console.log(`Real website need now: ${rows.slice(1).filter(r => r[ix('realNeed')] === 'YES').length} | HOT now: ${hot}`);
  if (DRY) { console.log('[dry-run] CSV not rewritten'); return; }
  fs.copyFileSync(SRC, SRC + '.pre-recheck');
  fs.writeFileSync(SRC, rows.map(r => r.map(esc).join(',')).join('\n'));
  console.log(`Rewrote ${SRC} (backup ${SRC}.pre-recheck)`);
})();
