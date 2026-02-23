# Outreach Automation System

AI-powered outreach platform. Scrapes Google Maps, enriches with website data, extracts owner names via LLM, discovers and verifies emails, and exports to Lemlist (email), Mailead (cold email), and GoHighLevel (SMS/phone).

**Built for:** KSD (Kobi Omenaka) — local business outreach (Bramhall SK7) and UFH podcast (youth football clubs nationwide).

---

## Quick Start

```bash
npm install
npx playwright install chromium

# KSD: Bramhall local businesses
node batch-bramhall-all-categories.js --dry-run

# UFH: Football clubs (GM + East Cheshire)
node explore-football-clubs.js --area=gm --dry-run

# UFH: Football clubs (Chelsea area)
node explore-football-clubs.js --area=chelsea --dry-run

# Enrich any campaign
node enrich-campaign.js --campaign=ufh-football-clubs --dry-run

# Export with junk filtering
node export-campaign.js --campaign=ufh-football-clubs --has-email --clean --format=mailead
```

### Prerequisites

- **Node.js** 18+
- **Credentials** at `~/.credentials/api-keys.json` (Outscraper, Anthropic, Reoon, Icypeas, Lemlist, GHL)
- **Playwright** browsers installed via `npx playwright install chromium`

---

## Architecture

```
outreach-automation/
├── batch-bramhall-all-categories.js   # KSD: main pipeline orchestrator
├── improve-emails.js                  # 3-stage email improvement
├── reexport-clean-leads.js            # Re-export verified leads to Lemlist
├── audit-lemlist-campaign.js          # Audit + verify campaign leads
├── rescrape-all-websites.js           # Re-scrape websites with Playwright
├── verify-and-export.js               # Verify emails then export
│
├── explore-football-clubs.js          # UFH: scrape youth football clubs (--area=gm|chelsea|original)
├── enrich-campaign.js                 # Enrich any campaign (website + LLM, timeout-protected)
├── export-campaign.js                 # Universal export (CSV/Mailead/Lemlist, --clean junk filter)
├── verify-football-clubs.js           # Batch Reoon verification of exported CSVs
├── import-pressranger.js              # Import PressRanger journalist/podcast CSV
│
├── shared/outreach-core/              # Reusable core modules
│   ├── credentials-loader.js          # API key management + usage tracking
│   ├── logger.js                      # Structured logging
│   ├── enrichment/
│   │   ├── website-scraper.js         # HTTP + sitemap-based scraping
│   │   ├── browser-fetcher.js         # Playwright for JS-rendered sites
│   │   ├── llm-owner-extractor.js     # Claude Haiku owner/email extraction
│   │   └── tech-detector.js           # CMS detection, website age
│   ├── email-discovery/
│   │   ├── icypeas-finder.js          # Icypeas email finder API
│   │   ├── email-pattern-matcher.js   # firstname@domain pattern testing
│   │   └── website-email-extractor.js # Regex email extraction from HTML
│   ├── email-verification/
│   │   └── reoon-verifier.js          # Reoon verification (2,100/day limit)
│   ├── content-generation/
│   │   ├── email-merge-variables.js   # Dynamic Lemlist merge variables
│   │   ├── observation-signals.js     # Business pain-point detection (7 signals)
│   │   └── category-mapper.js         # Category → business type mapping
│   ├── export-managers/
│   │   └── lemlist-exporter.js        # Lemlist campaign API integration
│   └── validation/
│       ├── data-quality.js            # Name/email validation (150+ blocklist words)
│       └── common-first-names.js      # 600+ name dictionary for splitting
│
├── ksd/local-outreach/orchestrator/   # KSD-specific modules
│   ├── modules/
│   │   ├── database.js                # SQLite DB (better-sqlite3, auto-backup)
│   │   ├── google-maps-scraper-outscraper.js  # Outscraper API
│   │   ├── chain-filter.js            # National chain filtering
│   │   ├── revenue-estimator.js       # Revenue estimation engine
│   │   └── tier-assigner.js           # Pricing tier assignment
│   └── data/
│       ├── businesses.db              # SQLite database (not in repo)
│       └── backups/                   # Auto-rotating backups (last 10)
│
├── exports/                           # Generated export files
│   ├── ghl-no-website-businesses.csv  # No-website businesses for GHL
│   ├── ufh-football-clubs-*-verified.csv      # Verified GM club leads (Mailead)
│   ├── ufh-chelsea-area-clubs-*-verified.csv  # Verified Chelsea club leads (Mailead)
│   ├── ufh-football-clubs-email-sequence.md   # Email sequences (GM + Chelsea)
│   ├── ufh-press-pitch.md             # Casual press pitch (Lexi/Chelsea story)
│   └── ufh-press-release.md           # Formal press release
│
└── docs/                              # Additional documentation
```

---

## Pipeline Overview

### KSD Pipeline (`batch-bramhall-all-categories.js`)

| Step | What | Tool | Cost |
|------|------|------|------|
| 1. Scrape | Google Maps business listings | Outscraper API | ~$0.002/result |
| 2a. Enrich | Website scrape + regex name/email extraction | HTTP + Playwright | Free |
| 2b. LLM Extract | Owner names + emails from website text | Claude Haiku 4.5 | ~$0.001/biz |
| 3. Verify | Email verification (website emails = auto-valid) | Reoon API | 2,100/day |
| 4. Estimate | Revenue + tier + pricing assignment | Local logic | Free |
| 5. Save | Deduplicated save to SQLite | better-sqlite3 | Free |
| 6. Export | Push to Lemlist with merge variables | Lemlist API | Free |

### UFH Pipeline (`explore → enrich → export → verify`)

| Step | What | Tool | Cost |
|------|------|------|------|
| 1. Explore | Scrape football clubs by area | Outscraper API | ~$3/1000 |
| 2. Enrich | Website scrape + LLM extraction (60s timeout) | HTTP + Haiku 4.5 | ~$0.003/biz |
| 3. Export | Clean CSV with category/email/name junk filtering | Local | Free |
| 4. Verify | Batch Reoon verification | Reoon API | 1 credit/email |

### Data Quality Filters (export --clean)

- **Junk emails:** sentry, wixpress, Google Calendar, broken Cloudflare, noreply, example, placeholder
- **Non-football categories:** 50+ categories (schools, pubs, hotels, shops, non-football sports, etc.)
- **Garbage names:** Pitchero artifacts, generic role names, broken extractions

---

## Key Scripts

### KSD Local Outreach

| Script | Purpose | Flags |
|--------|---------|-------|
| `batch-bramhall-all-categories.js` | Main scrape + enrich + export pipeline | `--dry-run`, `--scrape-only`, `--wave3`, `--new-trades` |
| `improve-emails.js` | 3-stage email improvement (LLM → Pattern+Reoon → Icypeas) | `--dry-run`, `--llm-only`, `--patterns-only`, `--icypeas-only`, `--limit=N` |
| `reexport-clean-leads.js` | Re-export verified leads to Lemlist | `--only-trades`, `--exclude-trades`, `--category=X`, `--yes` |
| `audit-lemlist-campaign.js` | Audit Lemlist campaign quality | `--verify`, `--remove` |

### Multi-Campaign Tools

| Script | Purpose | Flags |
|--------|---------|-------|
| `explore-football-clubs.js` | Scrape youth football clubs by area | `--area=gm\|chelsea\|original`, `--dry-run`, `--scrape-only` |
| `enrich-campaign.js` | Enrich any campaign (website + LLM, timeout-protected) | `--campaign=X`, `--limit=N`, `--llm-only`, `--dry-run` |
| `export-campaign.js` | Universal export with junk filtering | `--campaign=X`, `--format=csv\|mailead\|lemlist`, `--has-email`, `--clean`, `--list` |
| `verify-football-clubs.js` | Batch Reoon verification of exported CSVs | `--dry-run` |
| `import-pressranger.js` | Import PressRanger journalist/podcast CSV | `--file=X`, `--campaign=X`, `--type=journalist\|podcast`, `--verify`, `--dry-run` |

---

## Current State (Feb 2026)

### Campaigns

| Campaign | Records | Emails | Verified | Platform | Status |
|----------|---------|--------|----------|----------|--------|
| `ksd-bramhall-SK7` | ~1,370 | ~684 | ~591 | Lemlist | Paused |
| `ufh-football-clubs` | 1,042 | 516 | **255** | Mailead | Ready for Tuesday launch |
| `ufh-chelsea-area-clubs` | 504 | 267 | **144** | Mailead | Ready for Tuesday launch |

### Totals

| Metric | Count |
|--------|-------|
| Total contacts in DB | ~2,749 |
| KSD categories scraped | 70 |
| UFH areas scraped | 52 locations (36 GM + 16 Chelsea) |
| Total LLM cost | ~$1.87 |
| Reoon verifications used | ~412 |

---

## Credentials

All API keys stored in `~/.credentials/api-keys.json` (not committed):

```json
{
  "outscraper": { "apiKey": "..." },
  "anthropic": { "apiKey": "..." },
  "lemlist": { "apiKey": "..." },
  "reoon": { "apiKey": "...", "dailyLimit": 2100 },
  "icypeas": { "apiKey": "...", "userId": "..." },
  "ghl": { "locationApiKey": "..." }
}
```

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@anthropic-ai/sdk` | ^0.77.0 | Claude Haiku LLM owner extraction |
| `better-sqlite3` | ^12.6.2 | Local SQLite database |
| `playwright` | ^1.58.2 | Headless browser for JS-rendered sites |
| `openai` | ^6.22.0 | GPT-4 content generation (legacy) |

---

## Security

- API keys in `~/.credentials/` (excluded from git via `.gitignore`)
- Daily limit enforcement for Reoon (2,100/day) and Icypeas (100/day)
- Usage tracking per service per day
- No credentials in code or environment variables
- Database excluded from git (local only)
