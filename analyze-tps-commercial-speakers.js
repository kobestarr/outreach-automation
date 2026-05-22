#!/usr/bin/env node
/**
 * Cross-reference Chris Baughen's list of 14 "Commercial speakers" from
 * The Podcast Show 2026 against our full 442-speaker scrape.
 *
 * Output:
 *  - Which of Chris's 14 are confirmed in the scraped list (validates spelling/employer)
 *  - Which are NOT in the scrape (either added late, or Chris-known but not on the public roster)
 *  - Additional commercial-theme speakers from the 442 that Chris hasn't picked yet,
 *    grouped by theme (agency/buying, brand marketing, network sales, etc.)
 */
const fs = require("fs");
const path = require("path");

// --- Chris's 14 commercial speakers (from the Google Doc) ---
const CHRIS_LIST = [
  { name: "Brittany Clevenger", title: "Senior Director of Growth Marketing", employer: "BetterHelp" },
  { name: "Alex McClure", title: "Senior Manager - Global Digital Media", employer: "Expedia" },
  { name: "Ali Griffin", title: "Chief Commercial Officer", employer: "Platform Media" },
  { name: "Andrea Marsh", title: "Supply Partnerships Director", employer: "DAX UK" },
  { name: "Ben Robins", title: "Founder", employer: "Sound Insights" },
  { name: "Beth Hatchett", title: "Agent", employer: "United Talent Agency" },
  { name: "Chloe Yates", title: "Head of Agency Sales", employer: "Sport Social Podcast Network" },
  { name: "Corey Layton", title: "Head of iHeart Strategic Partnerships and Product", employer: "ARN" },
  { name: "Dan Rookwood", title: "Partner and Chief Brands Officer", employer: "VGC Partners" },
  { name: "Daniel Chandley", title: "Senior Brand Manager", employer: "Entain (Coral)" },
  { name: "Ed Fuller", title: "Founder and CEO", employer: "Media Bodies" },
  { name: "Faye Trinquart", title: "Market Strategy Lead", employer: "DAX Audio" },
  { name: "Matt Morris", title: "Head of Innovation", employer: "Global" },
  { name: "Ryan Rummery", title: "Global Head of International Podcast Sales", employer: "Spotify" },
];

// --- Load the 442-speaker scrape ---
const CSV_PATH = path.join(__dirname, "exports", "podcast-show-london-2026-speakers.csv");
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

const scraped = parseCSV(fs.readFileSync(CSV_PATH, "utf8"));
const byName = new Map(scraped.map(s => [s.name.toLowerCase(), s]));

// --- Match Chris's list against scrape ---
console.log("=== Chris's 14 — confirmed on TPS speaker page ===\n");
const matched = [], unmatched = [];
for (const c of CHRIS_LIST) {
  const m = byName.get(c.name.toLowerCase());
  if (m) {
    matched.push({ chris: c, scraped: m });
    const empMatch = (m.employer || "").toLowerCase() === c.employer.toLowerCase() ? "✓" : `(scraped employer: "${m.employer}")`;
    console.log(`  ✓ ${c.name.padEnd(22)} | ${c.title} @ ${c.employer}  ${empMatch === "✓" ? "" : empMatch}`);
  } else {
    unmatched.push(c);
  }
}

if (unmatched.length) {
  console.log("\n=== Chris's list — NOT found in scraped 442 ===");
  for (const c of unmatched) console.log(`  · ${c.name.padEnd(22)} | ${c.title} @ ${c.employer}`);
  console.log("  (could be late additions, name spelling mismatch, or behind-the-scenes attendees)\n");
}

// --- Commercial-theme keyword filters ---
const COMMERCIAL_TITLE_PATTERNS = [
  /\b(chief commercial|cmo|chief brand|chief revenue|cro|chief marketing)\b/i,
  /\b(commercial director|sales director|partnerships director|marketing director|brand director|head of partnerships|head of sales|head of commercial|head of brand|head of marketing|head of growth)\b/i,
  /\b(vp|vice president).*(commercial|sales|partnerships|marketing|brand|growth|revenue|monetization|monetisation)\b/i,
  /\b(growth marketing|performance marketing|brand marketing|brand manager|brand strategist)\b/i,
  /\b(media buyer|media planner|agency|buying)\b/i,
  /\b(podcast sales|audio sales|advertising sales|ad sales|sponsorship)\b/i,
  /\b(supply partnerships|partnerships lead|strategic partnerships)\b/i,
  /\b(founder.*(agency|network|media|sales))\b/i,
  /\b(ceo|managing director)\b/i,  // catches network/agency MDs — filter further by employer
];

// Already-on-Chris list (de-dup)
const chrisNames = new Set(CHRIS_LIST.map(c => c.name.toLowerCase()));

// Score each scraped speaker by how well they match commercial themes
const candidates = [];
for (const s of scraped) {
  if (chrisNames.has(s.name.toLowerCase())) continue;
  const title = s.jobTitle || "";
  const employer = s.employer || "";
  let matched = false;
  for (const re of COMMERCIAL_TITLE_PATTERNS) {
    if (re.test(title) || re.test(employer)) { matched = true; break; }
  }
  if (matched) candidates.push(s);
}

// Bucket the candidates by theme
function theme(s) {
  const t = (s.jobTitle || "").toLowerCase();
  if (/(buyer|agency|buying|media planning)/.test(t)) return "Agency / media-buying";
  if (/(brand|growth marketing|performance marketing)/.test(t)) return "Brand & growth marketing (advertiser side)";
  if (/(podcast sales|ad sales|audio sales|sponsorship)/.test(t)) return "Podcast / audio ad sales";
  if (/(partnerships|supply)/.test(t)) return "Partnerships / supply";
  if (/(commercial|revenue|monetization|monetisation|cmo|chief)/.test(t)) return "Senior commercial leadership";
  return "Other commercial";
}

candidates.sort((a, b) => theme(a).localeCompare(theme(b)) || a.name.localeCompare(b.name));

console.log(`=== Additional commercial-theme speakers from the 442-scrape NOT on Chris's list ===\n`);
let currentTheme = null;
for (const c of candidates) {
  const t = theme(c);
  if (t !== currentTheme) { console.log(`\n— ${t} —`); currentTheme = t; }
  console.log(`  ${c.name.padEnd(28)} | ${(c.jobTitle || "").padEnd(45)} @ ${c.employer || "?"}`);
}

console.log(`\n=== Summary ===`);
console.log(`  Chris's list:               ${CHRIS_LIST.length}`);
console.log(`    confirmed in 442 scrape:  ${matched.length}`);
console.log(`    NOT in scrape:            ${unmatched.length}`);
console.log(`  Additional candidates:      ${candidates.length}`);
