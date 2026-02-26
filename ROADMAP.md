# Outreach Automation — Roadmap

**Last Updated:** February 26, 2026

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

### Phase 4: UFH Campaign Launch (Feb 20–26)
- [x] **Multi-area football club scrapes** — configurable area system in `explore-football-clubs.js`
  - GM + East Cheshire: 1,042 clubs across 30+ areas
  - Chelsea-area: 504 clubs across 16 areas near Stamford Bridge
- [x] **Website enrichment + LLM extraction** — `enrich-campaign.js` with timeout protection
  - Regex + Haiku 4.5 extraction, total LLM cost ~$0.87
- [x] **Reoon batch verification** — `verify-football-clubs.js`
  - 399 verified leads (323 valid + 63 risky, 26 invalid removed)
- [x] **Category-based junk filtering** — 50+ non-football categories, junk email patterns, garbage names
- [x] **Mailead CSV export** — `export-campaign.js --clean --format=mailead`
  - First name fallback ("there" for empty fields)
  - Two CSVs: GM (255 leads) + Chelsea (144 leads)
- [x] **Email sequences written** — 3 emails each (Day 0/3/7)
  - GM: voice notes + regional exclusivity
  - Chelsea: Lexi mascot story as local hook
- [x] **PressRanger import** — 182 contacts (38 podcasts + 144 journalists)
  - Column mapping fixes, email dedup, cross-journalist dedup fix
  - Reoon verified: 124 journalists + 25 podcasts
- [x] **Lemlist journalist push** — 124 leads to campaign `cam_jA8fsD4fbZxv7GYjf`
  - 2-email press sequence (Lexi's voice note story)
- [x] **Mailead AI training doc** — comprehensive auto-reply knowledge base
  - Books, podcast, voice notes, Lexi story, FAQ, all links
- [x] **Press materials** — casual pitch + formal press release for Lexi/Chelsea mascot story

---

## In Progress

### Phase 5: Campaign Monitoring + Optimisation
- [ ] **Monitor Mailead campaigns** — track opens, replies, bounces across GM + Chelsea
- [ ] **Monitor Lemlist press campaign** — track journalist engagement
- [ ] **Lemlist activity pull** — fetch campaign performance data
  - New `--activity` flag on audit-lemlist-campaign.js
  - Pull bounces, opens, clicks, replies per lead
  - Cross-reference with DB for per-category/segment breakdowns
  - Flag bounced emails for removal or re-verification
- [ ] **Podcast outreach** — 25 verified podcast contacts (not yet pushed to Lemlist)
  - Needs different greeting format (firstName = show name)
- [ ] **GoHighLevel API integration** — push no-website contacts directly via REST API

---

## Planned

### Phase 6: KSD Campaign Relaunch
- [ ] **Run `improve-emails.js` on full KSD DB** — currently built but not run
  - Stage 1: LLM extraction for ~700 businesses without personal emails
  - Stage 2: Pattern guessing + Reoon for ~200 businesses with owner names but no email
  - Stage 3: Icypeas for remaining high-priority leads
- [ ] **Unpause Lemlist campaign** — 591 leads ready
- [ ] **A/B test email templates** based on observation signal performance
- [ ] **Bounce-based email cleanup** — auto-remove bounced leads, re-verify or find alternatives

### Phase 7: Geographic Expansion
- [ ] **Expand KSD beyond Bramhall SK7** — Poynton, Cheadle Hulme, Hazel Grove, Stockport
- [ ] **Expand UFH to more regions** — Midlands, North West, South East
- [ ] **Cross-area deduplication** — businesses that serve multiple postcodes

### Phase 8: Automation
- [ ] **Scheduled pipeline runs** — cron/PM2 for periodic re-scraping
- [ ] **New business detection** — flag businesses that appeared since last scrape
- [ ] **Auto-export new leads** — push to Lemlist/GHL as they're enriched
- [ ] **Webhook integration** — Lemlist reply → GHL task creation

### Phase 9: Advanced Personalization
- [ ] **LinkedIn enrichment** via Icypeas (already built, not wired in)
- [ ] **AI-generated first lines** — custom opening line per business using website context
- [ ] **Seasonal messaging** — adjust hooks based on time of year

---

## Backlog / Ideas

- [ ] Dashboard/UI for viewing pipeline stats and lead quality
- [ ] WhatsApp outreach integration (via GHL)
- [ ] Companies House data enrichment (director names, filing dates)
- [ ] Google Ads spend estimation from auction insights
- [ ] Review sentiment analysis for more nuanced observation signals
- [ ] Multi-location support for agencies with multiple territories
- [ ] White-label export for client campaigns
