#!/usr/bin/env node
/**
 * Verify every owner_email in the DB through Reoon.
 * Drop-in replacement for the Consulti-blocked verifier.
 *
 * Reoon: 2,100/day soft cap, 350K lifetime pool. Throws after daily limit.
 *
 * Persistence:
 *   - JSONL log at data/reoon-verify.jsonl (crash-safe, used for resume)
 *   - DB columns added: reoon_status, reoon_score, reoon_deliverable,
 *     reoon_safe_to_send, reoon_verified_at
 *
 * Flags:
 *   --campaign=<substring>    Filter by campaign name (LIKE match)
 *   --limit=N                 Cap queue (smoke test)
 *   --dry-run                 No API calls, print plan only
 *   --force-recheck           Ignore prior results, re-verify everything
 *   --throttle-ms=N           Per-call delay (default 250ms — Reoon is fast)
 *   --mode=quick|power        Reoon mode (default power)
 */
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { verifyEmail, checkAvailability } = require("./shared/outreach-core/email-verification/reoon-verifier");

const DB_PATH = path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "businesses.db");
const JSONL_PATH = path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "reoon-verify.jsonl");

const args = Object.fromEntries(process.argv.slice(2).flatMap(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [[m[1], m[2] ?? true]] : [];
}));
const FILTER_CAMPAIGN = args.campaign || null;
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;
const DRY_RUN = !!args["dry-run"];
const FORCE = !!args["force-recheck"];
const SLEEP_MS = args["throttle-ms"] ? parseInt(args["throttle-ms"], 10) : 250;
const MODE = args.mode || "power";

const sleep = ms => new Promise(r => setTimeout(r, ms));

const db = new Database(DB_PATH);
function ensureSchema() {
  const cols = db.prepare("PRAGMA table_info(businesses)").all().map(c => c.name);
  const adds = [];
  if (!cols.includes("reoon_status")) adds.push("ALTER TABLE businesses ADD COLUMN reoon_status TEXT");
  if (!cols.includes("reoon_score")) adds.push("ALTER TABLE businesses ADD COLUMN reoon_score INTEGER");
  if (!cols.includes("reoon_deliverable")) adds.push("ALTER TABLE businesses ADD COLUMN reoon_deliverable INTEGER");
  if (!cols.includes("reoon_safe_to_send")) adds.push("ALTER TABLE businesses ADD COLUMN reoon_safe_to_send INTEGER");
  if (!cols.includes("reoon_verified_at")) adds.push("ALTER TABLE businesses ADD COLUMN reoon_verified_at TEXT");
  for (const sql of adds) { db.exec(sql); console.log(`  schema: ${sql}`); }
}
ensureSchema();

// Resume: skip emails already in JSONL
const done = new Map();
if (!FORCE && fs.existsSync(JSONL_PATH)) {
  for (const line of fs.readFileSync(JSONL_PATH, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.email) done.set(r.email, r.status); } catch {}
  }
  console.log(`Resume: ${done.size} emails already verified in JSONL`);
}

// Build queue
let sql = "SELECT id, name, owner_email FROM businesses WHERE owner_email IS NOT NULL AND owner_email != ''";
const params = {};
if (FILTER_CAMPAIGN) { sql += " AND campaigns LIKE @camp"; params.camp = `%${FILTER_CAMPAIGN}%`; }
sql += " ORDER BY id";
const allRows = db.prepare(sql).all(params);

const seen = new Map();
for (const r of allRows) {
  const e = (r.owner_email || "").toLowerCase().trim();
  if (!e || !/.+@.+\..+/.test(e)) continue;
  if (!seen.has(e)) seen.set(e, { ...r, owner_email: e });
}

let queue = [...seen.values()].filter(r => FORCE || !done.has(r.owner_email));
if (LIMIT) queue = queue.slice(0, LIMIT);

console.log(`\nPlanned: ${queue.length} emails to verify (${seen.size} unique total, ${done.size} already done${FORCE ? ", FORCE on" : ""})`);
if (FILTER_CAMPAIGN) console.log(`Campaign filter: ${FILTER_CAMPAIGN}`);
console.log(`Throttle: ${SLEEP_MS}ms → ~${Math.round(queue.length * SLEEP_MS / 60000)} min wall-clock`);
console.log(`Mode: ${MODE}`);

const avail = checkAvailability();
console.log(`Reoon daily remaining: ${avail.remaining}/${avail.limit ?? 2100}`);
if (queue.length > avail.remaining) {
  console.warn(`⚠️  Queue (${queue.length}) exceeds today's Reoon remaining (${avail.remaining}). Capping queue.`);
  queue = queue.slice(0, avail.remaining);
}

if (DRY_RUN) {
  console.log("\nDRY RUN — first 10 in queue:");
  queue.slice(0, 10).forEach(r => console.log(`  ${r.owner_email}  (${r.name})`));
  process.exit(0);
}

if (queue.length === 0) { console.log("Nothing to do."); process.exit(0); }

(async () => {
  const updateStmt = db.prepare(`UPDATE businesses SET
      reoon_status = @status,
      reoon_score = @score,
      reoon_deliverable = @deliverable,
      reoon_safe_to_send = @safe,
      reoon_verified_at = @verified_at,
      email_verified = CASE WHEN @safe = 1 THEN 1 ELSE email_verified END
    WHERE LOWER(owner_email) = @email`);

  const jsonlStream = fs.createWriteStream(JSONL_PATH, { flags: "a" });
  const tally = { total: 0, safe: 0, valid: 0, invalid: 0, disabled: 0, disposable: 0, other: 0, error: 0 };
  const startTs = Date.now();

  for (let i = 0; i < queue.length; i++) {
    const row = queue[i];
    let result;
    try {
      result = await verifyEmail(row.owner_email, MODE);
    } catch (e) {
      if (e.message.toLowerCase().includes("limit")) {
        console.error(`\n❌ Reoon daily limit hit at ${i + 1}/${queue.length}: ${e.message}`);
        break;
      }
      result = { email: row.owner_email, isValid: false, status: "error", error: e.message, isDeliverable: false, isSafeToSend: false, verifiedAt: new Date().toISOString() };
    }

    const status = (result.status || "error").toLowerCase();
    tally[status] = (tally[status] || 0) + 1;
    tally.total++;

    jsonlStream.write(JSON.stringify({
      email: row.owner_email,
      biz_id: row.id,
      biz_name: row.name,
      status: result.status,
      score: result.score ?? null,
      isDeliverable: !!result.isDeliverable,
      isSafeToSend: !!result.isSafeToSend,
      reason: result.reason || null,
      error: result.error || null,
      verifiedAt: result.verifiedAt || new Date().toISOString(),
    }) + "\n");

    updateStmt.run({
      status: result.status || null,
      score: typeof result.score === "number" ? result.score : null,
      deliverable: result.isDeliverable ? 1 : 0,
      safe: result.isSafeToSend ? 1 : 0,
      verified_at: result.verifiedAt || new Date().toISOString(),
      email: row.owner_email,
    });

    if ((i + 1) % 25 === 0 || i === queue.length - 1) {
      const elapsed = Math.round((Date.now() - startTs) / 1000);
      const summary = Object.entries(tally).filter(([k, v]) => k !== "total" && v > 0).map(([k, v]) => `${k}=${v}`).join(" ");
      console.log(`  [${i + 1}/${queue.length}] ${row.owner_email} → ${result.status}  |  ${summary}  |  ${elapsed}s`);
    }

    if (i < queue.length - 1) await sleep(SLEEP_MS);
  }

  jsonlStream.end();

  const remaining = checkAvailability();
  console.log(`\n=== DONE ===`);
  console.log(`Verified: ${tally.total}`);
  for (const [k, v] of Object.entries(tally)) if (k !== "total" && v > 0) console.log(`  ${k.padEnd(12)} ${v}`);
  console.log(`Reoon remaining today: ${remaining.remaining}`);
  console.log(`JSONL: ${JSONL_PATH}`);
})();
