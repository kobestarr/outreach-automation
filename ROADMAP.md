# Outreach Automation — Roadmap

**Last Updated:** February 20, 2026

---

## Completed

### Phase 1: Foundation (Feb 1–10)
- [x] Google Maps scraping via Outscraper API
- [x] Website enrichment (HTTP scraping, email/name regex extraction)
- [x] Revenue estimation + tier assignment
- [x] Lemlist export with merge variables
- [x] SQLite database with auto-backup
- [x] Chain/franchise filtering
- [x] Smart email verification (website emails = auto-valid)
- [x] Observation signal detection (6 signals)
- [x] Micro-offer pricing (5 tiers)
- [x] Currency localization (6 regions)
- [x] Category mapping (11 industry groups)

### Phase 2: Intelligence (Feb 10–16)
- [x] International name splitting with 600+ name dictionary
- [x] Email extraction from email addresses (john.smith@ → John Smith)
- [x] Multi-person extraction from team/about pages
- [x] Playwright headless browser for JS-rendered sites (Wix, Divi, Squarespace)
- [x] Website tech/age detection (CMS, WordPress version, age band)
- [x] False positive filtering hardening (150+ blocklist words)
- [x] Progressive name shortening for greedy regex captures
- [x] Multi-owner note generation for Lemlist templates

### Phase 3: Scale (Feb 16–19)
- [x] LLM owner extraction via Claude Haiku 4.5 (~$0.001/biz, ~100% precision)
- [x] Lemlist campaign audit script (data quality + email verification)
- [x] Wave 3 category expansion (21 new categories: 15 services + 6 trades)
- [x] Full pipeline run: 1,410 businesses, 70 categories, 591 Lemlist leads
- [x] 3-stage email improvement pipeline (LLM → Pattern+Reoon → Icypeas)
- [x] No-website business identification (300 businesses)
- [x] GHL CSV export for SMS/phone outreach
- [x] Trades segmentation with `tradesLeadGen` observation signal
- [x] Database `exported_to` JSON parse fix

---

## In Progress

### Phase 4: Multi-Channel (Feb 20–)
- [ ] **GoHighLevel API integration** — push no-website contacts directly via REST API
  - Location API key authentication
  - Contact creation with intelligent tagging (9 tag categories)
  - Tags: mobile/landline, trade/service/professional, category, quality, needs-website, source, campaign
  - Dedup against existing GHL contacts
  - ~273 contacts (168 mobile + 105 landline)

- [ ] **Lemlist activity pull** — fetch campaign performance data
  - New `--activity` flag on audit-lemlist-campaign.js
  - Pull bounces, opens, clicks, replies per lead
  - Cross-reference with DB for per-category/segment breakdowns
  - Flag bounced emails for removal or re-verification

---

## Planned

### Phase 5: Email Improvement at Scale
- [ ] **Run `improve-emails.js` on full DB** — currently built but not run
  - Stage 1: LLM extraction for ~700 businesses without personal emails
  - Stage 2: Pattern guessing + Reoon for ~200 businesses with owner names but no email
  - Stage 3: Icypeas for remaining high-priority leads
  - Expected outcome: +100–200 new verified personal emails

### Phase 6: Campaign Optimization
- [ ] **Unpause Lemlist campaign** — 591 leads ready
- [ ] **A/B test email templates** based on observation signal performance
- [ ] **Bounce-based email cleanup** — auto-remove bounced leads, re-verify or find alternatives
- [ ] **Reply tracking** — flag interested leads, update DB status
- [ ] **Per-category performance analysis** — which categories have best open/reply rates

### Phase 7: Geographic Expansion
- [ ] **Expand beyond Bramhall SK7** — Poynton, Cheadle Hulme, Hazel Grove, Stockport
- [ ] **Parameterize location** in batch script (currently hardcoded to Bramhall)
- [ ] **Cross-area deduplication** — businesses that serve multiple postcodes
- [ ] **Location-specific intro text** generation

### Phase 8: Automation
- [ ] **Scheduled pipeline runs** — cron/PM2 for periodic re-scraping
- [ ] **New business detection** — flag businesses that appeared since last scrape
- [ ] **Stale data refresh** — re-scrape websites older than 30 days
- [ ] **Auto-export new leads** — push to Lemlist/GHL as they're enriched
- [ ] **Webhook integration** — Lemlist reply → GHL task creation

### Phase 9: Advanced Personalization
- [ ] **LinkedIn enrichment** via Icypeas (already built, not wired in)
- [ ] **Competitor analysis** — identify businesses in same category/area
- [ ] **Seasonal messaging** — adjust hooks based on time of year (Q1 tax for accountants, summer for landscapers)
- [ ] **AI-generated first lines** — custom opening line per business using website context

---

## Backlog / Ideas

- [ ] Dashboard/UI for viewing pipeline stats and lead quality
- [ ] WhatsApp outreach integration (via GHL)
- [ ] Companies House data enrichment (director names, filing dates)
- [ ] Google Ads spend estimation from auction insights
- [ ] Review sentiment analysis for more nuanced observation signals
- [ ] Multi-location support for agencies with multiple territories
- [ ] White-label export for client campaigns
