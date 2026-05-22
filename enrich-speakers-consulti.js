#!/usr/bin/env node
/**
 * Consulti enrichment for the 442 Podcast Show London 2026 speakers.
 *
 * For each speaker (firstName, lastName, employer-name) we infer a domain
 * and call /leads/find-by-name. On match we save the full Consulti payload
 * (email + email_status + LinkedIn + current title + employer + location).
 *
 * - Lead-credit pool: ~6K available, 442 calls worst case = trivial.
 * - No-match returns 0 credits (free), so we can be aggressive with guesses.
 * - JSONL audit log at data/consulti-speakers-enrich.jsonl
 * - DB columns updated: owner_email, linkedin_url, consulti_status,
 *   consulti_deliverable, consulti_role, consulti_catch_all, consulti_verified_at
 *   business_data merged with enriched payload.
 *
 * Flags:
 *   --limit=N         smoke-test cap
 *   --dry-run         print plan only, no API calls
 *   --campaign=NAME   default event-podcast-show-london-2026-speakers
 */
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const consulti = require("./shared/outreach-core/email-verification/consulti-verifier");

const args = Object.fromEntries(process.argv.slice(2).flatMap(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [[m[1], m[2] ?? true]] : [];
}));
const CAMPAIGN = args.campaign || "event-podcast-show-london-2026-speakers";
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;
const DRY_RUN = !!args["dry-run"];
const SLEEP_MS = 1200;

const DB_PATH = path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "businesses.db");
const JSONL_PATH = path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "consulti-speakers-enrich.jsonl");

// Curated employer → primary work-email domain map.
// Filled from the top employers in the scraped list (n>=2) + common knowledge.
// Anything not here falls back to a slugified guess.
const EMPLOYER_DOMAIN = {
  "Acast": "acast.com",
  "YouTube": "youtube.com",
  "Goalhanger": "goalhanger.com",
  "Flightstory": "flightstory.com",
  "Podimo": "podimo.com",
  "BBC": "bbc.co.uk",
  "Novel": "novel.audio",
  "Spotify": "spotify.com",
  "Global": "global.com",
  "BBC Studios": "bbcstudios.com",
  "Platform Media": "platformmedia.com",
  "Your Aunties Could Never": "yourauntiescouldnever.com",
  "Audible": "audible.co.uk",
  "Apple Podcasts": "apple.com",
  "Amazon Music": "amazon.co.uk",
  "Sky News": "sky.com",
  "talkSPORT": "talksport.com",
  "Wondery": "wondery.com",
  "iHeartMedia": "iheartmedia.com",
  "iHeartRadio": "iheartmedia.com",
  "Sony Music Entertainment": "sonymusic.com",
  "Sony Music": "sonymusic.com",
  "Universal Music": "umusic.com",
  "Universal Music Group": "umusic.com",
  "Warner Music": "wmg.com",
  "Channel 4": "channel4.co.uk",
  "ITV": "itv.com",
  "Sky": "sky.com",
  "Sky Sports": "skysports.com",
  "Netflix": "netflix.com",
  "Meta": "meta.com",
  "TikTok": "tiktok.com",
  "Substack": "substack.com",
  "Riverside": "riverside.fm",
  "Riverside.fm": "riverside.fm",
  "Captivate": "captivate.fm",
  "Megaphone": "megaphone.fm",
  "Buzzsprout": "buzzsprout.com",
  "Transistor": "transistor.fm",
  "PRX": "prx.org",
  "Audacy": "audacy.com",
  "SiriusXM": "siriusxm.com",
  "TED": "ted.com",
  "Reuters": "reuters.com",
  "Bloomberg": "bloomberg.net",
  "The Times": "thetimes.co.uk",
  "The Guardian": "theguardian.com",
  "Financial Times": "ft.com",
  "FT": "ft.com",
  "The Telegraph": "telegraph.co.uk",
  "Daily Mail": "dailymail.co.uk",
  "Mirror": "mirror.co.uk",
  "Bauer Media": "bauermedia.co.uk",
  "Bauer Audio": "bauermedia.co.uk",
  "Bauer Media Audio": "bauermedia.co.uk",
  "Crowd Network": "crowdnetwork.co.uk",
  "Crowd": "crowdnetwork.co.uk",
  "Folding Pocket": "foldingpocket.com",
  "Chalk + Blade": "chalkandblade.com",
  "Chalk and Blade": "chalkandblade.com",
  "Listen": "listenentertainment.com",
  "Listen Entertainment": "listenentertainment.com",
  "Audio UK": "audiouk.org.uk",
  "Radiocentre": "radiocentre.org",
  "Adopter Media": "adoptermedia.com",
  "Adopter": "adoptermedia.com",
  "Squarespace": "squarespace.com",
  "talkRADIO": "talkradio.co.uk",
};

function inferDomain(employer) {
  if (!employer) return null;
  const trimmed = employer.trim();
  if (EMPLOYER_DOMAIN[trimmed]) return EMPLOYER_DOMAIN[trimmed];

  // Try a case-insensitive match
  const lowerMap = Object.fromEntries(Object.entries(EMPLOYER_DOMAIN).map(([k, v]) => [k.toLowerCase(), v]));
  if (lowerMap[trimmed.toLowerCase()]) return lowerMap[trimmed.toLowerCase()];

  // Heuristic fallback: strip common suffixes, slugify, append .com
  // Skip obvious non-employers (people's own podcast names, generic descriptors)
  if (/podcast|show|network|productions?|media|studios?/i.test(trimmed) && trimmed.split(/\s+/).length > 4) {
    // Too long / podcast-ish name — probably not the real employer domain
    return null;
  }
  const slug = trimmed
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(ltd|limited|inc|llc|the|and|of)\b/gi, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  if (slug.length < 3 || slug.length > 30) return null;
  return `${slug}.com`;
}

const db = new Database(DB_PATH);

// Build queue: speakers with no email yet
const queue = db.prepare(`
  SELECT id, name, owner_first_name AS first_name, owner_last_name AS last_name, address AS employer, business_data
  FROM businesses
  WHERE campaigns LIKE ?
    AND (owner_email IS NULL OR owner_email = '')
    AND owner_first_name IS NOT NULL AND owner_first_name != ''
    AND owner_last_name IS NOT NULL AND owner_last_name != ''
  ORDER BY name
`).all(`%"${CAMPAIGN}"%`);

console.log(`Speakers needing enrichment: ${queue.length}`);

// Annotate with inferred domain
const annotated = queue.map(r => ({ ...r, domain: inferDomain(r.employer) }));
const withDomain = annotated.filter(r => r.domain);
const withoutDomain = annotated.filter(r => !r.domain);

console.log(`With inferred domain:    ${withDomain.length}`);
console.log(`No domain (will skip):   ${withoutDomain.length}`);
console.log(`\nTop 10 inferred domains:`);
const domainCount = {};
withDomain.forEach(r => { domainCount[r.domain] = (domainCount[r.domain] || 0) + 1; });
Object.entries(domainCount).sort((a,b)=>b[1]-a[1]).slice(0, 10).forEach(([d, n]) => console.log(`  ${String(n).padStart(3)}  ${d}`));

console.log(`\nSample 'no domain' employers (first 10):`);
withoutDomain.slice(0, 10).forEach(r => console.log(`  ${r.name.padEnd(30)} | ${r.employer || "(no employer)"}`));

let work = LIMIT ? withDomain.slice(0, LIMIT) : withDomain;
console.log(`\nQueue to call /leads/find-by-name: ${work.length}`);

if (DRY_RUN) { console.log("\nDRY RUN — first 10:"); work.slice(0, 10).forEach(r => console.log(`  ${r.first_name} ${r.last_name} @ ${r.domain}`)); process.exit(0); }
if (work.length === 0) { console.log("Nothing to do."); process.exit(0); }

(async () => {
  const credits = await consulti.getCredits();
  console.log(`\nConsulti credits: verify=${credits.verification_credits}, lead=${credits.lead_credits}`);
  if (credits.lead_credits < work.length) {
    console.warn(`⚠️  Lead credits (${credits.lead_credits}) less than queue (${work.length}). Capping.`);
    work = work.slice(0, credits.lead_credits);
  }

  const updateStmt = db.prepare(`UPDATE businesses SET
      owner_email = COALESCE(@email, owner_email),
      email_source = CASE WHEN @email IS NOT NULL THEN 'consulti-leads' ELSE email_source END,
      linkedin_url = COALESCE(@linkedin, linkedin_url),
      consulti_status = @status,
      consulti_deliverable = @deliverable,
      consulti_role = @role,
      consulti_catch_all = @catch_all,
      consulti_verified_at = @verified_at,
      business_data = @business_data,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = @id`);

  const jsonl = fs.createWriteStream(JSONL_PATH, { flags: "a" });
  const tally = { matched: 0, missed: 0, error: 0, creditsSpent: 0 };
  const start = Date.now();

  for (let i = 0; i < work.length; i++) {
    const r = work[i];
    let res;
    try {
      res = await consulti.findByName({ first_name: r.first_name, last_name: r.last_name, domain: r.domain });
    } catch (e) {
      if (e.message.includes("insufficient")) { console.error(`\nOut of credits at ${i + 1}/${work.length}`); break; }
      res = { matched: false, error: e.message, creditsUsed: 0 };
    }

    let updateArgs = {
      id: r.id, email: null, linkedin: null,
      status: null, deliverable: 0, role: 0, catch_all: 0, verified_at: null,
      business_data: r.business_data,
    };

    if (res.matched) {
      tally.matched++;
      const d = res.data;
      const merged = {};
      try { Object.assign(merged, JSON.parse(r.business_data || "{}")); } catch {}
      merged.consultiEnrichment = d;
      merged.consultiEnrichedAt = new Date().toISOString();
      updateArgs = {
        id: r.id,
        email: d.email || null,
        linkedin: d.linkedin_url || null,
        status: d.email_status || null,
        deliverable: d.email_status === "good" ? 1 : 0,
        role: 0, catch_all: 0,
        verified_at: new Date().toISOString(),
        business_data: JSON.stringify(merged),
      };
    } else if (res.error) {
      tally.error++;
    } else {
      tally.missed++;
    }
    tally.creditsSpent += res.creditsUsed || 0;

    jsonl.write(JSON.stringify({
      id: r.id, name: r.name, first_name: r.first_name, last_name: r.last_name, domain: r.domain,
      matched: !!res.matched, email: res.data?.email || null,
      email_status: res.data?.email_status || null,
      linkedin: res.data?.linkedin_url || null,
      title: res.data?.job_title || null,
      company: res.data?.company_name || null,
      creditsUsed: res.creditsUsed, error: res.error || null,
      ts: new Date().toISOString(),
    }) + "\n");

    updateStmt.run(updateArgs);

    if ((i + 1) % 20 === 0 || i === work.length - 1) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      const mark = res.matched ? "✓" : (res.error ? "×" : "·");
      console.log(`  [${i + 1}/${work.length}] ${mark} ${r.first_name} ${r.last_name} @ ${r.domain}${res.matched ? ` → ${res.data?.email} (${res.data?.email_status})` : ""}  |  matched=${tally.matched} missed=${tally.missed} err=${tally.error}  |  ${tally.creditsSpent} credits, ${elapsed}s`);
    }
    if (i < work.length - 1) await consulti.sleep(SLEEP_MS);
  }
  jsonl.end();

  const after = await consulti.getCredits();
  console.log(`\n=== DONE ===`);
  console.log(`Matched:  ${tally.matched}  (${Math.round(tally.matched/work.length*100)}% hit rate)`);
  console.log(`Missed:   ${tally.missed}`);
  console.log(`Errors:   ${tally.error}`);
  console.log(`Credits spent: ${tally.creditsSpent}`);
  console.log(`Credits remaining: verify=${after.verification_credits}, lead=${after.lead_credits}`);
  console.log(`JSONL: ${JSONL_PATH}`);
})();
