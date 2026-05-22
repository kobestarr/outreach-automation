#!/usr/bin/env node
/**
 * Surgical cleanup of the failed cardiologist import.
 *
 * The previous import collapsed 357 cardiologists into 104 rows because
 * generateBusinessId() keyed on hospital name + address, so multiple
 * consultants at the same hospital overwrote each other.
 *
 * Strategy:
 *   - For rows tagged ONLY with `doctors-website-cardiologists-uk` → DELETE
 *     (these are new rows from this import, safe to remove)
 *   - For rows that ALSO carry another campaign tag → just remove this tag
 *     (preserve any legitimate prior business record)
 *
 * Always-dry-run unless --yes passed.
 */
const Database = require("better-sqlite3");
const path = require("path");

const args = Object.fromEntries(process.argv.slice(2).flatMap(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [[m[1], m[2] ?? true]] : [];
}));
const TAG = args.tag || "doctors-website-cardiologists-uk";
const BACKUP = args.backup || path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "backups", "businesses-2026-05-17T20-05-04-308Z.db");
const APPLY = !!args.yes;

const db = new Database(path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "businesses.db"));
const bkp = new Database(BACKUP, { readonly: true });

const rows = db.prepare("SELECT id, name, campaigns FROM businesses WHERE campaigns LIKE ?").all(`%"${TAG}"%`);
console.log(`Rows carrying tag '${TAG}': ${rows.length}\n`);

const toDelete = [];
const toUntag = [];

for (const r of rows) {
  let camps = [];
  try { camps = JSON.parse(r.campaigns || "[]"); } catch {}
  if (!camps.includes(TAG)) continue;
  if (camps.length === 1) {
    toDelete.push(r);
  } else {
    toUntag.push({ ...r, newCampaigns: camps.filter(c => c !== TAG) });
  }
}

console.log(`Plan:`);
console.log(`  DELETE (only this tag): ${toDelete.length}`);
console.log(`  UNTAG (keeps other tags): ${toUntag.length}`);
console.log();

if (toUntag.length) {
  console.log(`Sample untags (first 5):`);
  toUntag.slice(0, 5).forEach(r => console.log(`  ${r.id}  name="${r.name}"  remaining=${JSON.stringify(r.newCampaigns)}`));
  console.log();
}

if (!APPLY) {
  console.log("DRY RUN — pass --yes to apply.");
  process.exit(0);
}

// For untag rows, fetch the original from backup so we can restore the polluted columns
const restoreData = [];
for (const r of toUntag) {
  const orig = bkp.prepare("SELECT * FROM businesses WHERE id = ?").get(r.id);
  if (orig) restoreData.push({ id: r.id, orig, newCampaigns: r.newCampaigns });
}
console.log(`Restoring ${restoreData.length} polluted rows from backup data.\n`);

const tx = db.transaction(() => {
  const delStmt = db.prepare("DELETE FROM businesses WHERE id = ?");
  for (const r of toDelete) delStmt.run(r.id);

  // Surgical restore: write back the original columns from backup, keep new campaigns array (minus the bad tag)
  const restoreStmt = db.prepare(`UPDATE businesses SET
      name = ?, location = ?, postcode = ?, address = ?, website = ?, phone = ?, category = ?,
      rating = ?, review_count = ?, owner_first_name = ?, owner_last_name = ?, owner_email = ?,
      email_source = ?, email_verified = ?, linkedin_url = ?, business_data = ?,
      campaigns = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`);
  for (const r of restoreData) {
    const o = r.orig;
    restoreStmt.run(o.name, o.location, o.postcode, o.address, o.website, o.phone, o.category,
      o.rating, o.review_count, o.owner_first_name, o.owner_last_name, o.owner_email,
      o.email_source, o.email_verified, o.linkedin_url, o.business_data,
      JSON.stringify(r.newCampaigns), r.id);
  }
});
tx();

const after = db.prepare("SELECT COUNT(*) AS n FROM businesses").get().n;
const stillTagged = db.prepare("SELECT COUNT(*) AS n FROM businesses WHERE campaigns LIKE ?").get(`%"${TAG}"%`).n;
console.log(`✓ Deleted ${toDelete.length}, untagged ${toUntag.length}`);
console.log(`DB total now: ${after}, still tagged '${TAG}': ${stillTagged}`);
