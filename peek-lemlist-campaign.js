#!/usr/bin/env node
/**
 * Peek inside a Lemlist campaign — pull first N leads + campaign meta.
 * Use to identify what audience a campaign was targeted at.
 *
 * Usage: node peek-lemlist-campaign.js <campaignId> [limit]
 */
const { getCredential } = require("./shared/outreach-core/credentials-loader");
const https = require("https");

const apiKey = getCredential("lemlist", "apiKey");
const auth = Buffer.from(":" + apiKey).toString("base64");

const CAMPAIGN_ID = process.argv[2];
const LIMIT = parseInt(process.argv[3] || "10", 10);
if (!CAMPAIGN_ID) { console.error("usage: node peek-lemlist-campaign.js <campaignId> [limit]"); process.exit(1); }

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
        catch { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }); }
      });
    }).on("error", reject);
  });
}

(async () => {
  console.log(`Campaign: ${CAMPAIGN_ID}\n`);

  const meta = await req(`/api/campaigns/${CAMPAIGN_ID}`);
  console.log("--- META ---");
  if (meta.status === 200) {
    const c = meta.body;
    console.log(`Name: ${c.name}`);
    console.log(`Created: ${c.createdAt}`);
    console.log(`Status: ${c.status || (c.paused ? "paused" : "?")}`);
    console.log(`Total leads (if known): ${c.totalLeads ?? c.stats?.totalLeads ?? "?"}`);
  } else {
    console.log(`HTTP ${meta.status}`, meta.body);
  }

  const r = await req(`/api/campaigns/${CAMPAIGN_ID}/leads/?limit=${LIMIT}`);
  console.log("\n--- LEADS ---");
  if (r.status !== 200) { console.log(`HTTP ${r.status}`, r.body); return; }
  const leads = Array.isArray(r.body) ? r.body : (r.body?.leads || []);
  console.log(`Showing ${leads.length} leads:\n`);
  leads.forEach((l, i) => {
    const email = l.email || "?";
    const name = `${l.firstName || ""} ${l.lastName || ""}`.trim() || "?";
    const company = l.companyName || l.company || "?";
    const title = l.jobTitle || l.title || "";
    const linkedin = l.linkedinUrl || l.linkedin || "";
    console.log(`  ${i + 1}. ${name} | ${email} | ${title} @ ${company}`);
    if (linkedin) console.log(`     ${linkedin}`);
  });

  console.log("\n--- SEQUENCES / STEPS ---");
  // Try campaign details with steps
  const seq = await req(`/api/campaigns/${CAMPAIGN_ID}/sequences`);
  if (seq.status === 200) console.log(JSON.stringify(seq.body, null, 2).slice(0, 3000));
  else console.log(`(sequences endpoint: HTTP ${seq.status})`);
})();
