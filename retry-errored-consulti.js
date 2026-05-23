#!/usr/bin/env node
/**
 * Retry the 263 emails that errored in the first full Consulti verify pass.
 *
 * Source of truth: data/consulti-verify.jsonl rows where status === "error".
 * For each, calls verifier.verifyEmail() directly and updates DB +
 * appends a fresh JSONL line. The newer line wins on next resume (Map.set
 * overwrites the older error entry in the verifier script's load logic).
 *
 * Throttle: 1.5s between calls (same as main script).
 */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const consulti = require("./shared/outreach-core/email-verification/consulti-verifier");

const DB_PATH = path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "businesses.db");
const JSONL_PATH = path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "consulti-verify.jsonl");
const SLEEP_MS = 1500;

const db = new Database(DB_PATH);

// Find errored emails from JSONL — keep most recent entry per email
const erroredEmails = new Map(); // email → last status seen
const lines = fs.readFileSync(JSONL_PATH, "utf8").split("\n").filter(Boolean);
for (const line of lines) {
  try {
    const r = JSON.parse(line);
    if (r.email) erroredEmails.set(r.email, r.status);
  } catch {}
}

const toRetry = [...erroredEmails.entries()].filter(([_, status]) => status === "error").map(([email]) => email);
console.log(`Found ${toRetry.length} emails with last-known status=error`);

// Map back to biz rows for context (best-effort)
const rowStmt = db.prepare("SELECT id, name, owner_email FROM businesses WHERE LOWER(owner_email) = ? LIMIT 1");
const updateStmt = db.prepare(`UPDATE businesses SET
    consulti_status = @status,
    consulti_deliverable = @deliverable,
    consulti_role = @role,
    consulti_catch_all = @catch_all,
    consulti_verified_at = @verified_at
  WHERE LOWER(owner_email) = @email`);

(async () => {
  const before = await consulti.getCredits();
  console.log(`Credits before: verify=${before.verification_credits}, lead=${before.lead_credits}`);

  const jsonlStream = fs.createWriteStream(JSONL_PATH, { flags: "a" });
  const tally = { good: 0, risky: 0, bad: 0, unknown: 0, error: 0, cached: 0, creditsUsed: 0 };
  const persistentErrors = [];
  const startTs = Date.now();

  for (let i = 0; i < toRetry.length; i++) {
    const email = toRetry[i];
    const row = rowStmt.get(email) || { id: null, name: null, owner_email: email };

    let result;
    try {
      result = await consulti.verifyEmail(email);
    } catch (e) {
      if (e.message.includes("insufficient")) {
        console.error(`\n❌ Out of credits at ${i + 1}/${toRetry.length}: ${e.message}`);
        break;
      }
      result = { email, status: "error", error: e.message, isDeliverable: false, creditsUsed: 0 };
    }

    tally[result.status] = (tally[result.status] || 0) + 1;
    if (result.cached) tally.cached++;
    tally.creditsUsed += result.creditsUsed || 0;
    if (result.status === "error") persistentErrors.push({ email, error: result.error });

    jsonlStream.write(JSON.stringify({
      email,
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
      retry: true,
    }) + "\n");

    updateStmt.run({
      status: result.status,
      deliverable: result.isDeliverable ? 1 : 0,
      role: result.isRoleAccount ? 1 : 0,
      catch_all: result.isCatchAll ? 1 : 0,
      verified_at: result.verifiedAt || new Date().toISOString(),
      email,
    });

    if ((i + 1) % 25 === 0 || i === toRetry.length - 1) {
      const elapsed = Math.round((Date.now() - startTs) / 1000);
      console.log(`  [${i + 1}/${toRetry.length}] ${email} → ${result.status}${result.cached ? " (cached)" : ""}  |  good=${tally.good} risky=${tally.risky} bad=${tally.bad} unknown=${tally.unknown} err=${tally.error}  |  ${elapsed}s, ${tally.creditsUsed} credits`);
    }

    // Early bail if errors are pouring back in (>20% after first 30)
    if (i >= 30 && tally.error / (i + 1) > 0.2) {
      console.error(`\n⚠️  ${tally.error}/${i + 1} retries still erroring (>20%) — bailing to avoid burning credits.`);
      break;
    }

    if (i < toRetry.length - 1) await consulti.sleep(SLEEP_MS);
  }

  jsonlStream.end();

  const after = await consulti.getCredits();
  console.log(`\n=== RETRY DONE ===`);
  console.log(`Retried: ${tally.good + tally.risky + tally.bad + tally.unknown + tally.error}`);
  console.log(`  good:    ${tally.good}`);
  console.log(`  risky:   ${tally.risky}`);
  console.log(`  bad:     ${tally.bad}`);
  console.log(`  unknown: ${tally.unknown}`);
  console.log(`  error:   ${tally.error}`);
  console.log(`  cached:  ${tally.cached}`);
  console.log(`Credits spent: ${tally.creditsUsed}`);
  console.log(`Credits remaining: verify=${after.verification_credits}, lead=${after.lead_credits}`);
  if (persistentErrors.length) {
    console.log(`\nPersistent errors (${persistentErrors.length}):`);
    persistentErrors.slice(0, 5).forEach(e => console.log(`  ${e.email}: ${e.error}`));
  }
})();
