#!/usr/bin/env node
/**
 * Find emails for the 9 TPS targets (Chris's 6 non-green + 3 new brand-side adds).
 *
 * Strategy per speaker:
 *   1. /leads/find-by-name with primary domain — free on miss, 1 credit on hit
 *   2. If miss: try fallback domains in order
 *   3. If still miss: /leads/search with name + company — 1 credit per result returned
 *
 * Output:
 *   exports/tps-2026-target-emails.json
 *   exports/tps-2026-target-emails.md (table for paste-back)
 */
const fs = require("fs");
const path = require("path");
const c = require("./shared/outreach-core/email-verification/consulti-verifier");

const TARGETS = [
  { first: "Brittany", last: "Clevenger", company: "BetterHelp",
    domains: ["betterhelp.com", "teladochealth.com"] },
  { first: "Alex",    last: "McClure",   company: "Expedia",
    domains: ["expediagroup.com", "expedia.com"] },
  { first: "Chloe",   last: "Yates",     company: "Sport Social Podcast Network",
    domains: ["sportsocialnetwork.com", "sportsocialpodcasts.com", "sportsocial.com"] },
  { first: "Dan",     last: "Rookwood",  company: "VGC Partners",
    domains: ["vgcpartners.com"] },
  { first: "Daniel",  last: "Chandley",  company: "Entain",
    domains: ["entain.com", "coral.co.uk", "ladbrokescoral.com"] },
  { first: "Ed",      last: "Fuller",    company: "Media Bodies",
    domains: ["mediabodies.com", "mediabodies.co.uk"] },
  { first: "Jake",    last: "Storer",    company: "Nord Security",
    domains: ["nordsecurity.com", "nordvpn.com"] },
  { first: "Nicola",  last: "Ager",      company: "TV Licensing",
    domains: ["tvlicensing.co.uk", "capita.co.uk"] }, // TV Licensing is operated by Capita
  { first: "Margot",  last: "Baume",     company: "Louis Vuitton",
    domains: ["louisvuitton.com", "lvmh.com"] },
];

// Consulti search wrapper (uses the undocumented endpoint we mapped)
async function searchLeads(body) {
  const r = await fetch("https://www.consulti.ai/api/v1/leads/search", {
    method: "POST",
    headers: { Authorization: "Bearer " + c.getKey(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

(async () => {
  const before = await c.getCredits();
  console.log(`Consulti credits before: verify=${before.verification_credits}, lead=${before.lead_credits}\n`);

  const results = [];

  for (const t of TARGETS) {
    console.log(`--- ${t.first} ${t.last} @ ${t.company} ---`);
    let matched = null;
    let matchedDomain = null;
    let attempts = [];

    // 1) find-by-name on each candidate domain (free on miss)
    for (const dom of t.domains) {
      const r = await c.findByName({ first_name: t.first, last_name: t.last, domain: dom });
      attempts.push({ method: "find-by-name", domain: dom, matched: !!r.matched, error: r.error || null, creditsUsed: r.creditsUsed });
      console.log(`  find-by-name @ ${dom} → ${r.matched ? "✓ MATCH" : "miss"}${r.error ? " (err: " + r.error + ")" : ""}`);
      if (r.matched) { matched = r.data; matchedDomain = dom; break; }
      await c.sleep(800);
    }

    // 2) fallback to /leads/search with company name (uses 1 credit per result, request size:1)
    if (!matched) {
      const sr = await searchLeads({ q: `${t.first} ${t.last}`, company: t.company, size: 1 });
      attempts.push({ method: "search", company: t.company, status: sr.status, body: sr.body });
      const found = sr.body?.leads?.[0];
      if (sr.status === 200 && found) {
        // Confirm name match before accepting (search can return partial matches)
        const nameMatches = (found.first_name || "").toLowerCase() === t.first.toLowerCase()
          && (found.last_name || "").toLowerCase().startsWith(t.last.toLowerCase());
        console.log(`  search → ${nameMatches ? "✓ MATCH" : "fuzzy result (rejected)"}: ${found.first_name} ${found.last_name} | ${found.email} | ${found.email_status}`);
        if (nameMatches) { matched = found; matchedDomain = found.company_domain; }
      } else {
        console.log(`  search → no result (HTTP ${sr.status})`);
      }
      await c.sleep(800);
    }

    results.push({ ...t, matched: !!matched, data: matched, matchedDomain, attempts });
    console.log("");
  }

  const after = await c.getCredits();
  console.log(`Consulti credits after: verify=${after.verification_credits}, lead=${after.lead_credits}`);
  console.log(`Spent: ${before.lead_credits - after.lead_credits} lead credits\n`);

  // --- Save raw JSON ---
  const outJson = path.join(__dirname, "exports", "tps-2026-target-emails.json");
  fs.writeFileSync(outJson, JSON.stringify(results, null, 2));

  // --- Markdown table ---
  const md = ["# TPS 2026 — Target Email Lookups (Consulti)\n",
    "| Speaker | Company | Email | Status | LinkedIn | Title (Consulti) | Notes |",
    "|---|---|---|---|---|---|---|"];
  for (const r of results) {
    const d = r.data || {};
    md.push(`| ${r.first} ${r.last} | ${r.company} | ${d.email || "**(not found)**"} | ${d.email_status || "-"} | ${d.linkedin_url || "-"} | ${d.job_title || "-"} | ${r.matched ? "via " + (r.matchedDomain || "search") : "—"} |`);
  }
  const outMd = path.join(__dirname, "exports", "tps-2026-target-emails.md");
  fs.writeFileSync(outMd, md.join("\n") + "\n");

  console.log(`✓ JSON: ${outJson}`);
  console.log(`✓ Markdown: ${outMd}`);
  console.log("\n=== SUMMARY ===");
  let hits = 0, misses = 0;
  for (const r of results) {
    if (r.matched) {
      hits++;
      console.log(`  ✓ ${r.first} ${r.last} → ${r.data.email} (${r.data.email_status})`);
    } else {
      misses++;
      console.log(`  · ${r.first} ${r.last} → NOT FOUND`);
    }
  }
  console.log(`\nHits: ${hits}/${results.length}, misses: ${misses}`);
})();
