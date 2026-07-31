#!/usr/bin/env node
/**
 * source-doctify-specialists.js — harvest UK private specialists from Doctify
 * listing pages (robots-compliant: listing/profile PAGES only, no /uk/api/*).
 *
 * Doctify listing pages server-render 10 specialists per (keyword × location)
 * into __NEXT_DATA__ (emails included). Server-side pagination doesn't exist
 * (page param ignored; the client paginates via /uk/api/* which robots.txt
 * disallows), so we harvest page-1 of MANY keyword × location combos and
 * dedupe. ~20 cardio keywords × ~15 cities ≈ 300 pages ≈ up to 3,000 records
 * before dedupe.
 *
 * Playbook: docs/doctify-leadgen-playbook.md (4-tier model, nhs exclusion,
 * verification strategy).
 *
 * Usage:
 *   node source-doctify-specialists.js --dry-run                # default cardio set, report only
 *   node source-doctify-specialists.js --keywords cardiology,angina --locations london,leeds --dry-run
 *   node source-doctify-specialists.js                          # live: insert into DB
 *   node source-doctify-specialists.js --verify                 # live + Reoon-verify new rows
 *   node source-doctify-specialists.js --max-pages 40           # cap fetches (testing)
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "businesses.db");
const CAMPAIGN_TAG = "medical-doctify-cardiology";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const THROTTLE_MS = 1600;

// Cardiology + related condition keywords (each keyword × location = a different top-10)
const DEFAULT_KEYWORDS = [
  "cardiology", "angina", "atrial-fibrillation", "arrhythmia-irregular-heartbeat",
  "angioplasty", "aortic-stenosis", "atherosclerosis", "atrial-flutter",
  "bradycardia", "heart-failure", "hypertension-high-blood-pressure",
  "palpitations", "coronary-artery-disease", "echocardiogram",
  "pacemaker-implantation", "heart-valve-disease", "chest-pain",
  "cardiac-ct", "tachycardia", "24-hour-blood-pressure-monitor",
];
const DEFAULT_LOCATIONS = [
  "london", "manchester", "birmingham", "leeds", "liverpool", "bristol",
  "sheffield", "newcastle", "nottingham", "southampton", "oxford",
  "cambridge", "brighton", "reading", "milton-keynes",
];

// Hospital-group / landlord domains → tenant (T3), not the doctor's own site
const HOSPITAL_GROUP_DOMAINS = [
  "hcahealthcare", "spirehealthcare", "nuffieldhealth", "circlehealthgroup",
  "ramsayhealth", "cromwellhospital", "kingedwardvii", "newvictoria",
  "clevelandclinic", "onewelbeck", "thelondonclinic", "hje.org", "gstt",
  "doctify", "topdoctors", "practiceplusgroup", "benendenhospital",
  "harleystreet", "lycahealth", "phoenixhospitalgroup", "schoen-clinic",
];
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.co.uk", "outlook.com",
  "outlook.co.uk", "yahoo.com", "yahoo.co.uk", "aol.com", "icloud.com",
  "me.com", "mac.com", "btinternet.com", "live.com", "live.co.uk",
  "doctors.org.uk", "doctors.net.uk", "msn.com",
]);

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (flag) => { const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : null; };
  return {
    dryRun: a.includes("--dry-run"),
    verify: a.includes("--verify"),
    keywords: get("--keywords")?.split(",") || DEFAULT_KEYWORDS,
    locations: get("--locations")?.split(",") || DEFAULT_LOCATIONS,
    maxPages: parseInt(get("--max-pages") || "0", 10) || Infinity,
    tag: get("--tag") || CAMPAIGN_TAG,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchListing(keyword, location) {
  const url = `https://www.doctify.com/uk/find/${keyword}/${location}/specialists`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9" } });
  if (!res.ok) return { url, error: `HTTP ${res.status}`, specialists: [] };
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!m) return { url, error: "no __NEXT_DATA__", specialists: [] };
  const pp = JSON.parse(m[1]).props.pageProps;
  const specialists = [...(pp.specialists || []), ...(pp.suggestedSpecialists || [])];
  return { url, specialists, total: pp.totalProfiles };
}

const domainOf = (email) => (email.includes("@") ? email.split("@")[1].toLowerCase() : "");
const isNhs = (d) => d === "nhs.net" || d.endsWith(".nhs.uk") || d.endsWith(".scot.nhs.uk") || d.endsWith(".wales.nhs.uk");
const isHospitalGroup = (d) => HOSPITAL_GROUP_DOMAINS.some((h) => d.includes(h));

function pickEmail(emails) {
  const valid = (emails || []).map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (!valid.length) return null;
  // prefer custom-domain (corporate role addresses: best deliverability + PECR footing)
  const custom = valid.find((e) => { const d = domainOf(e); return !FREE_EMAIL_DOMAINS.has(d) && !isNhs(d) && !isHospitalGroup(d); });
  return custom || valid.find((e) => !isNhs(domainOf(e))) || null;
}

function classifyTier(rec) {
  const d = rec.email ? domainOf(rec.email) : "";
  const booking = (rec.bookingLink || "").toLowerCase();
  const surname = (rec.lastName || "").toLowerCase().replace(/[^a-z]/g, "");
  const customEmail = d && !FREE_EMAIL_DOMAINS.has(d) && !isNhs(d) && !isHospitalGroup(d);
  if (customEmail && surname && d.replace(/[^a-z]/g, "").includes(surname)) return 1; // own-name domain
  if (customEmail) return 2; // clinic domain
  if (isHospitalGroup(d) || HOSPITAL_GROUP_DOMAINS.some((h) => booking.includes(h))) return 3; // tenant
  return 4; // free email / no web presence signal
}

const loc = (v) => (v && typeof v === "object" ? v.en || Object.values(v)[0] || "" : v || "");

function normalize(s, keyword, location) {
  const name = loc(s.fullName);
  const gmc = (s.registrationBodies || []).map((r) => r.registrationNumber || r.number || "").filter(Boolean)[0] || "";
  const practice = (s.practices || [])[0] || {};
  return {
    slug: s.slug,
    name,
    title: loc(s.title),
    firstName: loc(s.firstName),
    lastName: loc(s.lastName),
    email: pickEmail(s.emails),
    allEmails: (s.emails || []).join(";"),
    phone: (s.phones || [])[0] || "",
    specialty: loc((s.keywords || [])[0]?.name) || (s.keywords || [])[0]?.slug || keyword,
    keyword, location,
    gmc,
    practiceName: loc(practice.name),
    practiceCity: loc(practice.address?.city),
    bookingLink: s.externalBookingLink || practice.externalBookingLink || "",
    reviewsTotal: s.reviewsTotal || 0,
    rating: s.averageRating || null,
    fees: s.consultationFees ? JSON.stringify(s.consultationFees) : "",
  };
}

async function main() {
  const opts = parseArgs();
  const combos = [];
  for (const k of opts.keywords) for (const l of opts.locations) combos.push([k, l]);
  const capped = combos.slice(0, opts.maxPages === Infinity ? combos.length : opts.maxPages);
  console.log(`Doctify harvest: ${opts.keywords.length} keywords × ${opts.locations.length} locations = ${combos.length} pages (fetching ${capped.length})`);
  console.log(`Mode: ${opts.dryRun ? "DRY-RUN" : "LIVE"} | tag: ${opts.tag}\n`);

  const db = new Database(DB_PATH, { readonly: opts.dryRun });
  const existingEmails = new Set(
    db.prepare("SELECT lower(owner_email) e FROM businesses WHERE owner_email IS NOT NULL AND owner_email != ''").all().map((r) => r.e)
  );
  const existingDoctify = new Set(
    db.prepare("SELECT id FROM businesses WHERE id LIKE 'doctify-%'").all().map((r) => r.id)
  );
  console.log(`DB: ${existingEmails.size} existing emails, ${existingDoctify.size} existing doctify rows\n`);

  const bySlug = new Map();
  let fetched = 0, errors = 0;
  for (const [k, l] of capped) {
    const r = await fetchListing(k, l);
    fetched++;
    if (r.error) { errors++; console.log(`  ✗ ${k}/${l}: ${r.error}`); }
    else {
      let fresh = 0;
      for (const s of r.specialists) {
        if (!s.slug || bySlug.has(s.slug)) continue;
        bySlug.set(s.slug, normalize(s, k, l));
        fresh++;
      }
      if (fetched % 10 === 0 || fresh > 0)
        console.log(`  [${fetched}/${capped.length}] ${k}/${l}: ${r.specialists.length} records, ${fresh} new (pool: ${bySlug.size}, area total: ${r.total})`);
    }
    await sleep(THROTTLE_MS);
  }

  // Filter + classify
  const all = [...bySlug.values()];
  const stats = { noEmail: 0, nhs: 0, dupEmail: 0, dupRow: 0, kept: 0 };
  const kept = [];
  for (const rec of all) {
    if (existingDoctify.has(`doctify-${rec.slug}`)) { stats.dupRow++; continue; }
    if (!rec.email) { stats.noEmail++; continue; }
    if (isNhs(domainOf(rec.email))) { stats.nhs++; continue; }
    if (existingEmails.has(rec.email)) { stats.dupEmail++; continue; }
    rec.tier = classifyTier(rec);
    kept.push(rec);
    stats.kept++;
  }
  const tierCount = kept.reduce((a, r) => ((a[r.tier] = (a[r.tier] || 0) + 1), a), {});
  console.log(`\n=== Harvest summary ===`);
  console.log(`Pages fetched: ${fetched} (${errors} errors) | unique specialists: ${all.length}`);
  console.log(`Dropped: no-email ${stats.noEmail}, nhs ${stats.nhs}, email-already-in-DB ${stats.dupEmail}, row-already-in-DB ${stats.dupRow}`);
  console.log(`Kept (new, sendable candidates): ${stats.kept}`);
  console.log(`Tiers: T1(own-name site)=${tierCount[1] || 0} T2(clinic site)=${tierCount[2] || 0} T3(hospital tenant)=${tierCount[3] || 0} T4(no presence)=${tierCount[4] || 0}`);

  // Always write the harvest CSV (review artifact)
  const outDir = path.join(__dirname, "exports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const csvPath = path.join(outDir, `doctify-harvest-${stamp}.csv`);
  const cols = ["slug", "name", "title", "firstName", "lastName", "email", "allEmails", "phone", "specialty", "keyword", "location", "tier", "gmc", "practiceName", "practiceCity", "bookingLink", "reviewsTotal", "rating"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  fs.writeFileSync(csvPath, [cols.join(","), ...kept.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n"));
  console.log(`\nCSV: ${csvPath}`);

  if (opts.dryRun) { console.log("\nDRY-RUN: no DB writes."); db.close(); return; }

  // Live: backup DB, insert
  const backup = DB_PATH.replace(/\.db$/, `.backup-doctify-${Date.now()}.db`);
  fs.copyFileSync(DB_PATH, backup);
  console.log(`DB backed up: ${backup}`);
  const ins = db.prepare(`INSERT INTO businesses (id, name, location, address, phone, category, rating, review_count,
      owner_first_name, owner_last_name, owner_email, email_source, status, scraped_at, campaigns, business_data, assigned_tier)
    VALUES (@id, @name, @location, @address, @phone, 'private-medical', @rating, @reviews,
      @firstName, @lastName, @email, 'doctify-published', 'scraped', @now, @campaigns, @data, @tier)`);
  const now = new Date().toISOString();
  let inserted = 0;
  const insertMany = db.transaction((rows) => {
    for (const r of rows) {
      ins.run({
        id: `doctify-${r.slug}`,
        name: `${r.title} ${r.name}`.trim() || r.slug,
        location: r.practiceCity || r.location,
        address: r.practiceName,
        phone: r.phone, rating: r.rating, reviews: r.reviewsTotal,
        firstName: r.firstName, lastName: r.lastName, email: r.email,
        now, campaigns: JSON.stringify([opts.tag]),
        data: JSON.stringify({ doctify: r }), tier: r.tier,
      });
      inserted++;
    }
  });
  insertMany(kept);
  console.log(`Inserted: ${inserted} rows tagged ${opts.tag}`);

  if (opts.verify) {
    const { verifyEmail } = require("./shared/outreach-core/email-verification/reoon-verifier");
    const upd = db.prepare("UPDATE businesses SET reoon_status=?, reoon_score=?, reoon_safe_to_send=?, reoon_verified_at=? WHERE id=?");
    let safe = 0, other = 0;
    for (const r of kept) {
      try {
        const v = await verifyEmail(r.email, "power");
        const status = v.status || (v.raw && v.raw.status) || "unknown";
        upd.run(status, v.score ?? null, status === "safe" ? 1 : 0, new Date().toISOString(), `doctify-${r.slug}`);
        status === "safe" ? safe++ : other++;
        if ((safe + other) % 25 === 0) console.log(`  verified ${safe + other}/${kept.length} (safe: ${safe})`);
      } catch (e) {
        console.log(`  ✗ verify stopped at ${safe + other}: ${e.message}`);
        break;
      }
    }
    console.log(`Reoon: ${safe} safe / ${other} not-safe of ${kept.length}`);
  }
  db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
