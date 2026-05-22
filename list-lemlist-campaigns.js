#!/usr/bin/env node
/**
 * List every Lemlist campaign on the account, with stats.
 * Used to find historical campaigns (e.g. doctors / Nigel Stephens).
 */
const { getCredential } = require("./shared/outreach-core/credentials-loader");
const https = require("https");

const apiKey = getCredential("lemlist", "apiKey");
const auth = Buffer.from(":" + apiKey).toString("base64");

function req(path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: "api.lemlist.com",
      path,
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (e) { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }); }
      });
    }).on("error", reject);
  });
}

(async () => {
  // /api/campaigns is the v1 list endpoint
  let all = [];
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const r = await req(`/api/campaigns?limit=100&offset=${offset}`);
    if (r.status !== 200) { console.error(`HTTP ${r.status}`, r.body); break; }
    const batch = Array.isArray(r.body) ? r.body : r.body?.campaigns || [];
    if (!batch.length) break;
    all = all.concat(batch);
    if (batch.length < 100) break;
    offset += 100;
  }

  console.log(`Total campaigns: ${all.length}\n`);
  // Sort by createdAt desc when present
  all.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  // Tabular output
  const HEADER = ["createdAt", "name", "_id", "status", "stats"];
  console.log(HEADER.join(" | "));
  console.log("-".repeat(140));
  for (const c of all) {
    const created = (c.createdAt || "").slice(0, 10);
    const name = (c.name || "(unnamed)").slice(0, 60);
    const id = c._id || c.id || "";
    const status = c.status || c.paused === true ? "paused" : (c.status || "?");
    const stats = c.stats ? `sent=${c.stats.sentCount ?? "?"} replies=${c.stats.repliedCount ?? "?"}` : "";
    console.log([created, name, id, status, stats].join(" | "));
  }

  // Filter for doctor / medical / consultant / Nigel
  console.log("\n--- DOCTOR / NIGEL / MEDICAL MATCHES ---");
  const re = /\b(doctor|medical|consultant|nhs|surgeon|cardiolog|nigel|stephens|harley|private practice|gp\b|clinic|specialist|physician)/i;
  const matches = all.filter(c => re.test(c.name || ""));
  if (!matches.length) console.log("(none matched by name)");
  matches.forEach(c => console.log(`  ${(c.createdAt || "").slice(0, 10)}  ${c.name}  (${c._id || c.id})`));
})();
