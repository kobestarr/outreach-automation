# Outreach Automation System

AI-powered local business outreach platform. Scrapes Google Maps, enriches with website data, extracts owner names via LLM, discovers and verifies emails, estimates revenue, and exports to Lemlist (email) and GoHighLevel (SMS/phone).

**Built for:** KSD (Kobi Omenaka), targeting Bramhall SK7 and surrounding South Manchester postcodes.

---

## Quick Start

```bash
npm install
npx playwright install chromium

# Dry run — see what would be scraped (no API calls)
node batch-bramhall-all-categories.js --dry-run

# Scrape + enrich + save to DB (no Lemlist export)
node batch-bramhall-all-categories.js --scrape-only

# Full pipeline including Lemlist export
node batch-bramhall-all-categories.js

# Wave 3 categories only (services + more trades)
node batch-bramhall-all-categories.js --wave3
```

### Prerequisites

- **Node.js** 18+
- **Credentials** at `~/.credentials/api-keys.json` (Outscraper, Anthropic, Reoon, Icypeas, Lemlist, GHL)
- **Playwright** browsers installed via `npx playwright install chromium`

---

## Architecture

```
outreach-automation/
├── batch-bramhall-all-categories.js   # Main pipeline orchestrator
├── improve-emails.js                  # 3-stage email improvement
├── reexport-clean-leads.js            # Re-export verified leads to Lemlist
├── audit-lemlist-campaign.js          # Audit + verify campaign leads
├── rescrape-all-websites.js           # Re-scrape websites with Playwright
├── verify-and-export.js               # Verify emails then export
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
│   │   └── reoon-verifier.js          # Reoon verification (500/day limit)
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
│   └── ghl-no-website-businesses.csv  # No-website businesses for GHL
│
└── docs/                              # Additional documentation
```

---

## Pipeline Overview

The main pipeline (`batch-bramhall-all-categories.js`) runs these steps:

| Step | What | Tool | Cost |
|------|------|------|------|
| 1. Scrape | Google Maps business listings | Outscraper API | ~$0.002/result |
| 2a. Enrich | Website scrape + regex name/email extraction | HTTP + Playwright | Free |
| 2b. LLM Extract | Owner names + emails from website text | Claude Haiku 4.5 | ~$0.001/biz |
| 3. Verify | Email verification (website emails = auto-valid) | Reoon API | 500/day |
| 4. Estimate | Revenue + tier + pricing assignment | Local logic | Free |
| 5. Save | Deduplicated save to SQLite | better-sqlite3 | Free |
| 6. Export | Push to Lemlist with merge variables | Lemlist API | Free |

### Smart Email Verification

Website-scraped emails are **auto-valid** (the business published it themselves). Only pattern-guessed or Icypeas-found emails go through Reoon verification. This saves ~80% of Reoon credits.

### Owner Extraction Strategy

1. **Regex first** (free) — extracts names from common HTML patterns
2. **LLM fallback** (Claude Haiku, ~$0.001/biz) — for businesses where regex finds nothing
3. LLM achieves ~100% precision vs ~70% for regex alone

---

## Key Scripts

| Script | Purpose | Flags |
|--------|---------|-------|
| `batch-bramhall-all-categories.js` | Main scrape + enrich + export pipeline | `--dry-run`, `--scrape-only`, `--wave3`, `--new-trades` |
| `improve-emails.js` | 3-stage email improvement (LLM → Pattern+Reoon → Icypeas) | `--dry-run`, `--llm-only`, `--patterns-only`, `--icypeas-only`, `--limit=N` |
| `reexport-clean-leads.js` | Re-export verified leads to Lemlist | `--only-trades`, `--exclude-trades`, `--category=X`, `--yes` |
| `audit-lemlist-campaign.js` | Audit Lemlist campaign quality | `--verify`, `--remove` |
| `rescrape-all-websites.js` | Re-scrape all websites with Playwright | — |
| `verify-and-export.js` | Verify unverified emails then export | — |

---

## Business Categories (70 total)

### Wave 1 — Professional Services (12)
accountants, solicitors, financial advisers, architects, surveyors, insurance brokers, mortgage brokers, estate agents, opticians, dentists, veterinary surgeons, physiotherapists

### Wave 1 — Consumer Services (23)
hairdressers, beauty salons, barbers, florists, dry cleaners, restaurants, cafes, takeaways, gyms, yoga studios, driving schools, tutors, pet groomers, nail salons, tattoo parlours, jewellers, tailors, picture framers, furniture shops, garden centres, travel agents, funeral directors, car dealerships

### Wave 2 — Trades (17)
plumbers, electricians, roofers, builders, painters and decorators, landscapers, fencing contractors, bathroom fitters, kitchen fitters, heating engineers, glaziers, handymen, window cleaners, driveway contractors, tree surgeons, locksmiths, pest control, carpet cleaners

### Wave 3 — Services (15)
photographers, interior designers, web designers, counsellors, osteopaths, massage therapists, caterers, removal companies, dry cleaners, chiropodists, dog walkers, dance schools, martial arts, pilates studios, music teachers

### Wave 3 — Trades (6)
scaffolders, skip hire, tyre fitters, garage door installers, aerial installers, security systems installers

---

## Observation Signals (Email Personalization)

Each business gets a primary "hook" for email personalization based on detected signals:

| Signal | Trigger | Hook Text |
|--------|---------|-----------|
| tradesLeadGen | Trade category (highest priority) | "cutting your lead gen costs" |
| lowRating | < 4.0 stars | "improving customer experience" |
| noWebsite | No website found | "getting a simple site live" |
| lowReviews | < 10 reviews | "growing your review count" |
| poorWebsite | No HTTPS, DIY builders | "refreshing your web presence" |
| noSocialMedia | No Instagram/Facebook | "building a social presence" |
| highReviews | 50+ reviews | "capitalizing on your reputation" |

---

## Multi-Channel Export Strategy

### Lemlist (Email Outreach)
- **Target:** Businesses with verified email addresses (~591 leads)
- **Merge variables:** localIntro, observationSignal, meetingOption, microOfferPrice, multiOwnerNote, noNameNote, businessType, location
- **Campaign ID:** `cam_bJYSQ4pqMzasQWsRb`

### GoHighLevel (SMS/Phone Outreach) — Planned
- **Target:** No-website businesses (~300) with phone numbers
- **Tags:** mobile/landline, trade/service/professional, category, high-rating, reviewed, needs-website, google-maps, bramhall-sk7, google-maps-scraping-campaign
- **API:** Location API key (sub-account scoped)

---

## Current State (Feb 2026)

| Metric | Count |
|--------|-------|
| Businesses in DB | ~1,410 |
| Categories scraped | 70 |
| Lemlist leads | ~591 (paused) |
| Emails found | ~684 (all website-scraped, auto-valid) |
| Owner names | ~513 (regex + LLM) |
| No-website businesses | ~300 (for GHL phone/SMS) |
| Total LLM cost | ~$1.00 |

---

## Credentials

All API keys stored in `~/.credentials/api-keys.json` (not committed):

```json
{
  "outscraper": { "apiKey": "..." },
  "anthropic": { "apiKey": "..." },
  "lemlist": { "apiKey": "..." },
  "reoon": { "apiKey": "..." },
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
- Daily limit enforcement for Reoon (500/day) and Icypeas (100/day)
- Usage tracking per service per day
- No credentials in code or environment variables
- Database excluded from git (local only)
