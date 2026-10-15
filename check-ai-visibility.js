#!/usr/bin/env node
/**
 * Per-prospect AI visibility check: ask ChatGPT (web search, UK location) for "<trade> in <town>" and record
 * whether the firm appears, where, and who is named instead. Used to (a) drop firms already on top before a
 * "see who comes up" email, (b) fuel the "three things I'd change" reply.
 * API checked 2026-10-15 (developers.openai.com tools-web-search): POST /v1/responses, tools:[{type:'web_search', user_location}].
 * Usage: node check-ai-visibility.js <send.csv> --out <out.json> [--concurrency 6]
 */
const fs = require('fs');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const IN = process.argv[2], OUT = arg('out', IN.replace(/\.csv$/, '-ai.json')), CONC = parseInt(arg('concurrency', '6'), 10);
const k = require(process.env.HOME + '/.credentials/api-keys.json').openai; const KEY = typeof k === 'string' ? k : (k.apiKey || k.key);
function parseCSV(t) { const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); if (row.length > 1) rows.push(row); row = []; f = ''; } else f += c; }
  if (f || row.length) { row.push(f); rows.push(row); }
  const H = rows[0]; return rows.slice(1).map(r => Object.fromEntries(H.map((h, i) => [h, r[i] || ''])));
}
const dom = u => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
const norm = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/\b(ltd|limited|the|and|services?)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
async function ask(q, town) {
  const r = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.5', tools: [{ type: 'web_search', user_location: { type: 'approximate', country: 'GB', city: town, region: 'Greater Manchester' } }], input: q }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message);
  const msg = (j.output || []).filter(o => o.type === 'message').pop();
  return { text: msg ? msg.content[0].text : '', urls: msg ? (msg.content[0].annotations || []).map(a => a.url) : [] };
}
(async () => {
  const rows = parseCSV(fs.readFileSync(IN, 'utf8'));
  const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const todo = rows.filter(r => !done[r.email]);
  for (let i = 0; i < todo.length; i += CONC) {
    await Promise.all(todo.slice(i, i + CONC).map(async r => {
      const trade = r.category.replace(/^an? /, '');
      const q = `Who's a good ${trade} in ${r.town}?`;
      try {
        const { text, urls } = await ask(q, r.town);
        const d = dom(r.website); const nameKey = norm(r.company).split(' ').filter(w => w.length > 2).slice(0, 2).join(' ');
        const lower = text.toLowerCase();
        const byDomain = d && (urls.some(u => dom(u) === d) || lower.includes(d));
        const byName = nameKey && norm(text).includes(nameKey);
        const appears = !!(byDomain || byName);
        // position = order of first mention among bolded/numbered names, rough but useful
        const names = [...text.matchAll(/\*\*([^*]{3,60})\*\*/g)].map(m => m[1].trim()).filter(n => !/^\d|£|phone|rating|tel|why|best|note/i.test(n));
        const pos = appears ? (names.findIndex(n => norm(n).includes(nameKey) || (d && n.toLowerCase().includes(d.split('.')[0]))) + 1 || 'mentioned') : 0;
        done[r.email] = { company: r.company, query: q, appears, position: pos, named_instead: names.slice(0, 4), cited: [...new Set(urls.map(dom))].slice(0, 6) };
      } catch (e) { done[r.email] = { company: r.company, query: q, error: e.message }; }
      fs.writeFileSync(OUT, JSON.stringify(done, null, 1));
    }));
    console.log(`${Math.min(i + CONC, todo.length)}/${todo.length}`);
  }
  const v = Object.values(done);
  console.log(`appears: ${v.filter(x => x.appears).length} | not shown: ${v.filter(x => x.appears === false).length} | errors: ${v.filter(x => x.error).length} -> ${OUT}`);
})();
