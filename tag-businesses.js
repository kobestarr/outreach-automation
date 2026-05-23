#!/usr/bin/env node
/**
 * Add a campaign tag to DB rows matching a SQL WHERE clause.
 *
 * Usage:
 *   node tag-businesses.js --tag=cardiologists-nigel-2026 --where="campaigns LIKE '%doctors-website-cardiologists-uk%'"
 *   node tag-businesses.js --tag=local-trades-david-wood-2026 --where="<filter>" --dry-run
 *
 * Reuses ksd/local-outreach/orchestrator/modules/database.js#addCampaignToBusiness
 * so existing tags are preserved (set merge).
 */
const path = require("path");
const { initDatabase, addCampaignToBusiness, closeDatabase } = require("./ksd/local-outreach/orchestrator/modules/database");

const args = Object.fromEntries(process.argv.slice(2).flatMap(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [[m[1], m[2] ?? true]] : [];
}));

const TAG = args.tag;
const WHERE = args.where;
const DRY = !!args["dry-run"];
if (!TAG || !WHERE) {
  console.error("Usage: --tag=<name> --where=\"<sql filter>\" [--dry-run]");
  process.exit(1);
}

const db = initDatabase();
const rows = db.prepare(`SELECT id, name, postcode, category, campaigns FROM businesses WHERE ${WHERE}`).all();

console.log(`Matched ${rows.length} rows for tag "${TAG}"`);
if (DRY) {
  rows.slice(0, 10).forEach(r => console.log(`  ${r.id} | ${r.name} | ${r.postcode} | ${r.category}`));
  if (rows.length > 10) console.log(`  ... and ${rows.length - 10} more`);
  closeDatabase();
  process.exit(0);
}

let added = 0;
for (const r of rows) {
  const before = JSON.parse(r.campaigns || "[]");
  if (before.includes(TAG)) continue;
  addCampaignToBusiness(r.id, TAG);
  added++;
}
console.log(`Tagged ${added} rows (skipped ${rows.length - added} that already had "${TAG}")`);
closeDatabase();
