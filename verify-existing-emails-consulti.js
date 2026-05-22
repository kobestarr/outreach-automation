#!/usr/bin/env node
/**
 * Verify all existing emails in the DB via Consulti.
 *
 * - Reads businesses.owner_email
 * - Skips already-Consulti-verified (resume support via JSONL + DB columns)
 * - Saves each result to data/consulti-verify.jsonl (crash-safe)
 * - Updates DB columns: consulti_status, consulti_role, consulti_catch_all,
 *                       consulti_deliverable, consulti_verified_at
 * - Throttles 1.5s between calls (no documented rate limit, but ~1 req/sec is safe)
 *
 * Flags:
 *   --campaign=ksd-bramhall-SK7    (filter by campaign substring)
 *   --limit=200                    (cap, e.g. for smoke test)
 *   --dry-run                      (no API calls, just print plan)
 *   --resume                       (skip emails already in JSONL — default true)
 *   --force-recheck                (ignore prior results, re-verify everything)
 */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const consulti = require("./shared/outreach-core/email-verification/consulti-verifier");

const DB_PATH = path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "businesses.db");
const JSONL_PATH = path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "consulti-verify.jsonl");

// --- args ---
const args = Object.fromEntries(process.argv.slice(2).flatMap(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [[m[1], m[2] ?? true]] : [];
}));
const FILTER_CAMPAIGN = args.campaign || null;
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;
const DRY_RUN = !!args["dry-run"];
const FORCE = !!args["force-recheck"];
const SLEEP_MS = 1500;

// --- DB setup ---
const db = new Database(DB_PATH);

function ensureSchema() {
  const cols = db.prepare("PRAGMA table_info(businesses)").all().map(c => c.name);
  const adds = [];
  if (!cols.includes("consulti_status")) adds.push("ALTER TABLE businesses ADD COLUMN consulti_status TEXT");
  if (!cols.includes("consulti_deliverable")) adds.push("ALTER TABLE businesses ADD COLUMN consulti_deliverable INTEGER");
  if (!cols.includes("consulti_role")) adds.push("ALTER TABLE businesses ADD COLUMN consulti_role INTEGER");
  if (!cols.includes("consulti_catch_all")) adds.push("ALTER TABLE businesses ADD COLUMN consulti_catch_all INTEGER");
  if (!cols.includes("consulti_verified_at")) adds.push("ALTER TABLE businesses ADD COLUMN consulti_verified_at TEXT");
  for (const sql of adds) { db.exec(sql); console.log(`  schema: ${sql}`); }
}
ensureSchema();

// --- load already-done emails (resume) ---
const done = new Map(); // email → last status
if (!FORCE && fs.existsSync(JSONL_PATH)) {
  const lines = fs.readFileSync(JSONL_PATH, "utf8").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.email) done.set(r.email, r.status);
    } catch {}
  }
  console.log(`Resume: ${done.size} emails already verified in JSONL`);
}

// --- pick rows to verify ---
let sql = "SELECT id, name, owner_email, campaigns FROM businesses WHERE owner_email IS NOT NULL AND owner_email != ''";
const params = {};
if (FILTER_CAMPAIGN) {
  sql += " AND campaigns LIKE @camp";
  params.camp = `%${FILTER_CAMPAIGN}%`;
}
sql += " ORDER BY id";
const allRows = db.prepare(sql).all(params);

// Dedupe by lowercased email; pick the first row per email
const seen = new Map(); // email → row
for (const r of allRows) {
  const e = (r.owner_email || "").toLowerCase().trim();
  if (!e || !/.+@.+\..+/.test(e)) continue;
  if (!seen.has(e)) seen.set(e, { ...r, owner_email: e });
}

let queue = [...seen.values()].filter(r => FORCE || !done.has(r.owner_email));
if (LIMIT) queue = queue.slice(0, LIMIT);

console.log(`\nPlanned: ${queue.length} emails to verify (${seen.size} unique total, ${done.size} already done${FORCE ? ", FORCE on" : ""})`);
if (FILTER_CAMPAIGN) console.log(`Campaign filter: ${FILTER_CAMPAIGN}`);
console.log(`Throttle: ${SLEEP_MS}ms between calls → ~${Math.round(queue.length * SLEEP_MS / 60000)} min wall-clock`);

if (DRY_RUN) {
  console.log("\nDRY RUN — first 10 in queue:");
  queue.slice(0, 10).forEach(r => console.log(`  ${r.owner_email}  (${r.name})`));
  process.exit(0);
}

if (queue.length === 0) { console.log("Nothing to do."); process.exit(0); }

// --- credit check ---
(async () => {
  const credits = await consulti.getCredits();
  console.log(`\nConsulti credits before: verify=${credits.verification_credits}, lead=${credits.lead_credits}`);
  if (credits.verification_credits < queue.length) {
    console.warn(`⚠️  Verify credits (${credits.verification_credits}) less than queue (${queue.length}). Capping queue.`);
    queue = queue.slice(0, credits.verification_credits);
  }

  // --- run ---
  const updateStmt = db.prepare(`UPDATE businesses SET
      consulti_status = @status,
      consulti_deliverable = @deliverable,
      consulti_role = @role,
      consulti_catch_all = @catch_all,
      consulti_verified_at = @verified_at
    WHERE LOWER(owner_email) = @email`);

  const jsonlStream = fs.createWriteStream(JSONL_PATH, { flags: "a" });
  const tally = { good: 0, risky: 0, bad: 0, unknown: 0, error: 0, cached: 0, creditsUsed: 0 };
  const startTs = Date.now();

  for (let i = 0; i < queue.length; i++) {
    const row = queue[i];
    let result;
    try {
      result = await consulti.verifyEmail(row.owner_email);
    } catch (e) {
      if (e.message.includes("insufficient")) {
        console.error(`\n❌ Out of credits at ${i + 1}/${queue.length}: ${e.message}`);
        break;
      }
      result = { email: row.owner_email, status: "error", error: e.message, isDeliverable: false, creditsUsed: 0 };
    }

    tally[result.status] = (tally[result.status] || 0) + 1;
    if (result.cached) tally.cached++;
    tally.creditsUsed += result.creditsUsed || 0;

    // Persist JSONL line FIRST (crash-safe)
    jsonlStream.write(JSON.stringify({
      email: row.owner_email,
      biz_id: row.id,
      biz_name: row.name,
      status: result.status,
      isDeliverable: result.isDeliverable,
      isRoleAccount: result.isRoleAccount,
      isCatchAll: result.isCatchAll,
      isDisposable: result.isDisposable,
      cached: result.cached,
      creditsUsed: result.creditsUsed,
      error: result.error,
      verifiedAt: result.verifiedAt || new Date().toISOString(),
    }) + "\n");

    // Then DB
    updateStmt.run({
      status: result.status,
      deliverable: result.isDeliverable ? 1 : 0,
      role: result.isRoleAccount ? 1 : 0,
      catch_all: result.isCatchAll ? 1 : 0,
      verified_at: result.verifiedAt || new Date().toISOString(),
      email: row.owner_email,
    });

    if ((i + 1) % 25 === 0 || i === queue.length - 1) {
      const elapsed = Math.round((Date.now() - startTs) / 1000);
      console.log(`  [${i + 1}/${queue.length}] ${row.owner_email} → ${result.status}${result.cached ? " (cached)" : ""}  |  tally good=${tally.good} risky=${tally.risky} bad=${tally.bad} unknown=${tally.unknown} err=${tally.error}  |  ${elapsed}s elapsed, ${tally.creditsUsed} credits spent`);
    }

    if (i < queue.length - 1) await consulti.sleep(SLEEP_MS);
  }

  jsonlStream.end();

  const after = await consulti.getCredits();
  console.log(`\n=== DONE ===`);
  console.log(`Verified: ${tally.good + tally.risky + tally.bad + tally.unknown + tally.error}`);
  console.log(`  good:    ${tally.good}`);
  console.log(`  risky:   ${tally.risky}`);
  console.log(`  bad:     ${tally.bad}`);
  console.log(`  unknown: ${tally.unknown}`);
  console.log(`  error:   ${tally.error}`);
  console.log(`  cached:  ${tally.cached}`);
  console.log(`Credits spent (verify): ${tally.creditsUsed}`);
  console.log(`Credits remaining: verify=${after.verification_credits}, lead=${after.lead_credits}`);
  console.log(`JSONL: ${JSONL_PATH}`);
})();
