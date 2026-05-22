#!/usr/bin/env node
/**
 * Import LeadRocks cardiologists CSV → outreach-automation DB.
 *
 * Source: ~/Downloads/leadrocks_cardiologists_2024_01_11.csv (360 UK consultant cardiologists)
 *
 * Maps LeadRocks columns:
 *   First Name + Last Name → owner_first_name / owner_last_name
 *   Job Title              → category
 *   Company                → name (the business: the hospital / trust)
 *   Company Website        → website (when present)
 *   Linked Url             → linkedin_url
 *   Location               → location / postcode (parsed where possible)
 *   Phone #1               → phone
 *   Work Email #1..3 / Direct #1..2 cascade → owner_email (first non-empty)
 *
 * Exclusion list (hardcoded — DO NOT email these, ever):
 *   - j.grapsa@rbht.nhs.uk (opted out 19-Feb-2024, GDPR-grade)
 *   - d.w.s.chong@gmail.com / dwschong@gmail.com (Gmail hard-bounce, 550 5.7.26)
 *
 * Tags inserted with campaign `doctors-website-cardiologists-uk`.
 *
 * Usage:
 *   node import-leadrocks-cardiologists.js --dry-run
 *   node import-leadrocks-cardiologists.js
 *   node import-leadrocks-cardiologists.js --file=/path/to/csv --campaign=name
 */

const fs = require("fs");
const path = require("path");
const { initDatabase, saveBusiness } = require("./ksd/local-outreach/orchestrator/modules/database");

const args = Object.fromEntries(process.argv.slice(2).flatMap(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [[m[1], m[2] ?? true]] : [];
}));

const FILE = args.file || "/Users/kobestarr/Downloads/leadrocks_cardiologists_2024_01_11.csv";
const CAMPAIGN = args.campaign || "doctors-website-cardiologists-uk";
const DRY_RUN = !!args["dry-run"];
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;

const EXCLUDE_EMAILS = new Set([
  "j.grapsa@rbht.nhs.uk",
  "d.w.s.chong@gmail.com",
  "dwschong@gmail.com",
]);

// --- CSV parser (quote-aware, multi-line safe) ---
function parseCSV(text) {
  const rows = [];
  let cur = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\r") { /* skip */ }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows.shift();
  return {
    headers,
    rows: rows.filter(r => r.some(v => v && v.trim())).map(r => {
      const o = {};
      headers.forEach((h, idx) => { o[h] = (r[idx] || "").trim(); });
      return o;
    }),
  };
}

function pickEmail(row) {
  for (const col of ["Work Email #1", "Work Email #2", "Work Email #3", "Direct Email #1", "Direct Email #2"]) {
    const v = row[col]?.trim().toLowerCase();
    if (v && /.+@.+\..+/.test(v)) return v;
  }
  return null;
}

function classifyDomain(email) {
  if (!email) return "unknown";
  const d = email.split("@")[1] || "";
  if (/\.nhs\.(net|uk)$/.test(d) || /\.nhs\./.test(d)) return "nhs";
  if (/\.ac\.uk$/.test(d)) return "academic";
  if (d === "doctors.org.uk") return "doctors-org-uk";
  return "private-or-personal";
}

// Best-effort postcode pull from "Location" string
function postcodeOf(location) {
  if (!location) return "";
  const m = location.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i);
  return m ? m[1].toUpperCase() : "";
}

// --- read + map ---
console.log(`Reading: ${FILE}`);
const raw = fs.readFileSync(FILE, "utf8");
const { headers, rows } = parseCSV(raw);
console.log(`Parsed: ${rows.length} CSV rows, ${headers.length} columns\n`);

const mapped = rows.map(r => {
  const email = pickEmail(r);
  const altEmails = ["Work Email #1", "Work Email #2", "Work Email #3", "Direct Email #1", "Direct Email #2"]
    .map(k => r[k]?.trim().toLowerCase()).filter(e => e && /.+@.+\..+/.test(e));
  const firstName = (r["First Name"] || "").trim();
  const lastName = (r["Last Name"] || "").trim();
  const fullName = (r["Full Name"] || `${firstName} ${lastName}`).trim();
  return {
    // ONE ROW PER CARDIOLOGIST — name is the person, not the hospital
    // (Hospital lives in business_data.employer + address)
    name: fullName || `Cardiologist ${email || altEmails[0] || Math.random().toString(36).slice(2)}`,
    ownerFirstName: firstName || null,
    ownerLastName: lastName || null,
    ownerEmail: email,
    emailSource: "leadrocks-2024-01",
    emailVerified: false, // stale — Consulti will re-verify
    linkedInUrl: r["Linked Url"] || null,
    // Deliberately NOT setting website at top level — the hospital website is shared across
    // many consultants and would cause checkDuplicate to collide. Stored in business_data instead.
    website: null,
    phone: r["Phone #1"] || r["Company Phone"] || null,
    category: r["Job Title"] || "Consultant Cardiologist",
    // Address combines hospital + location so each row is distinguishable
    address: [r["Company"], r["Location"]].filter(Boolean).join(" — ") || null,
    postcode: postcodeOf(r["Location"]),
    employer: r["Company"] || null,
    employerWebsite: r["Company Website"] || null,
    industry: r["Industry"] || null,
    companyEmail: r["Company Email"] || null,
    teamSize: r["Team Size"] || null,
    revenueRange: r["Revenue Range"] || null,
    altEmails: altEmails.filter(e => e !== email),
    rawLeadRocks: r, // full row preserved in business_data
  };
});

// --- stats ---
const tally = { total: rows.length, withEmail: 0, withLinkedIn: 0, excluded: 0, byDomain: {} };
const cleaned = [];

for (const m of mapped) {
  if (m.ownerEmail && EXCLUDE_EMAILS.has(m.ownerEmail)) {
    tally.excluded++;
    continue;
  }
  if (m.ownerEmail) tally.withEmail++;
  if (m.linkedInUrl) tally.withLinkedIn++;
  const cls = classifyDomain(m.ownerEmail);
  tally.byDomain[cls] = (tally.byDomain[cls] || 0) + 1;
  cleaned.push(m);
}

console.log("=== Import plan ===");
console.log(`Total rows:        ${tally.total}`);
console.log(`Excluded (opt-out/bounce): ${tally.excluded}`);
console.log(`With email:        ${tally.withEmail}`);
console.log(`With LinkedIn URL: ${tally.withLinkedIn}`);
console.log(`To import:         ${cleaned.length}`);
console.log("\nBy email-domain class:");
for (const [k, v] of Object.entries(tally.byDomain).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${v}`);

if (LIMIT) {
  console.log(`\n--limit=${LIMIT} → capping`);
  cleaned.length = Math.min(cleaned.length, LIMIT);
}

console.log("\n--- Sample (first 3) ---");
cleaned.slice(0, 3).forEach(m => console.log(`  ${m.ownerFirstName} ${m.ownerLastName} | ${m.category} @ ${m.name} | email=${m.ownerEmail || "(none)"} | li=${m.linkedInUrl ? "yes" : "no"} | ${m.address}`));

if (DRY_RUN) { console.log("\nDRY RUN — nothing written."); process.exit(0); }

// --- write ---
console.log("\nWriting to DB...");
initDatabase();
let inserted = 0;
for (const m of cleaned) {
  saveBusiness(m, {
    campaigns: [CAMPAIGN],
    location: m.address,
    postcode: m.postcode,
    status: "imported",
    scrapedAt: "2024-01-11T00:00:00.000Z", // LeadRocks export date
    enrichedAt: new Date().toISOString(),
  });
  inserted++;
  if (inserted % 50 === 0) console.log(`  …${inserted}/${cleaned.length}`);
}

console.log(`\n✓ Imported ${inserted} records into campaign \`${CAMPAIGN}\``);
console.log(`Next: once the new Consulti key is in .env, run:`);
console.log(`  node verify-existing-emails-consulti.js --campaign=${CAMPAIGN}`);
