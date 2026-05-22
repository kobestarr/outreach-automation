# May 26 Launch + Consulti Burn-Down — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two cold-outreach campaigns (cardiologists via Lemlist, local trades via Mailead) on Tue 26 May 2026, while burning Consulti beta credits before the 31 May expiry.

**Architecture:** Reuse existing multi-campaign infrastructure (`enrich-campaign.js`, `export-campaign.js`, `verify-existing-emails-consulti.js`, `enrich-cardiologists-consulti.js`, `consulti-verifier.js`). Add three small artefacts: a local-trades area scraper, a campaign-tag stamper, and a tier/exclusion export filter wrapper. Copy and subject lines are explicitly deferred to a Mon 25 May session (see [spec §10](../specs/2026-05-22-may-launch-and-consulti-burn-design.md#10-deferred-work-explicitly-not-in-this-spec)).

**Tech Stack:** Node.js, better-sqlite3, Consulti REST API, Outscraper, Mailead, Lemlist, existing repo modules.

**Linked spec:** `docs/superpowers/specs/2026-05-22-may-launch-and-consulti-burn-design.md`

---

## File map

| File | Status | Purpose |
|---|---|---|
| `verify-existing-emails-consulti.js` | exists, reuse | Batch Consulti verify of DB emails |
| `enrich-cardiologists-consulti.js` | exists, reuse | `/leads/find-by-linkedin` lookup for cardiologists |
| `import-leadrocks-cardiologists.js` | exists, reuse | LeadRocks CSV import (already run) |
| `shared/outreach-core/email-verification/consulti-verifier.js` | exists, reuse | Consulti SDK module |
| `enrich-campaign.js` | exists, reuse | Website-scrape + LLM enrichment per campaign |
| `export-campaign.js` | exists, reuse | Multi-format exporter with junk filters |
| `ksd/local-outreach/orchestrator/modules/database.js` | exists, reuse | DB layer; exposes `addCampaignToBusiness(id, name)` |
| `explore-local-trades.js` | **create** | Trades area scraper for WA14/15/16/SK9/10/12 |
| `tag-businesses.js` | **create** | Adds a new campaign tag to DB rows matching a filter |
| `qa-tuesday-readiness.js` | **create** | Prints the §11 checklist as a verifiable report |
| `docs/superpowers/plans/2026-05-22-may-launch-and-consulti-burn.md` | this file | Plan |

---

## Task 1: Consulti credentials + smoke test

**Files:**
- Read: `shared/outreach-core/email-verification/consulti-verifier.js`

- [ ] **Step 1: Confirm credentials are loadable**

```bash
node -e "const c = require('./shared/outreach-core/email-verification/consulti-verifier'); console.log(c.getKey().slice(0, 8) + '…')"
```
Expected: prints first 8 chars of API key. If it throws "Consulti API key not found", check `~/.credentials/api-keys.json` for the `consulti.apiKey` field or the `CONSULTI_API_KEY` env var.

- [ ] **Step 2: Check live credit balance**

```bash
node -e "const c = require('./shared/outreach-core/email-verification/consulti-verifier'); c.getCredits().then(r => console.log(JSON.stringify(r, null, 2)))"
```
Expected: prints `verification_credits` ≥ ~24,000 and `total_lead_credits` ≥ ~12,000. Snapshot the numbers — they're the baseline for burn-down measurement.

- [ ] **Step 3: Smoke-verify one known-good email**

```bash
node -e "const c = require('./shared/outreach-core/email-verification/consulti-verifier'); c.verifyEmail('kobi@kobestarr.io').then(r => console.log(JSON.stringify(r, null, 2)))"
```
Expected: `status: 'good'`, `isDeliverable: true`. Confirms the verifier works end-to-end.

- [ ] **Step 4: Snapshot credit baseline to file**

```bash
node -e "const c = require('./shared/outreach-core/email-verification/consulti-verifier'); c.getCredits().then(r => console.log(new Date().toISOString(), JSON.stringify(r)))" >> data/consulti-credit-log.txt
```
Expected: appends a timestamped line to `data/consulti-credit-log.txt`. This file is the burn-down audit log — append after every major Consulti-using task.

---

## Task 2: Verify all DB emails via Consulti (Fri 22)

This is the first big credit-spend. Estimated ~1,500 verify credits if no cache hits, lower with the 6-month server-side cache.

**Files:**
- Reuse: `verify-existing-emails-consulti.js`

- [ ] **Step 1: Dry-run to see scope**

```bash
node verify-existing-emails-consulti.js --dry-run
```
Expected: prints a count of distinct emails to be verified and how many already carry `consulti_verified_at` (skipped on resume). If the dry-run shows zero rows, the campaign filter or `owner_email` column is empty — investigate before going live.

- [ ] **Step 2: Smoke-run on 10 emails first**

```bash
node verify-existing-emails-consulti.js --limit=10
```
Expected: 10 lines of `[N/10] email → status (creditsUsed: X)`. Inspect `ksd/local-outreach/orchestrator/data/consulti-verify.jsonl` — should have 10 fresh records, each with `verifiedAt`, `status`, `isDeliverable`. If any errored, fix before continuing.

- [ ] **Step 3: Full DB verify**

```bash
node verify-existing-emails-consulti.js
```
Expected: streams ~1,500 lines (1.5s throttle = ~37 minutes). Run in foreground in a `screen` or `tmux` so it survives terminal close. On completion, `consulti_verified_at` is populated for every row that had an email.

- [ ] **Step 4: Spot-check results**

```bash
sqlite3 ksd/local-outreach/orchestrator/data/businesses.db "SELECT consulti_status, COUNT(*) FROM businesses WHERE consulti_status IS NOT NULL GROUP BY consulti_status"
```
Expected: distribution like `good|N`, `risky|N`, `bad|N`, `unknown|N`. Ratios should look reasonable (>40% good for a 2024 list is expected; >70% good for fresh data).

- [ ] **Step 5: Log credit burn**

```bash
node -e "const c = require('./shared/outreach-core/email-verification/consulti-verifier'); c.getCredits().then(r => console.log(new Date().toISOString(), JSON.stringify(r)))" >> data/consulti-credit-log.txt
```
Expected: `verification_credits` ~1,000–1,500 lower than Task 1.4 snapshot.

- [ ] **Step 6: Commit credit log**

The `.jsonl` and `.db` files are gitignored — leave them on disk only.

```bash
git add data/consulti-credit-log.txt
git commit -m "chore(consulti): full DB email verification — credit log baseline"
```

---

## Task 3: Cardiologist LinkedIn → email lookup (Fri 22 / Sat 23)

Spends 1 lead credit per cardiologist that has a LinkedIn URL but no Consulti-verified email. Estimated ~280 lead credits.

**Files:**
- Reuse: `enrich-cardiologists-consulti.js`

- [ ] **Step 1: Dry-run to see queue size**

```bash
node enrich-cardiologists-consulti.js --dry-run --campaign=doctors-website-cardiologists-uk
```
Expected: prints queue size (~280 unverified cardiologists), already-done count, and the per-row plan. If queue is 0, the cardiologists weren't imported with `linkedin_url` — go back to `import-leadrocks-cardiologists.js`.

- [ ] **Step 2: Smoke-run 5 records**

```bash
node enrich-cardiologists-consulti.js --limit=5 --campaign=doctors-website-cardiologists-uk
```
Expected: 5 lines logging matched/unmatched per cardiologist. Inspect `ksd/local-outreach/orchestrator/data/consulti-cardiologists-enrich.jsonl` — should show fresh email addresses, often differing from the stale 2024 ones.

- [ ] **Step 3: Full cardiologist lookup**

```bash
node enrich-cardiologists-consulti.js --campaign=doctors-website-cardiologists-uk
```
Expected: streams ~280 rows (1.2s throttle = ~6 minutes). When Consulti returns a fresh email differing from the stale 2024 one, the script promotes the fresh value into `owner_email`.

- [ ] **Step 4: Verify the freshly-discovered emails**

The cardiologists got new emails in Step 3, but those emails may not be in `consulti-verify.jsonl` yet. Re-run Task 2.3 with `--force-recheck` scoped to the cardiologist campaign:

```bash
node verify-existing-emails-consulti.js --campaign=doctors-website-cardiologists-uk --force-recheck
```
Expected: re-verifies the cardiologist subset (~280 rows). Spend: ~280 verify credits (or less with cache).

- [ ] **Step 5: Log credit burn and commit**

```bash
node -e "const c = require('./shared/outreach-core/email-verification/consulti-verifier'); c.getCredits().then(r => console.log(new Date().toISOString(), JSON.stringify(r)))" >> data/consulti-credit-log.txt
git add data/consulti-credit-log.txt
git commit -m "chore(consulti): cardiologist LI→email lookup — credit log update"
```

---

## Task 4: Build the campaign tag stamper

A small script that adds a new campaign tag to DB rows matching a filter, leveraging existing `addCampaignToBusiness`.

**Files:**
- Create: `tag-businesses.js`

- [ ] **Step 1: Write the script**

```javascript
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
```

- [ ] **Step 2: Dry-run the cardiologist tag**

```bash
node tag-businesses.js --tag=cardiologists-nigel-2026 --where="campaigns LIKE '%doctors-website-cardiologists-uk%'" --dry-run
```
Expected: prints "Matched ~284 rows for tag cardiologists-nigel-2026" and a sample of 10 cardiologist names.

- [ ] **Step 3: Apply cardiologist tag**

```bash
node tag-businesses.js --tag=cardiologists-nigel-2026 --where="campaigns LIKE '%doctors-website-cardiologists-uk%'"
```
Expected: "Tagged ~284 rows".

- [ ] **Step 4: Dry-run the local trades tag**

```bash
node tag-businesses.js --tag=local-trades-david-wood-2026 --where="substr(postcode,1,3) IN ('SK7','SK8','SK9','SK10','SK11','SK12','WA14','WA15','WA16','M33','SK6','SK1','SK2','SK3','SK4') AND category NOT IN ('Football club','Soccer club','Sports club','Sports complex','Sports school','Soccer field','Soccer practice','Park','Club','Pub','Consultant Cardiologist','journalist','podcast') AND category NOT LIKE '%cleaner%' AND category NOT LIKE '%gutter%' AND category NOT LIKE '%window%' AND owner_email IS NOT NULL AND owner_email != '' AND assigned_tier >= 1" --dry-run
```
Expected: prints "Matched ~291 rows" and sample non-cleaning trades from SM/E-Ches.

- [ ] **Step 5: Apply local trades tag**

Same as Step 4 minus `--dry-run`. Expected: "Tagged ~291 rows".

- [ ] **Step 6: Verify the tags are visible**

```bash
sqlite3 ksd/local-outreach/orchestrator/data/businesses.db "SELECT 'cardiologists-nigel-2026' as tag, COUNT(*) FROM businesses WHERE campaigns LIKE '%cardiologists-nigel-2026%' UNION ALL SELECT 'local-trades-david-wood-2026', COUNT(*) FROM businesses WHERE campaigns LIKE '%local-trades-david-wood-2026%'"
```
Expected: two rows showing both tag counts as positive.

- [ ] **Step 7: Commit**

```bash
git add tag-businesses.js
git commit -m "feat(campaigns): add tag-businesses.js for filtered campaign tagging"
```

---

## Task 5: Build the local-trades area scraper

Adapts `explore-football-clubs.js` to scrape trades verticals across new postcode areas.

**Files:**
- Create: `explore-local-trades.js`
- Reference: `explore-football-clubs.js` (copy structure, replace search terms and areas)

- [ ] **Step 1: Write the script**

```javascript
#!/usr/bin/env node
/**
 * Local Trades Scraper — South Manchester / East Cheshire affluent areas.
 *
 * Targets non-cleaning trades in postcodes David Wood doesn't already cover
 * commercially (WA14/15/16 + SK9/10/12), plus older campaign areas for fill-in.
 *
 * Usage:
 *   node explore-local-trades.js --dry-run
 *   node explore-local-trades.js --scrape-only
 *   node explore-local-trades.js --area=affluent     # WA14/15/16 + SK9/10/12 (default)
 *   node explore-local-trades.js --area=fill         # SK1/2/3/4/6 — already partially scraped
 */
const path = require('path');
const fs = require('fs');
const { initDatabase, saveBusiness, checkDuplicate, closeDatabase, getBusinessStats } = require('./ksd/local-outreach/orchestrator/modules/database');

const credPath = path.join(process.env.HOME, '.credentials', 'api-keys.json');
const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
const API_KEY = credentials.outscraper.apiKey;

const DRY_RUN = process.argv.includes('--dry-run');
const SCRAPE_ONLY = process.argv.includes('--scrape-only');
const AREA = (process.argv.find(a => a.startsWith('--area=')) || '').split('=')[1] || 'affluent';

// Trade verticals — exclude window/gutter/exterior cleaning to protect David Wood
const SEARCH_TERMS = [
  'plumber',
  'electrician',
  'roofer',
  'gardener',
  'landscaper',
  'painter and decorator',
  'joiner',
  'kitchen fitter',
  'bathroom fitter',
  'locksmith',
  'handyman',
  'driveway paving',
  'fencing contractor',
];

const AREAS = {
  affluent: ['Altrincham', 'Hale', 'Hale Barns', 'Knutsford', 'Alderley Edge', 'Wilmslow', 'Prestbury', 'Macclesfield', 'Poynton'],
  fill: ['Stockport', 'Marple', 'Bredbury', 'Heaton Moor', 'Heaton Mersey'],
};

const queries = [];
for (const town of AREAS[AREA]) {
  for (const term of SEARCH_TERMS) {
    queries.push(`${term} in ${town}`);
  }
}

console.log(`Area: ${AREA}`);
console.log(`Towns: ${AREAS[AREA].length}`);
console.log(`Terms: ${SEARCH_TERMS.length}`);
console.log(`Queries: ${queries.length}`);

if (DRY_RUN) {
  console.log('\nSample queries:');
  queries.slice(0, 10).forEach(q => console.log(`  ${q}`));
  if (queries.length > 10) console.log(`  ... and ${queries.length - 10} more`);
  process.exit(0);
}

initDatabase();

async function outscraperSearch(query) {
  const url = `https://api.app.outscraper.com/maps/search-v3?query=${encodeURIComponent(query)}&limit=20&language=en&region=GB&async=false`;
  const r = await fetch(url, { headers: { 'X-API-KEY': API_KEY } });
  if (!r.ok) throw new Error(`Outscraper HTTP ${r.status} for "${query}"`);
  const j = await r.json();
  return (j.data && j.data[0]) || [];
}

const CAMPAIGN_TAG = 'local-trades-david-wood-2026';
let saved = 0, duplicates = 0, errored = 0;

(async () => {
  for (const [i, q] of queries.entries()) {
    try {
      console.log(`[${i + 1}/${queries.length}] ${q}`);
      const results = await outscraperSearch(q);
      for (const biz of results) {
        // Outscraper field mapping (kept aligned with explore-football-clubs.js)
        const record = {
          name: biz.name,
          location: biz.city || biz.full_address,
          postcode: biz.postal_code || null,
          address: biz.full_address,
          website: biz.site,
          phone: biz.phone,
          category: biz.subtypes || biz.type,
          rating: biz.rating,
          review_count: biz.reviews,
          placeId: biz.place_id,
        };
        if (checkDuplicate(record).isDuplicate) {
          duplicates++;
          continue;
        }
        if (!SCRAPE_ONLY) {
          saveBusiness(record, { campaigns: [CAMPAIGN_TAG] });
          saved++;
        }
      }
      // Throttle: 1s between queries
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      errored++;
      console.error(`  ERROR: ${e.message}`);
    }
  }
  console.log(`\nDone. saved=${saved}, duplicates=${duplicates}, errored=${errored}`);
  console.log(getBusinessStats({ campaign: CAMPAIGN_TAG }));
  closeDatabase();
})();
```

- [ ] **Step 2: Dry-run**

```bash
node explore-local-trades.js --dry-run
```
Expected: prints "Queries: ~117" (9 towns × 13 terms) and sample queries. Confirms no syntax errors.

- [ ] **Step 3: Commit (run executes in Task 6)**

```bash
git add explore-local-trades.js
git commit -m "feat(scraper): add local-trades area scraper for WA14/15/16 + SK9/10/12"
```

---

## Task 6: Saturday — scrape Wave 2 local trades

Executes the script from Task 5 against Outscraper. Estimated Outscraper cost: ~£15–25 depending on plan, ~500–800 new businesses scraped.

**Files:**
- Run: `explore-local-trades.js`

- [ ] **Step 1: Run scrape against affluent areas**

```bash
node explore-local-trades.js --area=affluent
```
Expected: 117 queries, ~30-minute run, prints saved/duplicates/errored at the end. Watch for HTTP errors — if Outscraper returns 5xx, throttle and retry the failed queries.

- [ ] **Step 2: Verify DB growth**

```bash
sqlite3 ksd/local-outreach/orchestrator/data/businesses.db "SELECT substr(postcode,1,3), COUNT(*) FROM businesses WHERE campaigns LIKE '%local-trades-david-wood-2026%' GROUP BY substr(postcode,1,3) ORDER BY 2 DESC"
```
Expected: meaningful counts for WA14, WA15, WA16, SK9, SK10, SK12 alongside the existing SK7/8/etc.

- [ ] **Step 3: Backup DB**

The DB module auto-backs up on init, but force one explicitly before enrichment runs that mutate many rows:

```bash
cp ksd/local-outreach/orchestrator/data/businesses.db ksd/local-outreach/orchestrator/data/backups/businesses-pre-wave2-enrich-$(date +%Y%m%d-%H%M).db
```

- [ ] **Step 4: Log scrape outcome**

The DB itself is gitignored. Capture the scrape outcome to a tracked log file instead.

```bash
echo "$(date -Iseconds) wave2-scrape complete saved=N duplicates=N errored=N" >> data/scrape-log.txt
git add data/scrape-log.txt
git commit -m "chore(scrape): wave 2 local trades scrape outcome log"
```

---

## Task 7: Sunday — enrich + verify Wave 2 trades

Runs the existing enrichment + Consulti verify against the new contacts.

**Files:**
- Reuse: `enrich-campaign.js`, `verify-existing-emails-consulti.js`

- [ ] **Step 1: Dry-run enrichment**

```bash
node enrich-campaign.js --campaign=local-trades-david-wood-2026 --dry-run
```
Expected: prints how many businesses will be enriched (those without `enriched_at`).

- [ ] **Step 2: Smoke enrichment on 10**

```bash
node enrich-campaign.js --campaign=local-trades-david-wood-2026 --limit=10
```
Expected: 10 websites scraped + LLM extraction where regex finds nothing. Inspect a few rows in the DB — `owner_email`, `owner_first_name`, `enriched_at` should now be populated.

- [ ] **Step 3: Full enrichment**

```bash
node enrich-campaign.js --campaign=local-trades-david-wood-2026
```
Expected: ~30–90 minutes depending on website availability. Per-website 60s timeout protects against hangs.

- [ ] **Step 4: Consulti verify Wave 2 emails**

```bash
node verify-existing-emails-consulti.js --campaign=local-trades-david-wood-2026
```
Expected: ~300–500 newly-enriched emails verified. Burns ~300–500 verify credits.

- [ ] **Step 5: Audit**

```bash
sqlite3 ksd/local-outreach/orchestrator/data/businesses.db "SELECT consulti_status, COUNT(*) FROM businesses WHERE campaigns LIKE '%local-trades-david-wood-2026%' AND consulti_status IS NOT NULL GROUP BY consulti_status"
```
Expected: status distribution across the trades campaign.

- [ ] **Step 6: Log credit burn and commit**

```bash
node -e "const c = require('./shared/outreach-core/email-verification/consulti-verifier'); c.getCredits().then(r => console.log(new Date().toISOString(), JSON.stringify(r)))" >> data/consulti-credit-log.txt
git add data/consulti-credit-log.txt
git commit -m "chore(consulti): wave 2 trades enrich+verify — credit log update"
```

---

## Task 8: Build the Tuesday readiness QA script

Codifies the spec's §11 checklist into a verifiable report.

**Files:**
- Create: `qa-tuesday-readiness.js`

- [ ] **Step 1: Write the script**

```javascript
#!/usr/bin/env node
/**
 * Tuesday-launch readiness QA. Prints pass/fail for every check in spec §11.
 *
 * Usage: node qa-tuesday-readiness.js
 */
const path = require("path");
const Database = require("better-sqlite3");
const DB_PATH = path.join(__dirname, "ksd", "local-outreach", "orchestrator", "data", "businesses.db");
const db = new Database(DB_PATH, { readonly: true });

function check(label, ok, detail = "") {
  const icon = ok ? "PASS" : "FAIL";
  console.log(`[${icon}] ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

const checks = [];

// 1. Cardiologists verified + tagged
const cardsTotal = db.prepare("SELECT COUNT(*) n FROM businesses WHERE campaigns LIKE '%cardiologists-nigel-2026%'").get().n;
const cardsClean = db.prepare("SELECT COUNT(*) n FROM businesses WHERE campaigns LIKE '%cardiologists-nigel-2026%' AND consulti_status IN ('good','risky') AND owner_email IS NOT NULL AND owner_email != ''").get().n;
checks.push(check("Cardiologists tagged", cardsTotal >= 200, `${cardsTotal} tagged`));
checks.push(check("Cardiologists clean (deliverable/risky)", cardsClean >= 150, `${cardsClean} ready`));

// 2. Local trades verified + tagged
const tradesTotal = db.prepare("SELECT COUNT(*) n FROM businesses WHERE campaigns LIKE '%local-trades-david-wood-2026%'").get().n;
const tradesClean = db.prepare("SELECT COUNT(*) n FROM businesses WHERE campaigns LIKE '%local-trades-david-wood-2026%' AND consulti_status IN ('good','risky') AND owner_email IS NOT NULL AND owner_email != ''").get().n;
checks.push(check("Local trades tagged", tradesTotal >= 250, `${tradesTotal} tagged`));
checks.push(check("Local trades clean", tradesClean >= 200, `${tradesClean} ready`));

// 3. Cleaning competitors excluded
const accidentalCleaners = db.prepare("SELECT COUNT(*) n FROM businesses WHERE campaigns LIKE '%local-trades-david-wood-2026%' AND (category LIKE '%cleaner%' OR category LIKE '%gutter%' OR category LIKE '%window%')").get().n;
checks.push(check("No cleaning competitors in trades list", accidentalCleaners === 0, `${accidentalCleaners} found`));

// 4. Tier pricing populated
const tradesUntiered = db.prepare("SELECT COUNT(*) n FROM businesses WHERE campaigns LIKE '%local-trades-david-wood-2026%' AND (assigned_tier IS NULL OR monthly_price IS NULL)").get().n;
checks.push(check("Trades have tier + pricing", tradesUntiered === 0, `${tradesUntiered} missing`));

// 5. Excluded LeadRocks emails NOT in cardiologist export pool
const excluded = db.prepare("SELECT COUNT(*) n FROM businesses WHERE campaigns LIKE '%cardiologists-nigel-2026%' AND owner_email IN ('j.grapsa@rbht.nhs.uk','d.w.s.chong@gmail.com','dwschong@gmail.com')").get().n;
checks.push(check("GDPR opt-outs / hard-bounces excluded", excluded === 0, `${excluded} should be 0`));

// 6. Consulti credit log exists and shows recent burn
const fs = require("fs");
const logPath = path.join(__dirname, "data", "consulti-credit-log.txt");
const logExists = fs.existsSync(logPath);
checks.push(check("Consulti credit log present", logExists, logExists ? "" : "data/consulti-credit-log.txt missing"));

const failed = checks.filter(c => !c).length;
console.log(`\n${failed === 0 ? "READY" : "NOT READY"} — ${checks.length - failed}/${checks.length} passed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it (will fail on Fri, that's expected)**

```bash
node qa-tuesday-readiness.js
```
Expected: prints PASS/FAIL per check. On Fri it will show some FAILs (e.g. local trades clean count may not be hit until Sun enrichment). The script is for the Mon final-gate, not Fri.

- [ ] **Step 3: Commit**

```bash
git add qa-tuesday-readiness.js
git commit -m "feat(qa): tuesday-launch readiness checklist script"
```

---

## Task 9: Monday — final pre-send verify + readiness gate (BH 25 May)

This task gates the Tuesday launch. Copy is assumed to be authored in a separate Mon session before this task runs.

**Files:**
- Reuse: `verify-existing-emails-consulti.js`, `qa-tuesday-readiness.js`, `export-campaign.js`

- [ ] **Step 1: Final verify sweep — cardiologists**

```bash
node verify-existing-emails-consulti.js --campaign=cardiologists-nigel-2026
```
Expected: re-verifies any rows lacking `consulti_verified_at`. Mostly cache hits (free) since Task 2/3 already ran.

- [ ] **Step 2: Final verify sweep — local trades**

```bash
node verify-existing-emails-consulti.js --campaign=local-trades-david-wood-2026
```
Expected: same shape as Step 1.

- [ ] **Step 3: Run readiness QA**

```bash
node qa-tuesday-readiness.js
```
Expected: all PASS. If any FAIL, fix that specific issue before exporting. Common fixes:
- Cardiologists clean count low → re-run Task 3.4 (`--force-recheck`)
- Trades clean count low → re-run Task 7.4
- Cleaning competitors present → tighten the `tag-businesses.js` where clause and re-tag

- [ ] **Step 4: Export cardiologists to Lemlist**

(Assumes copy + Lemlist campaign already created in the parallel copy session.)

```bash
node export-campaign.js --campaign=cardiologists-nigel-2026 --format=lemlist --clean --has-email
```
Expected: pushes the deliverable cardiologists into the named Lemlist campaign. Confirm count in Lemlist UI matches the QA `cardsClean` number.

- [ ] **Step 5: Export local trades to Mailead CSV**

```bash
node export-campaign.js --campaign=local-trades-david-wood-2026 --format=mailead --clean --has-email
```
Expected: writes `exports/local-trades-david-wood-2026-mailead-2026-05-25-verified.csv`. Manually upload to Mailead.

- [ ] **Step 6: Test-send each sequence to your personal inbox**

In Lemlist + Mailead: add `kobi+test@kobestarr.io` to each sequence, send one email to yourself, confirm rendering + merge-variable substitution (tier pricing, first name, town).

- [ ] **Step 7: Commit and log final credit balance**

`exports/*.csv` is gitignored, so the Mailead CSV stays on disk only.

```bash
node -e "const c = require('./shared/outreach-core/email-verification/consulti-verifier'); c.getCredits().then(r => console.log(new Date().toISOString(), 'pre-launch', JSON.stringify(r)))" >> data/consulti-credit-log.txt
git add data/consulti-credit-log.txt
git commit -m "chore(launch): pre-launch credit log snapshot"
```

---

## Task 10: Tuesday — launch (26 May)

Pure ops. No code.

- [ ] **Step 1: Re-run QA one more time at 08:00**

```bash
node qa-tuesday-readiness.js
```
Expected: all PASS.

- [ ] **Step 2: Start the Lemlist cardiologist sequence**

In Lemlist UI: confirm sender (`kobi@kobestarr.io`), schedule send window 09:00–17:00 BST, daily cap 150, then click Start. Snapshot the launch screenshot to `exports/launch-cardiologists-2026-05-26.png`.

- [ ] **Step 3: Start the Mailead local trades sequence**

In Mailead UI: confirm pre-warmed sender pool active, daily cap honoured, 3-email cadence (Day 0/3/7), then start. Snapshot to `exports/launch-trades-2026-05-26.png`.

- [ ] **Step 4: Watch first hour**

Tail bounce reports in both tools for the first 60 minutes. If bounce rate >10%, pause and re-check the verify pass. <5% is normal.

- [ ] **Step 5: Log credit balance + commit**

PNGs in `exports/` are NOT gitignored (only `.csv` and `.json` are), so the launch screenshots can be tracked.

```bash
node -e "const c = require('./shared/outreach-core/email-verification/consulti-verifier'); c.getCredits().then(r => console.log(new Date().toISOString(), 'launch-day', JSON.stringify(r)))" >> data/consulti-credit-log.txt
git add exports/launch-*.png data/consulti-credit-log.txt
git commit -m "launch: cardiologists + local trades campaigns live 2026-05-26"
```

---

## Task 11: Wed–Sat — Wave 2 expansion + Consulti credit burn

Aggressive credit burn against new LinkedIn lists. Iterative.

- [ ] **Step 1: Identify Wave 2 cardiologist verticals**

Adjacent specialties to mine via Apify LinkedIn Sales Navigator scraper or LeadRocks: consultant gastroenterologists, consultant orthopaedic surgeons, consultant dermatologists, consultant rheumatologists. Goal: ~1,500 new LinkedIn URLs.

- [ ] **Step 2: Import + tag**

```bash
node import-leadrocks-cardiologists.js --file=<new csv> --campaign=consultants-wave-2-2026
node tag-businesses.js --tag=consultants-wave-2-2026 --where="campaigns LIKE '%consultants-wave-2-2026%'"
```

- [ ] **Step 3: Lookup via Consulti**

```bash
node enrich-cardiologists-consulti.js --campaign=consultants-wave-2-2026
node verify-existing-emails-consulti.js --campaign=consultants-wave-2-2026
```
Burn target: ~1,500 lead credits + ~1,200 verify credits per Wave 2 vertical.

- [ ] **Step 4: Daily credit log + commit**

End of each Wed/Thu/Fri/Sat. `.jsonl` artefacts are gitignored.

```bash
node -e "const c = require('./shared/outreach-core/email-verification/consulti-verifier'); c.getCredits().then(r => console.log(new Date().toISOString(), 'burn-day', JSON.stringify(r)))" >> data/consulti-credit-log.txt
git add data/consulti-credit-log.txt
git commit -m "chore(consulti): burn-down day <date> — <vertical>"
```

- [ ] **Step 5: Sat 30 May spillover + final log**

Spend any remaining lead credits on opportunistic lookups (any LinkedIn URL we can scrape from public sources). Final log entry before expiry:

```bash
node -e "const c = require('./shared/outreach-core/email-verification/consulti-verifier'); c.getCredits().then(r => console.log(new Date().toISOString(), 'final-pre-expiry', JSON.stringify(r)))" >> data/consulti-credit-log.txt
git add data/consulti-credit-log.txt
git commit -m "consulti: final burn-down log before 31 May expiry"
```

---

## Deferred (do NOT execute as part of this plan)

These are tracked in spec §10 and require dedicated focus, typically on Mon 25 May:

1. **Email copy + subject lines** for both campaigns. Subject lines must pass a cold-reader audit ([[feedback-subject-lines-cold-reader]]).
2. **Nigel Stephens case-study facts** (specialism, before/after result, direct quote) supplied by Kobi.
3. **Mailead AI training doc** update for trades campaign auto-reply tone.
4. **Wave 3 Prosp LI-only sequence** for cardiologists (designed after Wave 1 response data lands).
