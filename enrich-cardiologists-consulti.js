#!/usr/bin/env node
/**
 * Consulti enrichment for the 357 cardiologists.
 *
 * Each cardiologist has a real LinkedIn URL from LeadRocks. We use
 * /leads/find-by-linkedin (precise input, no domain-guessing).
 *
 * On match we:
 *   - Save fresh email + status + title + employer + location to business_data.consultiEnrichment
 *   - If Consulti's email is "good" and differs from the stale 2024 email,
 *     promote it to owner_email (the canonical send address)
 *   - Update consulti_* columns for filtering/export
 *
 * Stale emails from Jan 2024 stay in business_data.rawLeadRocks for audit.
 *
 * Flags:
 *   --limit=N      smoke-test cap
 *   --dry-run      print plan only
 *   --campaign=    default doctors-website-cardiologists-uk
 */
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const consulti = require("./shared/outreach-core/email-verification/consulti-verifier");

const args = Object.fromEntries(process.argv.slice(2).flatMap(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [[m[1], m[2] ?? true]] : [];
}));
const CAMPAIGN = args.campaign || "doctors-website-cardiologists-uk";
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;
const DRY_RUN = !!args["dry-run"];
const SLEEP_MS = 1200;

const DB_PATH = path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "businesses.db");
const JSONL_PATH = path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "consulti-cardiologists-enrich.jsonl");

const db = new Database(DB_PATH);

// Build queue. Resume support: skip rows that already carry an LI-lookup result
// in business_data.consultiEnrichment. (We can't use consulti_verified_at as the
// resume signal because the plain email verifier (verify-existing-emails-consulti.js)
// also writes that column — using it here would make the LI-lookup script skip every
// row that's ever been email-verified.)
let queue = db.prepare(`
  SELECT id, name, owner_first_name AS first_name, owner_last_name AS last_name,
         owner_email AS stale_email, linkedin_url, business_data
  FROM businesses
  WHERE campaigns LIKE ?
    AND linkedin_url IS NOT NULL AND linkedin_url != ''
`).all(`%"${CAMPAIGN}"%`);

function hasLiLookupResult(row) {
  if (!row.business_data) return false;
  try { return !!JSON.parse(row.business_data).consultiEnrichment; }
  catch { return false; }
}

const totalRows = queue.length;
const alreadyDone = queue.filter(hasLiLookupResult).length;
queue = queue.filter(r => !hasLiLookupResult(r));
if (LIMIT) queue = queue.slice(0, LIMIT);

console.log(`Cardiologists in campaign with LinkedIn URL: ${totalRows}`);
console.log(`Already enriched (resume skip):              ${alreadyDone}`);
console.log(`Queue:                                       ${queue.length}`);
console.log(`Throttle: ${SLEEP_MS}ms → ~${Math.round(queue.length * (SLEEP_MS + 800) / 60000)} min wall-clock`);

if (DRY_RUN) {
  console.log("\nDRY RUN — first 10:");
  queue.slice(0, 10).forEach(r => console.log(`  ${r.first_name} ${r.last_name} | stale=${r.stale_email} | li=${r.linkedin_url}`));
  process.exit(0);
}
if (queue.length === 0) { console.log("Nothing to do."); process.exit(0); }

(async () => {
  const credits = await consulti.getCredits();
  console.log(`\nConsulti credits before: verify=${credits.verification_credits}, lead=${credits.lead_credits}`);
  if (credits.lead_credits < queue.length) {
    console.warn(`⚠️  Lead credits (${credits.lead_credits}) less than queue (${queue.length}). Capping.`);
    queue = queue.slice(0, credits.lead_credits);
  }

  const updateStmt = db.prepare(`UPDATE businesses SET
      owner_email = @final_email,
      email_source = @email_source,
      linkedin_url = COALESCE(@linkedin, linkedin_url),
      consulti_status = @status,
      consulti_deliverable = @deliverable,
      consulti_verified_at = @verified_at,
      business_data = @business_data,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = @id`);

  const jsonl = fs.createWriteStream(JSONL_PATH, { flags: "a" });
  const tally = { matched: 0, missed: 0, error: 0, emailRefreshed: 0, emailConfirmed: 0, creditsSpent: 0 };
  const start = Date.now();

  for (let i = 0; i < queue.length; i++) {
    const r = queue[i];
    let res;
    try {
      res = await consulti.findByLinkedin(r.linkedin_url);
    } catch (e) {
      if (e.message.includes("insufficient")) { console.error(`\nOut of credits at ${i + 1}/${queue.length}`); break; }
      res = { matched: false, error: e.message, creditsUsed: 0 };
    }

    let merged = {};
    try { merged = JSON.parse(r.business_data || "{}"); } catch {}

    let finalEmail = r.stale_email;
    let emailSource = "leadrocks-2024-01";
    let newEmail = null, status = null, deliverable = 0;

    if (res.matched) {
      tally.matched++;
      const d = res.data;
      newEmail = d.email || null;
      status = d.email_status || null;
      deliverable = status === "good" ? 1 : 0;

      // If Consulti returned a "good" email, promote it to canonical
      if (newEmail && status === "good") {
        if (newEmail.toLowerCase() !== (r.stale_email || "").toLowerCase()) {
          finalEmail = newEmail;
          emailSource = "consulti-leads";
          tally.emailRefreshed++;
        } else {
          tally.emailConfirmed++;
        }
      }

      merged.consultiEnrichment = d;
      merged.consultiEnrichedAt = new Date().toISOString();
    } else if (res.error) {
      tally.error++;
    } else {
      tally.missed++;
    }
    tally.creditsSpent += res.creditsUsed || 0;

    jsonl.write(JSON.stringify({
      id: r.id, name: r.name, linkedin_url: r.linkedin_url,
      matched: !!res.matched,
      consulti_email: newEmail, email_status: status,
      stale_email: r.stale_email,
      promoted: finalEmail !== r.stale_email,
      title: res.data?.job_title || null,
      company: res.data?.company_name || null,
      city: res.data?.city || null,
      creditsUsed: res.creditsUsed,
      error: res.error || null,
      ts: new Date().toISOString(),
    }) + "\n");

    updateStmt.run({
      id: r.id,
      final_email: finalEmail,
      email_source: emailSource,
      linkedin: res.matched ? (res.data?.linkedin_url || null) : null,
      status,
      deliverable,
      verified_at: new Date().toISOString(),
      business_data: JSON.stringify(merged),
    });

    if ((i + 1) % 20 === 0 || i === queue.length - 1) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      const mark = res.matched ? "✓" : (res.error ? "×" : "·");
      console.log(`  [${i + 1}/${queue.length}] ${mark} ${r.first_name} ${r.last_name}${res.matched ? ` → ${newEmail} (${status})` : ""}  |  matched=${tally.matched} refresh=${tally.emailRefreshed} confirm=${tally.emailConfirmed} miss=${tally.missed} err=${tally.error}  |  ${tally.creditsSpent} cr, ${elapsed}s`);
    }
    if (i < queue.length - 1) await consulti.sleep(SLEEP_MS);
  }
  jsonl.end();

  const after = await consulti.getCredits();
  console.log(`\n=== DONE ===`);
  console.log(`Matched:          ${tally.matched}  (${Math.round(tally.matched/queue.length*100)}% hit rate)`);
  console.log(`  emails refreshed (changed): ${tally.emailRefreshed}`);
  console.log(`  emails confirmed (same):    ${tally.emailConfirmed}`);
  console.log(`Missed:           ${tally.missed}`);
  console.log(`Errors:           ${tally.error}`);
  console.log(`Credits spent:    ${tally.creditsSpent}`);
  console.log(`Credits remaining: verify=${after.verification_credits}, lead=${after.lead_credits}`);
  console.log(`JSONL: ${JSONL_PATH}`);
})();
