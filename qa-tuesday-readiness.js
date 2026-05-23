#!/usr/bin/env node
/**
 * Tuesday-launch readiness QA. Prints pass/fail for every check in spec §11.
 *
 * Usage: node qa-tuesday-readiness.js
 */
const path = require("path");
const Database = require("better-sqlite3");
const DB_PATH = path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "businesses.db");
const db = new Database(DB_PATH, { readonly: true });

function check(label, ok, detail = "") {
  const icon = ok ? "PASS" : "FAIL";
  console.log(`[${icon}] ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

const checks = [];

// 1. Cardiologists verified + tagged
const cardsTotal = db.prepare("SELECT COUNT(*) n FROM businesses WHERE campaigns LIKE '%cardiologists-nigel-2026%'").get().n;
const cardsClean = db.prepare("SELECT COUNT(*) n FROM businesses WHERE campaigns LIKE '%cardiologists-nigel-2026%' AND consulti_status IN ('good','risky') AND owner_email IS NOT NULL AND owner_email != ''").get().n;
checks.push(check("Cardiologists tagged", cardsTotal >= 200, `${cardsTotal} tagged`));
checks.push(check("Cardiologists clean (good/risky)", cardsClean >= 150, `${cardsClean} ready`));

// 2. Local trades verified + tagged
const tradesTotal = db.prepare("SELECT COUNT(*) n FROM businesses WHERE campaigns LIKE '%local-trades-david-wood-2026%'").get().n;
const tradesClean = db.prepare("SELECT COUNT(*) n FROM businesses WHERE campaigns LIKE '%local-trades-david-wood-2026%' AND consulti_status IN ('good','risky') AND owner_email IS NOT NULL AND owner_email != ''").get().n;
checks.push(check("Local trades tagged", tradesTotal >= 250, `${tradesTotal} tagged`));
checks.push(check("Local trades clean", tradesClean >= 200, `${tradesClean} ready`));

// 3. Cleaning competitors excluded from trades list
const accidentalCleaners = db.prepare("SELECT COUNT(*) n FROM businesses WHERE campaigns LIKE '%local-trades-david-wood-2026%' AND (category LIKE '%cleaner%' OR category LIKE '%gutter%' OR category LIKE '%window%')").get().n;
checks.push(check("No cleaning competitors in trades list", accidentalCleaners === 0, `${accidentalCleaners} found`));

// 4. Tier pricing populated
const tradesUntiered = db.prepare("SELECT COUNT(*) n FROM businesses WHERE campaigns LIKE '%local-trades-david-wood-2026%' AND (assigned_tier IS NULL OR monthly_price IS NULL)").get().n;
checks.push(check("Trades have tier + pricing", tradesUntiered === 0, `${tradesUntiered} missing`));

// 5. Excluded LeadRocks emails NOT in cardiologist export pool
const excluded = db.prepare("SELECT COUNT(*) n FROM businesses WHERE campaigns LIKE '%cardiologists-nigel-2026%' AND owner_email IN ('j.grapsa@rbht.nhs.uk','d.w.s.chong@gmail.com','dwschong@gmail.com')").get().n;
checks.push(check("GDPR opt-outs / hard-bounces excluded", excluded === 0, `${excluded} should be 0`));

// 6. Consulti credit log exists and shows recent burn
const fs = require("fs");
const logPath = path.join(__dirname, "data", "consulti-credit-log.txt");
const logExists = fs.existsSync(logPath);
checks.push(check("Consulti credit log present", logExists, logExists ? "" : "data/consulti-credit-log.txt missing"));

const failed = checks.filter(c => !c).length;
console.log(`\n${failed === 0 ? "READY" : "NOT READY"} — ${checks.length - failed}/${checks.length} passed`);
process.exit(failed === 0 ? 0 : 1);
