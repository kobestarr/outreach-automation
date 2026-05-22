#!/usr/bin/env node
/**
 * Filter the 442 TPS speakers for BRAND-SIDE advertisers — people who buy
 * podcast ads, NOT the podcast industry / networks / agencies / ad-tech.
 *
 * Heuristic: marketing-role job title + employer NOT in the podcast-industry
 * blocklist. Output ranked by signal strength.
 */
const fs = require("fs");
const path = require("path");

const CSV = path.join(__dirname, "exports", "podcast-show-london-2026-speakers.csv");
function parseCSV(text) {
  const rows = []; let cur = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"' && text[i+1] === '"') { field += '"'; i++; } else if (c === '"') inQ = false; else field += c; }
    else { if (c === '"') inQ = true; else if (c === ",") { cur.push(field); field=""; } else if (c==="\r"){} else if (c === "\n") { cur.push(field); rows.push(cur); cur=[]; field=""; } else field += c; }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  const h = rows.shift();
  return rows.filter(r => r.some(v => v && v.trim())).map(r => { const o = {}; h.forEach((k,i)=>o[k]=(r[i]||"").trim()); return o; });
}

const data = parseCSV(fs.readFileSync(CSV, "utf8"));

// === Podcast industry blocklist (employers we DON'T want) ===
// Anyone whose company makes its living FROM podcasts is excluded.
const PODCAST_INDUSTRY = [
  // Big platforms / networks
  "spotify", "acast", "bbc", "audible", "amazon music", "apple podcasts",
  "iheart", "iheartmedia", "iheartradio", "arn", "wondery", "audioboom",
  "global", "bauer", "bauer media", "bauer audio", "podimo", "noiser",
  "goalhanger", "flightstory", "novel", "your aunties could never", "platform media",
  "bbc studios", "channel 4", "sky", "sky news", "sky sports", "talkSPORT", "talkradio",
  "audio uk", "radiocentre", "the podcast show",

  // Production studios
  "chalk + blade", "chalk and blade", "folding pocket", "listen", "listen entertainment",
  "crowd", "crowd network", "persephonica", "rusty quill", "tenderfoot tv",
  "lemonada media", "lower street", "message heard", "headgum", "libsyn",
  "transistor.fm", "transistor", "buzzsprout", "captivate", "megaphone",
  "art19", "studio bummens", "arc.studio", "stripped media", "stripped",

  // Sales houses / ad tech / measurement
  "dax", "dax uk", "dax us", "dax audio", "triton digital", "podscribe",
  "audiostack", "soundstack", "ad results media", "media bodies", "sound insights",
  "supercast", "headliner", "vgc partners", "ausha", "barometer",

  // Talent / agency on the podcast side
  "united talent agency", "uta", "wme", "agency hackers podcast", "sport social podcast network",

  // YouTube / Meta etc. (they're platforms, not brand advertisers in this context)
  "youtube", "meta", "tiktok", "substack", "google",

  // News / publishing media (gray area — usually treated as media, not advertiser)
  "ft", "financial times", "the guardian", "the times", "reuters", "bloomberg",

  // Niche podcast businesses
  "podimo", "ausha", "riverside", "riverside.fm", "amplifi media", "voxtopica",
  "trueFans", "flightcast", "flightpath", "headliner", "barometer",
  "africa podcast network", "ad results media", "nouvelles écoutes",
  "amplifi media", "inception point ai", "lemonada media", "headgum",
  "art19, an amazon company", "art19 an amazon company",
  "amazon", "amazon studios",
  "soundstack", "podscribe", "supporting cast", "audioboom",
  "the overlap", "tifo", "skores",
];

// === Marketing-side job title patterns ===
const MARKETING_TITLE = /\b(growth|brand|marketing|media|digital|performance|cmo|chief marketing|chief brand|head of brand|head of marketing|head of growth|head of digital|head of media|director of (marketing|brand|growth|digital|media|performance)|svp.*marketing|vp.*marketing|senior marketing|senior brand|senior media|senior digital|senior growth)\b/i;

// === Score function: brand-side + marketing role ===
function classify(s) {
  const employer = (s.employer || "").toLowerCase();
  const title = (s.jobTitle || "").toLowerCase();
  if (!employer || !title) return null;

  // Exclude if employer is in podcast industry
  const isPodcastIndustry = PODCAST_INDUSTRY.some(p => employer.includes(p));
  if (isPodcastIndustry) return null;

  // Must have a marketing-side title
  if (!MARKETING_TITLE.test(title)) return null;

  // Extra signal: B2C consumer brand indicators (gives a tier hint)
  const consumerBrandHints = /\b(travel|app|gambling|betting|retail|fashion|food|drink|beauty|fitness|finance|fintech|insurance|automotive|telecoms|streaming|gaming|games|entertainment|wellness|health|charity|sports|news|media)\b/i;
  const hasConsumerHint = consumerBrandHints.test(employer + " " + title);
  return { ...s, _hasConsumerHint: hasConsumerHint };
}

const candidates = data.map(classify).filter(Boolean);

// Tier sort: consumer-brand hint first, then employer name
candidates.sort((a, b) => {
  if (a._hasConsumerHint !== b._hasConsumerHint) return b._hasConsumerHint - a._hasConsumerHint;
  return a.name.localeCompare(b.name);
});

// Reference: the brand-side people Chris already flagged
const KNOWN_BRAND_SIDE = new Set([
  "Brittany Clevenger", "Alex McClure", "Daniel Chandley",
]);

console.log(`=== Brand-side / advertiser speakers — beyond the 3 Chris already flagged ===\n`);
console.log(`(Chris already on-list: Brittany Clevenger @ BetterHelp, Alex McClure @ Expedia, Daniel Chandley @ Entain/Coral)\n`);

const tierA = [], tierB = [];
for (const c of candidates) {
  if (KNOWN_BRAND_SIDE.has(c.name)) continue;
  (c._hasConsumerHint ? tierA : tierB).push(c);
}

console.log(`--- Tier A: strong brand-side signal (n=${tierA.length}) ---`);
for (const c of tierA) console.log(`  ${c.name.padEnd(28)} | ${(c.jobTitle || "").slice(0, 55).padEnd(55)} @ ${c.employer}`);

console.log(`\n--- Tier B: marketing title at non-podcast employer (n=${tierB.length}) ---`);
for (const c of tierB) console.log(`  ${c.name.padEnd(28)} | ${(c.jobTitle || "").slice(0, 55).padEnd(55)} @ ${c.employer}`);

console.log(`\n=== Summary ===`);
console.log(`  Total candidates surfaced:  ${candidates.length}`);
console.log(`  Chris already on-list:      ${KNOWN_BRAND_SIDE.size}`);
console.log(`  Tier A additions:           ${tierA.length}`);
console.log(`  Tier B additions:           ${tierB.length}`);
