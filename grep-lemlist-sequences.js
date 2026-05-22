#!/usr/bin/env node
/**
 * Grep every Lemlist campaign's sequence content for keywords.
 * Catches campaigns referenced inside email body even if campaign name is generic.
 */
const { getCredential } = require("./shared/outreach-core/credentials-loader");
const https = require("https");

const apiKey = getCredential("lemlist", "apiKey");
const auth = Buffer.from(":" + apiKey).toString("base64");

const KEYWORDS = (process.argv.slice(2).length ? process.argv.slice(2) : ["nigel", "stephens", "cardiolog", "doctor", "consultant", "doctify", "harley street", "private practice"]).map(s => s.toLowerCase());
console.log(`Keywords: ${KEYWORDS.join(", ")}\n`);

function req(path) {
  return new Promise((resolve) => {
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
    }).on("error", e => resolve({ status: 0, body: e.message }));
  });
}

function findKeywords(text) {
  const lower = (text || "").toLowerCase();
  return KEYWORDS.filter(k => lower.includes(k));
}

(async () => {
  const list = await req("/api/campaigns?limit=100");
  const campaigns = Array.isArray(list.body) ? list.body : list.body?.campaigns || [];
  console.log(`Scanning ${campaigns.length} campaigns...\n`);

  for (const c of campaigns) {
    const id = c._id || c.id;
    const r = await req(`/api/campaigns/${id}/sequences`);
    if (r.status !== 200) continue;

    // r.body is an object keyed by sequence id
    const seqs = r.body || {};
    const allText = JSON.stringify(seqs);
    const hits = findKeywords(allText);
    if (hits.length > 0) {
      console.log(`★ HIT: ${(c.createdAt || "").slice(0, 10)}  ${c.name || "(unnamed)"}  (${id})`);
      console.log(`  Matched keywords: ${hits.join(", ")}`);
      // Find which steps contain the matches
      for (const [sid, seq] of Object.entries(seqs)) {
        for (const step of seq.steps || []) {
          const stepHits = findKeywords([step.subject, step.message, step.name].join(" "));
          if (stepHits.length) {
            console.log(`  Step ${step.sequenceStep}: subject="${(step.subject || "").slice(0, 80)}"`);
            // Extract small snippet around the match
            const msg = step.message || "";
            for (const kw of stepHits) {
              const idx = msg.toLowerCase().indexOf(kw);
              if (idx >= 0) {
                const snippet = msg.slice(Math.max(0, idx - 80), idx + 200).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
                console.log(`    …${snippet}…`);
              }
            }
          }
        }
      }
      console.log();
    }
  }

  console.log("Done.");
})();
