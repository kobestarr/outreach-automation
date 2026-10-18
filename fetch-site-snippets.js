#!/usr/bin/env node
// Free homepage snippets via curl: title, meta description, h1/h2, first 300 chars of body text.
// Usage: node fetch-site-snippets.js <send.csv> --out exports/icebreaker-cache/snippets.json
const fs = require('fs'), cp = require('child_process');
const { parseCSV } = require('./shared/outreach-core/csv/csv-util');
const { stripHtml } = require('./shared/outreach-core/enrichment/icebreaker-lib');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
function snippetFromHtml(html) {
  const g = (re) => { const m = html.match(re); return m ? stripHtml(m[1]) : ''; };
  const title = g(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const meta = g(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || g(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i) || g(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
  const hs = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].map(m => stripHtml(m[1])).filter(Boolean).slice(0, 6);
  const body = stripHtml(html.replace(/<head[\s\S]*?<\/head>/i, '')).slice(0, 300);
  return [title && 'T: ' + title, meta && 'M: ' + meta, hs.length && 'H: ' + hs.join(' | '), body && 'B: ' + body].filter(Boolean).join('\n').slice(0, 900);
}
function curl(url) {
  return new Promise(res => cp.execFile('curl', ['-sL', '-m', '15', '--max-filesize', '3000000', '-A', 'Mozilla/5.0 (compatible; research)', url], { maxBuffer: 8e6 }, (e, out) => res(e ? '' : out)));
}
module.exports = { snippetFromHtml };
if (require.main === module) (async () => {
  const IN = process.argv[2], OUT = arg('out');
  const rows = parseCSV(fs.readFileSync(IN, 'utf8')); const H = rows[0];
  const recs = rows.slice(1).map(r => Object.fromEntries(H.map((h, i) => [h, r[i] || ''])));
  const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const todo = recs.filter(r => !(r.email in done)); let n = 0;
  const worker = async () => { while (todo.length) { const r = todo.pop(); const html = await curl(r.website); done[r.email] = html ? snippetFromHtml(html) : ''; if (++n % 50 === 0) { fs.writeFileSync(OUT, JSON.stringify(done)); console.log(n); } } };
  await Promise.all(Array.from({ length: 12 }, worker));
  fs.writeFileSync(OUT, JSON.stringify(done));
  console.log('snippets', Object.values(done).filter(Boolean).length, '/', recs.length);
})();
