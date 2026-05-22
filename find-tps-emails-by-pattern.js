#!/usr/bin/env node
/**
 * Pattern-guess + Consulti /verify for the 8 TPS speakers Consulti doesn't have in its lead DB.
 *
 * Strategy: for each speaker, try common email patterns against known corporate
 * domains. Stop at first "good" status. ~10 candidates per speaker = ~80 verify
 * credits worst case (we have 24K).
 */
const fs = require("fs");
const path = require("path");
const c = require("./shared/outreach-core/email-verification/consulti-verifier");

const TARGETS = [
  { name: "Alex McClure",      first: "Alex",     last: "McClure",   company: "Expedia",
    domains: ["expediagroup.com", "expedia.com"] },
  { name: "Chloe Yates",       first: "Chloe",    last: "Yates",     company: "Sport Social Podcast Network",
    domains: ["sportsocial.com", "sportsocialpodcastnetwork.com", "sportsocialpodcasts.com"] },
  { name: "Dan Rookwood",      first: "Dan",      last: "Rookwood",  company: "VGC Partners",
    // Dan Rookwood was famously editor of Mr Porter / GQ. VGC Partners is consumer-brand investor.
    domains: ["vgcpartners.com", "vgc-partners.com"] },
  { name: "Daniel Chandley",   first: "Daniel",   last: "Chandley",  company: "Entain (Coral)",
    domains: ["entain.com", "coral.co.uk", "ladbrokescoral.com"] },
  { name: "Ed Fuller",         first: "Ed",       last: "Fuller",    company: "Media Bodies",
    domains: ["mediabodies.com", "mediabodies.co.uk"] },
  { name: "Jake Storer",       first: "Jake",     last: "Storer",    company: "Nord Security",
    domains: ["nordsec.com", "nordsecurity.com", "nordvpn.com"] },
  { name: "Nicola Ager",       first: "Nicola",   last: "Ager",      company: "TV Licensing",
    domains: ["capita.com", "capita.co.uk", "tvlicensing.co.uk"] },
  { name: "Margot Baume",      first: "Margot",   last: "Baume",     company: "Louis Vuitton",
    domains: ["louisvuitton.com", "lvmh.fr", "lvmh.com"] },
];

function candidates(first, last, domain) {
  const f = first.toLowerCase();
  const l = last.toLowerCase();
  const fi = f[0];
  const li = l[0];
  return [
    `${f}.${l}@${domain}`,           // firstname.lastname (most common)
    `${f}@${domain}`,                // firstname (founder/exec)
    `${fi}${l}@${domain}`,           // flastname
    `${f}${l}@${domain}`,            // firstnamelastname
    `${f}_${l}@${domain}`,           // firstname_lastname
    `${l}.${f}@${domain}`,           // lastname.firstname
    `${f}-${l}@${domain}`,           // firstname-lastname
    `${l}@${domain}`,                // lastname only (rare)
  ];
}

(async () => {
  const before = await c.getCredits();
  console.log(`Consulti before: verify=${before.verification_credits}, lead=${before.lead_credits}\n`);

  const results = [];
  let spent = 0;

  for (const t of TARGETS) {
    console.log(`--- ${t.name} @ ${t.company} ---`);
    let winner = null;
    const attempts = [];

    outer: for (const dom of t.domains) {
      for (const candidate of candidates(t.first, t.last, dom)) {
        let r;
        try {
          r = await c.verifyEmail(candidate);
        } catch (e) {
          console.log(`  ${candidate.padEnd(45)} → error: ${e.message}`);
          continue;
        }
        spent += r.creditsUsed || 0;
        const tag = r.status === "good" ? "✓ GOOD" : r.status;
        attempts.push({ email: candidate, status: r.status, role: r.isRoleAccount, catch_all: r.isCatchAll });
        console.log(`  ${candidate.padEnd(45)} → ${tag}${r.isRoleAccount ? " (role)" : ""}${r.isCatchAll ? " (catch-all)" : ""}`);
        if (r.status === "good" && !r.isRoleAccount && !r.isDisposable) {
          winner = candidate;
          break outer;
        }
        // Also bank "risky-non-role" as a fallback win if nothing better surfaces
        await c.sleep(900);
      }
    }

    // If no "good" winner but a non-bad result existed, surface the best one
    if (!winner) {
      const risky = attempts.find(a => a.status === "risky" && !a.role);
      if (risky) winner = risky.email + " (risky — proceed with caution)";
    }

    results.push({ ...t, winner, attempts });
    console.log(winner ? `  → WINNER: ${winner}\n` : `  → no usable address found\n`);
  }

  const after = await c.getCredits();
  console.log(`Consulti after: verify=${after.verification_credits}, lead=${after.lead_credits}`);
  console.log(`Spent: ${before.verification_credits - after.verification_credits} verify credits\n`);

  // Save outputs
  fs.writeFileSync(path.join(__dirname, "exports", "tps-2026-emails-by-pattern.json"), JSON.stringify(results, null, 2));

  console.log("=== FINAL ===");
  for (const r of results) {
    console.log(`  ${r.name.padEnd(22)} → ${r.winner || "NOT FOUND"}`);
  }
})();
