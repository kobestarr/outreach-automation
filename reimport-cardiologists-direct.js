#!/usr/bin/env node
/**
 * Re-import LeadRocks cardiologists with direct SQL — bypasses saveBusiness()
 * which uses heuristic dedup (name+postcode / website-domain / address) that
 * collides cardiologists with each other AND with pre-existing UFH/KSD rows.
 *
 * Each cardiologist gets a unique ID derived from their email + LinkedIn URL,
 * so within-CSV duplicates AND cross-DB collisions are impossible.
 *
 * Run AFTER cleanup-bad-cardiologist-import.js has removed any prior attempt.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const FILE = "/Users/kobestarr/Downloads/leadrocks_cardiologists_2024_01_11.csv";
const CAMPAIGN = "doctors-website-cardiologists-uk";
const DB_PATH = path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "businesses.db");
const EXCLUDE = new Set(["j.grapsa@rbht.nhs.uk", "d.w.s.chong@gmail.com", "dwschong@gmail.com"]);

function parseCSV(text) {
  const rows = []; let cur = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"' && text[i+1] === '"') { field += '"'; i++; } else if (c === '"') inQ = false; else field += c; }
    else { if (c === '"') inQ = true; else if (c === ",") { cur.push(field); field=""; } else if (c==="\r"){} else if (c === "\n") { cur.push(field); rows.push(cur); cur=[]; field=""; } else field += c; }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  const h = rows.shift();
  return rows.filter(r => r.some(v => v && v.trim())).map(r => { const o = {}; h.forEach((k,i) => o[k] = (r[i]||"").trim()); return o; });
}

function pickEmail(r) {
  for (const c of ["Work Email #1","Work Email #2","Work Email #3","Direct Email #1","Direct Email #2"]) {
    const v = r[c]?.trim().toLowerCase();
    if (v && /.+@.+\..+/.test(v)) return v;
  }
  return null;
}

function postcodeOf(loc) {
  if (!loc) return "";
  const m = loc.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i);
  return m ? m[1].toUpperCase() : "";
}

// Pre-flight: any rows still tagged?
const db = new Database(DB_PATH);
const stillTagged = db.prepare(`SELECT COUNT(*) AS n FROM businesses WHERE campaigns LIKE ?`).get(`%"${CAMPAIGN}"%`).n;
if (stillTagged > 0) {
  console.error(`✗ Refusing to run: ${stillTagged} rows still tagged with ${CAMPAIGN}. Run cleanup-bad-cardiologist-import.js first.`);
  process.exit(1);
}

const data = parseCSV(fs.readFileSync(FILE, "utf8"));
console.log(`CSV rows: ${data.length}`);

let skipped = 0, inserted = 0;
const insertStmt = db.prepare(`INSERT INTO businesses (
  id, name, location, postcode, address, website, phone, category,
  owner_first_name, owner_last_name, owner_email, email_source, email_verified,
  linkedin_url, status, scraped_at, enriched_at, business_data, campaigns,
  created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);

const tx = db.transaction(() => {
  for (const r of data) {
    const email = pickEmail(r);
    if (email && EXCLUDE.has(email)) { skipped++; continue; }
    if (!email && !r["Linked Url"]) { skipped++; continue; }

    const fn = (r["First Name"] || "").trim();
    const ln = (r["Last Name"] || "").trim();
    const fullName = (r["Full Name"] || `${fn} ${ln}`).trim() || "Unknown Cardiologist";

    // Unique ID: hash of email + LinkedIn URL (both effectively unique per person)
    const uniqStr = `${email || ""}|${r["Linked Url"] || ""}|${fullName}`;
    const hash = crypto.createHash("md5").update(uniqStr).digest("hex").slice(0, 12);
    const slug = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
    const id = `cardio-${slug}-${hash}`;

    insertStmt.run(
      id,
      fullName,
      r["Location"] || null,
      postcodeOf(r["Location"]),
      [r["Company"], r["Location"]].filter(Boolean).join(" — ") || null,
      null,                         // do NOT set top-level website (hospital site, shared)
      r["Phone #1"] || r["Company Phone"] || null,
      r["Job Title"] || "Consultant Cardiologist",
      fn || null,
      ln || null,
      email,
      "leadrocks-2024-01",
      0,
      r["Linked Url"] || null,
      "imported",
      "2024-01-11T00:00:00.000Z",
      new Date().toISOString(),
      JSON.stringify({
        ownerFirstName: fn,
        ownerLastName: ln,
        ownerEmail: email,
        linkedInUrl: r["Linked Url"],
        employer: r["Company"],
        employerWebsite: r["Company Website"],
        industry: r["Industry"],
        teamSize: r["Team Size"],
        companyEmail: r["Company Email"],
        rawLeadRocks: r,
      }),
      JSON.stringify([CAMPAIGN])
    );
    inserted++;
  }
});
tx();

const total = db.prepare("SELECT COUNT(*) AS n FROM businesses").get().n;
const tagged = db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN owner_email IS NOT NULL THEN 1 ELSE 0 END) AS with_email, SUM(CASE WHEN linkedin_url IS NOT NULL THEN 1 ELSE 0 END) AS with_li FROM businesses WHERE campaigns LIKE ?`).get(`%"${CAMPAIGN}"%`);
console.log(`\n✓ Inserted: ${inserted}, skipped: ${skipped}`);
console.log(`DB total: ${total}`);
console.log(`Campaign ${CAMPAIGN}: n=${tagged.n}, with_email=${tagged.with_email}, with_li=${tagged.with_li}`);
