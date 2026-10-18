'use strict';
// Market-level AI visibility: group companies into buyer-style markets, ask ChatGPT once per market
// (two buyer phrasings), then match every company against the stored answers for free.
//
// Docs consulted 18 Oct 2026:
//  - https://developers.openai.com/api/docs/guides/tools-web-search : POST /v1/responses, tools:[{type:'web_search',
//    search_context_size:'low'|'medium'|'high', user_location}], answer in output[type=message].content[0].text with
//    url_citation annotations; documented models incl. gpt-5.5, gpt-5.4 (reasoning none = lower quality), gpt-4.1,
//    gpt-4.1-mini (128k search context cap); gpt-5 minimal reasoning unsupported.
//  - https://developers.openai.com/api/docs/pricing : web search tool $10.00 per 1k calls plus search content tokens at
//    the model rate; gpt-4.1-mini $0.40 in / $1.60 out per 1M (cheapest documented web_search model; gpt-5.4-mini $0.75/$4.50).
//  - https://platform.claude.com/docs/en/about-claude/pricing : Claude Haiku 5.5 $0.10 in / $0.50 out per MTok (grouping + icebreakers).

const slug = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(ltd|limited|inc|llc|plc|corp|corporation|gmbh|the)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const domOf = u => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').split(/[\/?#]/)[0];

const PHRASINGS = [
  m => `What are the best ${m}? Name up to 8 specific companies, company names in **bold**, one short line each.`,
  m => `Who should I hire or use for ${m}? Name up to 8 specific companies, company names in **bold**, one short line each.`,
];

function parseJSONLoose(t) {
  const m = String(t || '').match(/[\[{][\s\S]*[\]}]/);
  if (!m) throw new Error('no json in model output');
  return JSON.parse(m[0]);
}

// llm(prompt) -> Promise<string>. Returns Map email -> market label.
async function groupMarkets(companies, llm, { batchSize = 40, targetMax = 200, mergeChunk = 400 } = {}) {
  const labels = new Map(); // email -> raw label
  const seen = [];
  for (let i = 0; i < companies.length; i += batchSize) {
    const batch = companies.slice(i, i + batchSize);
    const prompt = `Assign each company a SHORT buyer-style market label, the phrase a buyer would type into ChatGPT, e.g. "AI compliance software for banks", "managed IT services for law firms". 3 to 8 words, plural noun phrase, no brand names. Reuse an existing label whenever a company fits it.\n\nExisting labels: ${JSON.stringify(seen)}\n\nCompanies:\n${batch.map((c, j) => `${j}. ${c.company} | ${c.industry || ''} | ${(c.description || '').slice(0, 200)}`).join('\n')}\n\nReply with ONLY a JSON array of {"i":number,"market":string}.`;
    const arr = parseJSONLoose(await llm(prompt));
    for (const a of arr) {
      const c = batch[a.i]; if (!c || !a.market) continue;
      const lab = String(a.market).trim().replace(/\s+/g, ' ');
      labels.set(c.email, lab);
      if (!seen.some(s => s.toLowerCase() === lab.toLowerCase())) seen.push(lab);
    }
  }
  // case-insensitive dedupe, then LLM merge of near duplicates
  const canonical = new Map(); // lower -> first spelling
  for (const [e, l] of labels) { if (!canonical.has(l.toLowerCase())) canonical.set(l.toLowerCase(), l); labels.set(e, canonical.get(l.toLowerCase())); }
  let uniq = [...canonical.values()];
  const mapping = await mergeMarketNames(uniq, llm, { targetMax, mergeChunk });
  const out = new Map();
  for (const [e, l] of labels) out.set(e, mapping.get(l) || l);
  return out;
}

async function mergeMarketNames(names, llm, { targetMax = 200, mergeChunk = 400 } = {}) {
  const mapping = new Map(names.map(n => [n, n]));
  if (names.length <= targetMax) return mapping;
  for (let i = 0; i < names.length; i += mergeChunk) {
    const chunk = names.slice(i, i + mergeChunk);
    const prompt = `These are market labels. Merge near duplicates and overly narrow variants into broader shared labels so that roughly ${Math.max(10, Math.round(targetMax * chunk.length / names.length))} remain. Keep each canonical label a buyer-style plural noun phrase. Reply with ONLY a JSON object mapping every input label to its canonical label.\n${JSON.stringify(chunk)}`;
    let obj; try { obj = parseJSONLoose(await llm(prompt)); } catch (e) { continue; }
    for (const n of chunk) if (obj[n] && typeof obj[n] === 'string') mapping.set(n, obj[n].trim());
  }
  // second pass over the survivors if still over target (merge across chunks)
  const survivors = [...new Set(mapping.values())];
  if (survivors.length > targetMax * 1.3 && names.length > mergeChunk) {
    const second = await mergeMarketNames(survivors, llm, { targetMax, mergeChunk: Math.max(mergeChunk, survivors.length) });
    for (const [k, v] of mapping) mapping.set(k, second.get(v) || v);
  }
  return mapping;
}

function estimateMarketCost(nMarkets, { perCall = 0.014, calls = PHRASINGS.length, cached = 0 } = {}) {
  return +(Math.max(0, nMarkets - cached) * calls * perCall).toFixed(2);
}

// ask(prompt) -> Promise<{text, urls, cost}>. cache = {get(slug), set(slug, obj)}.
async function runMarketChecks(markets, ask, cache, { capUsd = 6, perCallEstimate = 0.014, log = () => {} } = {}) {
  let spent = 0, calls = 0, stopped = false;
  const results = {};
  for (const m of markets) {
    let entry = cache.get(slug(m)) || { market: m, answers: [] };
    for (let p = 0; p < PHRASINGS.length; p++) {
      if (entry.answers[p]) continue;
      if (spent + perCallEstimate > capUsd) { stopped = true; break; }
      try {
        const r = await ask(PHRASINGS[p](m));
        spent += r.cost || perCallEstimate; calls++;
        entry.answers[p] = { phrasing: p, text: r.text, urls: r.urls || [], cost: r.cost };
        cache.set(slug(m), entry);
      } catch (e) { entry.error = e.message; }
      log(`spent est $${spent.toFixed(2)} (${calls} calls)`);
    }
    results[m] = entry;
    if (stopped) break;
  }
  return { results, spent: +spent.toFixed(4), calls, stopped };
}

// Names a response lists: **bold** names plus "1. Name" heads.
function extractNames(text) {
  const names = [];
  for (const m of String(text || '').matchAll(/\*\*([^*\n]{2,60})\*\*/g)) names.push(m[1].replace(/[:\-–]+$/, '').trim());
  if (!names.length) for (const m of String(text || '').matchAll(/^\s*\d+\.\s+([A-Z][^\n:–\-(]{1,50})/gm)) names.push(m[1].trim());
  return names.filter(n => !/^\d|£|\$|^(why|note|best|top|pros|cons|key)\b/i.test(n));
}

function matchCompany(company, answers) {
  const nk = norm(company.company), d = domOf(company.website);
  let best = null;
  for (const a of answers || []) {
    if (!a || !a.text) continue;
    const names = extractNames(a.text);
    const lowerNames = names.map(norm);
    const text = norm(a.text);
    const nameHit = nk.length >= 3 && (` ${text} `).includes(` ${nk} `);
    const domHit = d && ((a.urls || []).some(u => domOf(u) === d) || a.text.toLowerCase().includes(d));
    if (nameHit || domHit) {
      let pos = lowerNames.findIndex(n => n && (n === nk || n.includes(nk) || (nk.includes(n) && n.length >= 4)));
      pos = pos >= 0 ? pos + 1 : 0;
      if (!best || (pos && (!best.position || pos < best.position))) best = { appears: true, position: pos || '', names, nk };
    }
  }
  const first = (answers || []).find(a => a && a.text);
  const pool = [];
  for (const a of answers || []) for (const n of extractNames(a && a.text)) if (!pool.some(x => norm(x) === norm(n))) pool.push(n);
  const instead = pool.filter(n => norm(n) !== nk && !(nk && norm(n).includes(nk))).slice(0, 4);
  return { appears: !!best, position: best ? best.position : '', named_instead: instead, answered: !!first };
}

module.exports = { slug, norm, domOf, PHRASINGS, parseJSONLoose, groupMarkets, mergeMarketNames, estimateMarketCost, runMarketChecks, extractNames, matchCompany };
