#!/usr/bin/env node
/**
 * Scrape The Podcast Show London 2026 speaker line-up.
 *
 * Discovery findings:
 *   - Platform: ASP Events (themes.asp.events/_base/1-3-0/) — UK trade-show CMS
 *   - Each speaker is embedded as <script type="application/ld+json"> @type=Person
 *   - Pagination: ?page=1..45 (10 per page). Bare page == page 1.
 *   - Per-speaker profile URL: /speakers/{slug} (richer but no email; the event page
 *     itself doesn't expose personal social links)
 *   - ~442 speakers total
 *
 * Outputs:
 *   - exports/podcast-show-london-2026-speakers.csv (Mailead/Lemlist-ready columns)
 *   - exports/podcast-show-london-2026-speakers.jsonl (raw structured records)
 *
 * Usage:
 *   node scrape-podcast-show-speakers.js
 *   node scrape-podcast-show-speakers.js --max-pages=5     # dev/limit
 *   node scrape-podcast-show-speakers.js --no-csv          # JSONL only
 */
const fs = require("fs");
const path = require("path");

const args = Object.fromEntries(process.argv.slice(2).flatMap(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [[m[1], m[2] ?? true]] : [];
}));

const BASE = "https://www.thepodcastshowlondon.com/speaker-line-up";
const MAX_PAGES = args["max-pages"] ? parseInt(args["max-pages"], 10) : 60; // safety
const THROTTLE_MS = 700;
const OUT_DIR = path.join(__dirname, "exports");
const OUT_CSV = path.join(OUT_DIR, "podcast-show-london-2026-speakers.csv");
const OUT_JSONL = path.join(OUT_DIR, "podcast-show-london-2026-speakers.jsonl");

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(page) {
  const url = `${BASE}?page=${page}`;
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for page ${page}`);
  return r.text();
}

// Extract all <script type="application/ld+json">...</script> blocks
function extractLdJson(html) {
  const results = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { results.push(JSON.parse(m[1].trim())); } catch {}
  }
  return results;
}

function normalisePersonBlock(b) {
  if (!b || b["@type"] !== "Person") return null;
  const profileUrl = b.mainEntityOfPage?.["@id"] || null;
  const fullName = (b.name || "").trim();
  const parts = fullName.split(/\s+/);
  const firstName = parts.shift() || "";
  const lastName = parts.join(" ");
  return {
    name: fullName,
    firstName,
    lastName,
    jobTitle: (b.jobTitle || "").trim() || null,
    employer: b.worksFor?.name?.trim() || null,
    profileUrl,
    imageUrl: b.image || null,
    description: (b.description || "").replace(/&[a-z]+;/gi, "").replace(/\s+/g, " ").trim() || null,
  };
}

function toCSV(records) {
  const cols = ["name", "firstName", "lastName", "jobTitle", "employer", "profileUrl", "imageUrl", "description"];
  const esc = v => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const lines = [cols.join(",")];
  for (const r of records) lines.push(cols.map(c => esc(r[c])).join(","));
  return lines.join("\n");
}

(async () => {
  console.log(`Scraping ${BASE}`);
  const seen = new Map(); // profileUrl → record
  const jsonlStream = fs.createWriteStream(OUT_JSONL, { flags: "w" });
  let consecutiveEmpty = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    let html;
    try { html = await fetchPage(page); }
    catch (e) { console.warn(`page ${page} fetch failed: ${e.message}`); await sleep(THROTTLE_MS); continue; }

    const blocks = extractLdJson(html);
    const people = blocks.map(normalisePersonBlock).filter(Boolean);
    let newCount = 0;
    for (const p of people) {
      const key = p.profileUrl || p.name;
      if (!seen.has(key)) {
        seen.set(key, p);
        jsonlStream.write(JSON.stringify(p) + "\n");
        newCount++;
      }
    }
    console.log(`page ${page}: ${people.length} parsed, ${newCount} new (cumulative ${seen.size})`);
    if (people.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 2) { console.log("Two empty pages in a row — stopping."); break; }
    } else { consecutiveEmpty = 0; }
    await sleep(THROTTLE_MS);
  }
  jsonlStream.end();

  const records = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (!args["no-csv"]) {
    fs.writeFileSync(OUT_CSV, toCSV(records));
    console.log(`\n✓ CSV: ${OUT_CSV}  (${records.length} rows)`);
  }
  console.log(`✓ JSONL: ${OUT_JSONL}`);

  // Top-of-list summary
  const byEmployer = {};
  for (const r of records) { if (r.employer) byEmployer[r.employer] = (byEmployer[r.employer] || 0) + 1; }
  const topEmp = Object.entries(byEmployer).sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`\nTop employers in the speaker list:`);
  topEmp.forEach(([e, n]) => console.log(`  ${String(n).padStart(3)}  ${e}`));
})();
