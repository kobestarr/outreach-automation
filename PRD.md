# Outreach Automation Platform - Product Requirements Document

**Version:** 1.2.0
**Last Updated:** February 9, 2026
**Status:** Active

---

## Overview

The Outreach Automation Platform is a local business outreach system that combines automated lead discovery (via Outscraper Google Maps API) with sophisticated, personalized cold email and LinkedIn outreach using AI content generation (OpenAI GPT-4 or Anthropic Claude).

### Core Value Proposition

Enable digital agencies and service providers to run highly personalized, multi-channel outreach campaigns at scale with:
- **Category-specific messaging** tailored to 11 industry verticals
- **Observation-driven personalization** based on 6 business signals
- **Micro-offer positioning** (low-barrier entry point before full monthly package)
- **Multi-channel orchestration** (email + LinkedIn with angle differentiation)
- **Currency localization** for 6 countries/regions

---

## System Architecture

### 1. Data Collection Layer
**Technology:** Outscraper Google Maps API
**Purpose:** Automated lead discovery from Google Maps business listings

**Capabilities:**
- Location-based business discovery (postcode, radius, category)
- Business data extraction: name, category, location, reviews, rating, website, contact info
- Structured JSON output compatible with SQLite storage

**Credentials:** Managed via `shared/outreach-core/credentials-loader.js`

### 2. Content Generation Layer (Micro-Offer System v1.2)
**Technology:** OpenAI GPT-4 API **or** Anthropic Claude API (configurable via `CONTENT_PROVIDER` environment variable)
**Purpose:** Generate personalized cold emails and LinkedIn messages

**Provider Options:**
- **OpenAI (default):** GPT-4 for content generation, ~$0.01/email
- **Anthropic (recommended):** Claude Sonnet 4.5 for content generation (~$0.01/email, better quality) or Claude Haiku 4.5 for revenue estimation (~$0.003/email, 75% cheaper)

**Provider Switching:**
```bash
# Use Anthropic Claude (recommended)
export CONTENT_PROVIDER=claude

# Use OpenAI GPT-4 (default)
export CONTENT_PROVIDER=openai
```

#### 2.1 Category Mapping (`category-mapper.js`)
**11 Industry Groups:**
1. TRADESPEOPLE (plumber, electrician, builder, roofer, carpenter)
2. HEALTH_BEAUTY (salon, spa, beautician, barber, hairdresser)
3. FOOD_HOSPITALITY (restaurant, cafe, pub, hotel, catering)
4. PROFESSIONAL (accountant, solicitor, consultant, architect)
5. PROPERTY (estate agent, letting, property management)
6. FITNESS (gym, personal trainer, yoga, pilates)
7. AUTOMOTIVE (mechanic, car sales, MOT, garage, car repair)
8. HOME_SERVICES (cleaner, gardener, pest control, removals)
9. RETAIL (shop, boutique, store, retail)
10. EDUCATION (tutor, music teacher, nursery, training)
11. GENERAL (catch-all for uncategorized)

**Angle System:**
- Separate angle sets for **email** vs **LinkedIn** (ensures no repetition)
- Each category has 3 primary angles tailored to industry pain points
- Email angles focus on tactical opportunities (e.g., "response time optimization" for tradespeople)
- LinkedIn angles focus on strategic growth (e.g., "building a pipeline for quieter months")

#### 2.2 Observation Signals (`observation-signals.js`)
**6 Business Signals:**
1. `lowReviews` (<10 reviews) → hook: "growing your review count"
2. `noWebsite` (no website listed) → hook: "getting a simple site live"
3. `poorWebsite` (has website but no HTTPS/old builder) → hook: "refreshing your web presence"
4. `noSocialMedia` (no Instagram/Facebook) → hook: "building a social presence"
5. `lowRating` (<4.0 rating) → hook: "improving customer experience"
6. `highReviews` (≥50 reviews) → hook: "capitalizing on your reputation"

**Signal Priority:** lowRating > noWebsite > lowReviews > poorWebsite > noSocialMedia > highReviews

#### 2.3 Currency Localization (`currency-localization.js`)
**Supported Regions:**
- UK: £97 micro-offer / £497 full offer
- US: $127 micro-offer / $597 full offer
- Australia: A$147 micro-offer / A$697 full offer
- Canada: CA$127 micro-offer / CA$597 full offer
- New Zealand: NZ$147 micro-offer / NZ$697 full offer
- EU: €97 micro-offer / €497 full offer

**Detection Logic:** UK postcode patterns, US state abbreviations, country-specific city names (default: UK)

#### 2.4 Email Generator (`gpt-email-generator.js`)
**20-Rule Copywriting System (Anti-AI Optimized):**
- Write like a busy business owner, not a marketer
- No buzzwords, jargon, or corporate speak
- Emails under 100 words (4-5 sentences max)
- Lowercase subject lines (feels less sales-y)
- **ALWAYS start with casual greeting:** "Hi [Name]," or "Hey [Name],"
- **Reference business name ONLY** - never add location/postcode (e.g., "The Cutting Room" not "The Cutting Room in Bramhall, SK7")
- **Use plain language:** "help keeping clients" not "help with client retention", "rebooking" not "retention"
- **ALWAYS say "From just £X"** NEVER "For just £X"
- Lead with specific observation, not generic pleasantry
- Reference local context (location, competitor, category)
- One clear CTA per email (micro-offer link or calendar)
- UK English spelling and tone (or localized for country)
- No exclamation marks (feels desperate)
- Conversational tone with contractions
- Specific over generic ("22 reviews" not "some reviews")
- **ALWAYS end with "Sent from my iPhone"** (no name, no other signature - feels like quick mobile message)

**API Settings:**
- **OpenAI:** Model: `gpt-4`, Temperature: `0.7`, Max tokens: `1500`
- **Anthropic (recommended):** Model: `claude-sonnet-4-5-20250929`, Temperature: `0.7`, Max tokens: `1500`

**Output Format:**
```javascript
{
  subject: "lowercase subject line",
  body: "email body <120 words",
  fullContent: "raw AI response",
  metadata: {
    primaryHook: "lowReviews",
    toneRegion: "UK",
    categoryAngle: "First impression online...",
    categoryGroup: "TRADESPEOPLE",
    observationSignals: ["lowReviews", "noWebsite"],
    microOfferPrice: "£97",
    fullOfferPrice: "£497",
    provider: "claude",
    model: "claude-sonnet-4-5-20250929",
    temperature: 0.7,
    generatedAt: "2026-02-09T..."
  }
}
```

#### 2.5 LinkedIn Generator (`gpt-linkedin-generator.js`)
**18-Rule LinkedIn System (Anti-AI Optimized):**
- Connection notes: 1-2 sentences max (<300 chars)
- Sound human, not corporate: "I love" not "I'm intrigued by" or "amazing work"
- NO sales pitch in connection note (just context)
- **Business name ONLY:** NEVER include location - write "The Cutting Room" NOT "The Cutting Room in Bramhall"
- **NO corporate/marketing speak AT ALL:** Banned words include "differentiate", "unique value proposition", "target audience", "standing out", "crowded market", "articulate", "unique qualities", "showcase", "position", "brand identity"
- **Use plain language:** "get more clients" not "acquire customers", "keep clients coming back" not "retention strategy"
- First message: Start with "Hi [Name], I don't know if you saw my email so I thought I'd try here."
- NEVER mention resources/articles that don't exist (no fake case studies/articles)
- **Offer practical operations help** (bookings, scheduling, client communication) NOT market positioning/branding advice
- Low-pressure CTA: "Let me know if that's useful?" or "Worth a chat?"
- UK tone (professional but warm)
- **Different angle than email** (critical requirement)
- No emojis (unprofessional in B2B)
- Keep total message under 500 characters

**API Settings:**
- **OpenAI:** Model: `gpt-4`, Temperature: `0.75`, Max tokens: `800`
- **Anthropic (recommended):** Model: `claude-sonnet-4-5-20250929`, Temperature: `0.75`, Max tokens: `800`

**Functions:**
- `generateConnectionNote()` - Initial connection request (no sales pitch)
- `generateLinkedInMessage()` - First DM after acceptance (value-focused, different angle than email)

### 3. Export Layer
**Export Managers:**
- `lemlist-exporter.js` - CSV export for Lemlist platform
- `prosp-exporter.js` - CSV export for Prosp platform

**Capabilities:**
- Transform generated content into platform-specific CSV formats
- Handle custom field mappings
- Validate required fields before export

### 4. Storage Layer
**Technology:** better-sqlite3 (SQLite)
**Purpose:** Local database for lead management and campaign tracking

**Schema:** `businesses` table with columns for business data, outreach status, and timestamps

---

## Key Features

### Multi-Channel Orchestration
- **Email-first approach** with observation-driven hooks
- **LinkedIn follow-up** with differentiated angles to avoid repetition
- **Angle coordination** ensures LinkedIn doesn't repeat email's primary hook

### Personalization at Scale
- **Category-specific angles** (11 industry groups with tailored messaging)
- **Observation signals** (6 data-driven hooks for personalization)
- **Local context** (location mentions, competitor references)
- **Currency localization** (6 regions with appropriate pricing)

### Copywriting Philosophy
**Email:** Write like a busy business owner reaching out to a peer on mobile, not a marketer pitching a stranger.
- Under 100 words
- Lowercase subjects
- No buzzwords or exclamation marks
- Lead with observation, not self-introduction
- Specific over generic
- Always start with casual greeting ("Hi [Name]," or "Hey [Name],")
- Business name only (never include location)
- Plain language ("help keeping clients" not "client retention")
- "From just £X" pricing format
- End with "Sent from my iPhone" (feels spontaneous, not crafted)

**LinkedIn:** Professional but warm, value-focused, practical operations help.
- Connection notes <300 chars
- No sales pitch in connection request
- Business name only (never include location)
- No corporate/marketing speak (banned: "differentiate", "unique value proposition", "standing out", etc.)
- Plain language alternatives ("get more clients" not "acquire customers")
- First DM starts with "Hi [Name], I don't know if you saw my email so I thought I'd try here."
- Offer practical operations help (bookings, scheduling) NOT market positioning advice
- Low-pressure CTA: "Let me know if that's useful?" or "Worth a chat?"

---

## User Workflows

### Workflow 1: Single Campaign
1. Define target criteria (location, category, radius)
2. Scrape leads via Outscraper API
3. Generate personalized content (email + LinkedIn)
4. Review and approve content
5. Export to Lemlist or Prosp
6. Launch campaign

### Workflow 2: Multi-Category Campaign
1. Define multiple categories (e.g., "salon, barber, spa")
2. System auto-maps to category groups (HEALTH_BEAUTY)
3. Generate category-specific content for each lead
4. Separate export files per category (optional)
5. Launch coordinated campaigns

### Workflow 3: Multi-Region Campaign
1. Define locations across countries (UK, US, AU)
2. System auto-detects currency for each region
3. Generate localized content with appropriate pricing
4. Export with region tags
5. Launch localized campaigns

---

## Technical Requirements

### Dependencies
- Node.js 14+ (native HTTPS module, no axios/node-fetch)
- better-sqlite3 (SQLite database)
- **OpenAI API key (GPT-4 access)** OR **Anthropic API key (Claude access)** - configurable
- Outscraper API key

### File Structure
```
outreach-automation/
├── shared/
│   └── outreach-core/
│       ├── content-generation/
│       │   ├── category-mapper.js          [11 category groups + angles]
│       │   ├── observation-signals.js      [6 signal detectors]
│       │   ├── currency-localization.js    [Pricing by country]
│       │   ├── gpt-email-generator.js      [24-rule email system - OpenAI]
│       │   ├── gpt-linkedin-generator.js   [21-rule LinkedIn system - OpenAI]
│       │   ├── claude-email-generator.js   [24-rule email system - Anthropic]
│       │   ├── claude-linkedin-generator.js [21-rule LinkedIn system - Anthropic]
│       │   ├── index.js                    [Entry point/provider switcher]
│       │   └── test-micro-offer.js         [Integration tests]
│       ├── export-managers/
│       │   ├── lemlist-exporter.js
│       │   └── prosp-exporter.js
│       └── credentials-loader.js
├── ksd/
│   └── local-outreach/
│       └── orchestrator/
│           ├── main.js                     [Campaign orchestrator]
│           └── modules/
│               ├── revenue-estimator.js    [Claude Haiku revenue estimation]
│               ├── google-maps-scraper.js  [HasData scraper]
│               └── google-maps-scraper-outscraper.js [Outscraper primary]
├── MICRO_OFFER_OUTREACH_SYSTEM.md          [Comprehensive documentation]
├── PRD.md                                  [This file]
└── CHANGELOG.md                            [Version history]
```

### Testing
**Integration Tests:** `test-micro-offer.js`
- Category mapping validation (11 businesses, 1 per category)
- Observation signal detection (6 signals)
- Primary signal selection (priority ordering)
- Currency localization (6 countries)
- Email angle retrieval
- LinkedIn angle differentiation (ensures no repetition)

**Run:** `node shared/outreach-core/content-generation/test-micro-offer.js`

---

## Success Metrics

### Content Quality
- Email subject lines 100% lowercase
- Email body <100 words (95%+ compliance)
- Zero buzzwords in generated content
- LinkedIn angles differ from email angles (100%)

### Personalization Depth
- Category group correctly detected (95%+ accuracy)
- Observation signals correctly detected (90%+ accuracy)
- Local context mentioned in 80%+ of emails

### Campaign Performance
- Open rates (baseline: 40%+)
- Reply rates (baseline: 5%+)
- LinkedIn connection acceptance (baseline: 30%+)
- Micro-offer conversion (baseline: 2%+)

---

## Future Enhancements

### Phase 2: Dynamic Angle Matching
- Intelligent angle selection based on signal type
- Example: `lowReviews` signal → "Review generation system" angle

### Phase 3: A/B Testing
- Generate 2-3 subject line variations
- Split test different angles for same category
- Track performance by angle type

### Phase 4: Response Detection
- Parse email replies for interest signals
- Auto-route hot leads for immediate follow-up
- Auto-pause sequences for engaged prospects

### Phase 5: Multi-Language Support
- Extend beyond UK/US English
- Support French, German, Spanish variants
- Localized angles per language/culture

---

## Appendix

### Related Documentation
- **MICRO_OFFER_OUTREACH_SYSTEM.md** - Comprehensive micro-offer system reference (7 parts)
- **CHANGELOG.md** - Version history and release notes

### Micro-Offer Philosophy
The micro-offer (£97 UK, $127 US) is a **low-barrier entry point** before committing to full monthly package (£497 UK, $597 US). Instead of asking for a £500/month commitment upfront, offer a taster that solves a specific problem or delivers immediate value.

**Why it works:**
- Lower risk for prospect
- Easier to say "yes"
- Demonstrates value before upsell
- Positions sender as peer (business owner) not vendor (salesperson)

### Category Angle Examples

**TRADESPEOPLE (Email):**
- First impression online — most enquiries start with a Google search
- Response time optimization — being first to respond often wins the job
- Review generation system — standing out in a crowded market

**TRADESPEOPLE (LinkedIn - Different Angles):**
- Building a pipeline for quieter months — feast or famine problem
- Standing out on Google when everyone looks the same
- Professional brand without looking too corporate

**HEALTH_BEAUTY (Email):**
- Client retention and rebooking — reducing gaps in schedule
- Online booking friction — "I'll call later" often means never
- Instagram-to-client conversion — turning followers into customers

**HEALTH_BEAUTY (LinkedIn - Different Angles):**
- Client lifetime value — one client worth £5k+ over 3 years
- Standing out in a saturated market — 20 salons within 2 miles
- Social media that actually books appointments — not just likes

---

**End of PRD**
