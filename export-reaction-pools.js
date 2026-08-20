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

// pool-campaign.csv — contacts CURRENTLY in a sending email campaign, pulled
// live from the campaign Google Sheets in config/campaign-sheets.json (every
// entry with a sheetId). Add a campaign there and re-run to include it.
(async () => {
  const sc = require("./shared/outreach-core/sheets/sheets-client.js");
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, "config", "campaign-sheets.json"), "utf8"));
  const seen = new Set();
  const out = [];
  for (const [key, c] of Object.entries(registry)) {
    if (!c.sheetId) continue;
    try {
      const { header, rows } = await sc.readRows(c.sheetId, "ToSend");
      const liKey = header.find((h) => /linkedin/i.test(h));
      if (!liKey) { console.log(`pool-campaign: ${key} has no linkedin column — skipped`); continue; }
      let added = 0;
      for (const r of rows) {
        const u = (r[liKey] || "").trim();
        if (!u.includes("linkedin.com/in/") || seen.has(u)) continue;
        seen.add(u);
        const name = `${r.real_first_name || r["First Name"] || ""} ${r.real_last_name || r["Last Name"] || ""}`.trim();
        out.push({ rowid: out.length + 1, name, u });
        added++;
      }
      console.log(`pool-campaign: ${key} +${added}`);
    } catch (e) { console.log(`pool-campaign: ${key} FAILED (${e.message}) — skipped`); }
  }
  write("pool-campaign.csv", out);
  console.log("Now: scp data/pool-*.csv clawdbot:/root/linkedin-reactions/data/");
})();
