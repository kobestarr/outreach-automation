#!/usr/bin/env node
/**
 * export-reaction-pools.js — snapshot the press + ksd reaction pools from
 * businesses.db into CSVs that daily-reactions-batch.js reads (portable to
 * the VPS where the DB doesn't exist). Re-run + re-upload to refresh pools.
 */
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "businesses.db");
const db = new Database(DB_PATH, { readonly: true });
const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

function write(file, rows) {
  const out = path.join(__dirname, "data", file);
  fs.writeFileSync(out, ["rowid,name,linkedin_url", ...rows.map((r) => [r.rowid, esc(r.name), esc(r.u)].join(","))].join("\n"));
  console.log(`${file}: ${rows.length} rows`);
}

write("pool-press.csv", db.prepare(`SELECT rowid, TRIM(COALESCE(owner_first_name,'') || ' ' || COALESCE(owner_last_name,'')) name, linkedin_url u
  FROM businesses WHERE (campaigns LIKE '%ufh-journalists%' OR campaigns LIKE '%speakers%') AND linkedin_url LIKE '%linkedin.com/in/%'`).all());
write("pool-ksd.csv", db.prepare(`SELECT rowid, TRIM(COALESCE(owner_first_name,'') || ' ' || COALESCE(owner_last_name,'')) name, linkedin_url u
  FROM businesses WHERE campaigns LIKE '%ksd-local-2026%' AND linkedin_url LIKE '%linkedin.com/in/%'`).all());
db.close();
