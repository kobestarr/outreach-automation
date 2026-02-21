# Outreach Automation Platform — Product Requirements Document

**Version:** 2.2.0
**Last Updated:** February 21, 2026
**Status:** Active — Bramhall SK7 + UFH Football Clubs campaigns

---

## 1. Overview

The Outreach Automation Platform is a multi-campaign outreach system that discovers businesses via Google Maps, enriches them with website data and AI-extracted owner information, imports contacts from external sources (PressRanger), and exports to multi-channel outreach tools (Lemlist for email, GoHighLevel for SMS/phone, CSV for manual outreach).

### Core Value Proposition

Enable hyper-personalized, multi-channel outreach at scale across multiple campaigns:
- **Multi-campaign architecture** — businesses can belong to multiple campaigns simultaneously
- **70 business categories** across professional services, consumer services, and trades
- **AI-powered owner extraction** (Claude Haiku 4.5, ~$0.001/business)
- **7 observation-driven personalization signals** for email hooks
- **Tiered micro-offer pricing** based on revenue estimation
- **Smart email verification** that preserves API credits
- **Multi-channel export** — email (Lemlist) + SMS/phone (GoHighLevel) + CSV
- **External data import** — PressRanger journalist/podcast CSV import with Reoon verification

### Target Market

- **KSD Local Outreach:** Local businesses in Bramhall SK7 and surrounding South Manchester postcodes
- **UFH Campaign:** Youth football clubs, journalists, and podcasts for Ultimate Football Heroes podcast/book promotion

---

## 2. System Architecture

### 2.1 Data Collection Layer

**Technology:** Outscraper Google Maps API
**Cost:** ~$0.002 per result

Scrapes Google Maps business listings by category + location, returning:
- Business name, category, address, postcode
- Phone number, website URL
- Rating, review count
- Google Maps place ID (used for deduplication)

**Chain Filtering:** National chains (Costa, Greggs, Tesco etc.) are automatically filtered out to focus on independent local businesses.

### 2.2 Enrichment Layer

**Website Scraping** (HTTP + Playwright)
- Standard HTTP fetch first (fast)
- Playwright headless browser fallback for JS-rendered sites (Wix, Divi, Squarespace)
- Scrapes homepage + about/team/contact pages
- Extracts: emails (regex), owner names (regex patterns), social media URLs

**LLM Owner Extraction** (Claude Haiku 4.5)
- Triggered only when regex finds no owner name
- Sends cleaned website text to Haiku with structured extraction prompt
- Returns: owner names + roles, all visible email addresses
- Precision: ~100% (vs ~70% for regex alone)
- Cost: ~$0.001 per business ($1.00 for 1,000 businesses)

**Tech Detection:**
- CMS identification (WordPress, Wix, Squarespace, Shopify, etc.)
- WordPress version extraction
- Website age estimation (pre-2010 / 2010-2015 / 2015-2020 / 2020+)

### 2.3 Email Discovery & Verification

**Three-stage email improvement pipeline** (`improve-emails.js`):

| Stage | Method | Cost | Daily Limit |
|-------|--------|------|-------------|
| 1. LLM Extract | Claude Haiku reads website text | ~$0.001/biz | Unlimited |
| 2. Pattern + Reoon | Generate firstname@domain patterns, verify via Reoon | $0/pattern + Reoon credit | 2,100/day |
| 3. Icypeas | Name + domain email finder API | 1 credit/search | 100/day |

**Smart Verification Policy:**
- Website-scraped emails = **auto-valid** (business published it themselves, skip Reoon)
- Pattern-guessed emails = Reoon verification required
- Icypeas-found emails = verified by Icypeas (certainty score returned)

### 2.4 Revenue Estimation & Pricing

**Revenue Estimation:**
- Based on category, review count, rating, and location
- Outputs: estimated annual revenue, revenue band, confidence score

**Tier Assignment (5 tiers):**

| Tier | Target Revenue | Micro-Offer | Monthly |
|------|---------------|-------------|---------|
| Tier 1 | < £100K | £97 | £497 |
| Tier 2 | £100K–£250K | ~£145 | ~£745 |
| Tier 3 | £250K–£500K | ~£194 | ~£994 |
| Tier 4 | £500K–£1M | ~£242 | ~£1,242 |
| Tier 5 | £1M+ | ~£485 | ~£2,485 |

### 2.5 Content Generation & Personalization

**Observation Signals (7 signals, priority-ordered):**

| Priority | Signal | Trigger | Hook |
|----------|--------|---------|------|
| 1 | tradesLeadGen | Trade category | "cutting your lead gen costs" |
| 2 | lowRating | < 4.0 stars | "improving customer experience" |
| 3 | noWebsite | No website | "getting a simple site live" |
| 4 | lowReviews | < 10 reviews | "growing your review count" |
| 5 | poorWebsite | No HTTPS / DIY builder | "refreshing your web presence" |
| 6 | noSocialMedia | No Instagram/Facebook | "building a social presence" |
| 7 | highReviews | 50+ reviews | "capitalizing on your reputation" |

**Merge Variables (Lemlist):**
- `localIntro` — proximity-based ("pretty close to you" / "across the UK")
- `observationSignal` — primary business hook text
- `meetingOption` — in-person vs phone based on postcode proximity
- `microOfferPrice` — tiered pricing based on revenue band
- `multiOwnerNote` — shown when contacting multiple people at same business
- `noNameNote` — shown when owner name couldn't be found
- `businessType` — category-mapped business type
- `location` — business location for template use

**Name Resolution (4-level fallback):**
1. Valid owner name from DB (regex or LLM extracted)
2. Name extracted from email address (e.g. john.smith@ → John)
3. "Team" (for multi-owner businesses)
4. "there" (final fallback — "Hi there,")

### 2.6 Export Layer

**Lemlist (Email Outreach):**
- REST API integration via `lemlist-exporter.js`
- Pushes leads with all merge variables
- Campaign: `cam_bJYSQ4pqMzasQWsRb` ("Local outreach Test Campaign")
- Supports: add lead, fetch leads, unsubscribe, update sequences
- Activity API: can pull opens, clicks, bounces, replies per lead

**GoHighLevel (SMS/Phone Outreach) — Planned:**
- Location API key (sub-account scoped)
- Target: ~300 no-website businesses with phone numbers
- Contact creation with intelligent tagging:
  - Contact type: `mobile`, `landline`, `no-phone`
  - Segment: `trade`, `service`, `professional`
  - Category: specific category name
  - Quality: `high-rating` (4.0+), `reviewed` (3+ reviews)
  - Offer angle: `needs-website`
  - Source: `google-maps`, `bramhall-sk7`
  - Campaign: `google-maps-scraping-campaign`

### 2.7 Multi-Campaign System

**Campaign Architecture:**
- `campaigns` column stores a JSON array of campaign tags per business (e.g., `["ksd-bramhall-SK7", "ufh-football-clubs"]`)
- Businesses can belong to multiple campaigns simultaneously (e.g., a journalist contacted for UFH and another project)
- Campaign merge on save: new tags are appended to existing ones, deduplicated via Set
- Campaign filter on load: `loadBusinesses({ campaign: 'ufh-football-clubs' })` uses SQL LIKE on JSON array
- Helper functions: `addCampaignToBusiness()`, `listCampaigns()`
- Universal export: `export-campaign.js` supports `--campaign=X --format=csv|lemlist`

**Active Campaigns:**

| Campaign | Type | Records | Description |
|----------|------|---------|-------------|
| `ksd-bramhall-SK7` | Local business outreach | ~1,370 | KSD agency services to Bramhall businesses |
| `ufh-football-clubs` | Podcast/book promotion | ~125 | UFH podcast outreach to youth football clubs |

### 2.8 External Data Import

**PressRanger Integration** (`import-pressranger.js`):
- Imports journalist, podcast, and publisher contacts from PressRanger CSV exports
- Auto-detects CSV column names (~50 header variants mapped)
- Validates emails (filters tracking addresses, junk domains)
- Optional Reoon verification before saving
- Deduplicates against existing DB records
- Stores all raw PressRanger data in business JSON blob
- Supports `--type=journalist|podcast|publisher` for contact classification

**PressRanger (Tier 2 LTD):**
- 500K+ journalist profiles, 200K+ podcast profiles, 160K+ publisher profiles
- 2,000 CSV exports/month
- Search by topic/beat, location, recent activity
- No API — CSV export only, fed into import pipeline

### 2.9 Data Storage

**SQLite Database** (`ksd/local-outreach/orchestrator/data/businesses.db`):
- Schema: businesses table with 25+ columns + campaigns JSON + business_data JSON blob
- Deduplication: placeId-based across categories + name+postcode + website domain + address
- Auto-backup on every init to `data/backups/` (keeps last 10)
- Auto-restore on 0-byte database detection
- Driver: better-sqlite3 (synchronous, fast)

---

## 3. Business Categories (70 Total)

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

## 4. Data Quality & Validation

### Name Validation (`data-quality.js`)
- 150+ blocklist words (job titles, UI elements, brand names, locations, departments)
- Progressive name shortening for greedy regex captures
- Known short surname allowlist (50+ entries: Li, Wu, Gil, Paz, etc.)
- Minimum 3-character last name requirement
- Unicode/emoji stripping before extraction

### Email Validation
- RFC 5322 simplified format check
- Image file rejection (extensions, size patterns)
- Placeholder domain rejection (example.com, test.com)
- Internal tracking domain rejection (sentry.io, wix.com, etc.)
- Hex hash username rejection (tracking IDs)

### Lead Confidence Scoring (0–100)
- Email quality: 40 points (20 valid + 20 verified)
- Name quality: 30 points (15 first + 15 last)
- Source quality: 20 points (Icypeas 20 / pattern 15 / website 10)
- Additional data: 10 points (LinkedIn 5 + phone 5)

---

## 5. API Integrations

| Service | Purpose | Daily Limit | Cost |
|---------|---------|-------------|------|
| Outscraper | Google Maps scraping | Per-credit | ~$0.002/result |
| Anthropic (Haiku) | LLM owner extraction | Unlimited | ~$0.001/business |
| Reoon | Email verification (SMTP power mode) | 2,100/day | Lifetime deal |
| Icypeas | Email discovery | 100/day | Per-credit |
| Lemlist | Email campaign management | Unlimited | Subscription |
| GoHighLevel | CRM + SMS/phone | Unlimited | Subscription |
| PressRanger | Journalist/podcast contact database | 2,000 CSV exports/mo | Lifetime deal (Tier 2) |

---

## 6. Current Metrics (Feb 2026)

### KSD Bramhall Campaign

| Metric | Value |
|--------|-------|
| Total businesses in DB | ~1,370 |
| Categories scraped | 70 |
| Lemlist campaign leads | ~591 |
| Emails found | ~684 (all auto-valid) |
| Owner names extracted | ~513 |
| No-website businesses | ~300 |
| Total LLM extraction cost | ~$1.00 |
| Campaign status | Paused |

### UFH Football Clubs Campaign

| Metric | Value |
|--------|-------|
| Total clubs/academies | 125 |
| Locations scraped | Bramhall SK7 + Poynton SK12 |
| With email | 76 (61%) |
| With phone | 95 (76%) |
| With contact name | 48 (38%) |
| Enrichment LLM cost | ~$0.09 |
| Campaign status | Email sequence drafted (4 emails) |

---

## 7. Non-Functional Requirements

### Security
- All API keys stored outside repo (`~/.credentials/api-keys.json`)
- No credentials in code, environment variables, or git history
- Daily limit enforcement prevents accidental API overspend

### Reliability
- SQLite auto-backup on every database init
- Auto-restore from backup on corrupt/empty database detection
- Circuit breaker pattern for external API calls
- Retry logic with exponential backoff (Icypeas polling)

### Performance
- Sequential processing with rate limiting to respect API limits
- Smart page prioritization (team/contact pages first, blog/news last)
- Early exit after finding 3+ people from subpages
- Playwright launched only when JS rendering detected (not for every site)

### Cost Efficiency
- LLM extraction only for businesses where regex fails (~60% of total)
- Website emails skip verification (auto-valid policy)
- Reoon credits preserved for pattern-guessed/Icypeas emails only
- Total enrichment cost: ~$0.002/business average
