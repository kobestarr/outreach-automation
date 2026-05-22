#!/usr/bin/env node
/**
 * Import scraped Podcast Show London 2026 speakers into the DB.
 *
 * Source: exports/podcast-show-london-2026-speakers.csv (442 rows)
 * Tag:    event-podcast-show-london-2026-speakers
 *
 * Each speaker becomes one row, name-centric (not employer-centric — same
 * lesson as the cardiologist import).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const FILE = path.join(__dirname, "exports", "podcast-show-london-2026-speakers.csv");
const CAMPAIGN = "event-podcast-show-london-2026-speakers";
const DB_PATH = path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "businesses.db");

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

const db = new Database(DB_PATH);
const data = parseCSV(fs.readFileSync(FILE, "utf8"));
console.log(`Parsed ${data.length} speakers from CSV`);

// Pre-flight: how many already tagged?
const already = db.prepare(`SELECT COUNT(*) AS n FROM businesses WHERE campaigns LIKE ?`).get(`%"${CAMPAIGN}"%`).n;
console.log(`Already tagged: ${already}`);

const insertStmt = db.prepare(`INSERT INTO businesses (
  id, name, location, postcode, address, website, phone, category,
  owner_first_name, owner_last_name, owner_email, email_source, email_verified,
  linkedin_url, status, scraped_at, enriched_at, business_data, campaigns,
  created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET
  category = excluded.category,
  address = excluded.address,
  business_data = excluded.business_data,
  campaigns = (
    SELECT json_group_array(value) FROM (
      SELECT DISTINCT value FROM (
        SELECT value FROM json_each(businesses.campaigns)
        UNION
        SELECT value FROM json_each(excluded.campaigns)
      )
    )
  ),
  updated_at = CURRENT_TIMESTAMP`);

let inserted = 0, skipped = 0;
const tx = db.transaction(() => {
  for (const r of data) {
    const name = r["name"] || "";
    const fn = r["firstName"] || "";
    const ln = r["lastName"] || "";
    if (!name) { skipped++; continue; }

    // ID seeded on profileUrl when available, otherwise name + employer
    const seed = r["profileUrl"] || `${name}|${r["employer"] || ""}`;
    const hash = crypto.createHash("md5").update(seed).digest("hex").slice(0, 12);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
    const id = `pcs2026-${slug}-${hash}`;

    insertStmt.run(
      id,
      name,                                  // name = speaker's name (one row per person)
      "London, UK",                          // event location
      "",
      r["employer"] || null,                 // address = employer name (hospital-equivalent slot)
      null,                                  // website blank (employer site varies)
      null,
      r["jobTitle"] || "Speaker",
      fn || null,
      ln || null,
      null,                                  // no email yet — Consulti enrichment fills this
      null,
      0,
      null,                                  // no LinkedIn URL from this scrape (event-profile only)
      "imported",
      new Date().toISOString(),
      new Date().toISOString(),
      JSON.stringify({
        eventProfileUrl: r["profileUrl"],
        imageUrl: r["imageUrl"],
        description: r["description"],
        employer: r["employer"],
        jobTitle: r["jobTitle"],
        source: "thepodcastshowlondon.com",
        scrapedAt: new Date().toISOString(),
      }),
      JSON.stringify([CAMPAIGN])
    );
    inserted++;
  }
});
tx();

const total = db.prepare(`SELECT COUNT(*) AS n FROM businesses`).get().n;
const tagged = db.prepare(`SELECT COUNT(*) AS n FROM businesses WHERE campaigns LIKE ?`).get(`%"${CAMPAIGN}"%`).n;
console.log(`\n✓ Inserted/updated: ${inserted}, skipped: ${skipped}`);
console.log(`DB total: ${total}`);
console.log(`Campaign ${CAMPAIGN}: ${tagged}`);
