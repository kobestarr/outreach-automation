# PRODUCTION FLOW - DEFINITIVE REFERENCE

**CRITICAL:** This document defines the EXACT order of operations. Never deviate from this flow.

**Last Updated:** 2026-02-10
**Status:** ✅ PRODUCTION READY

---

## Overview: 6-Phase Pipeline

```
Phase 1: Google Maps → Phase 2: Owner Discovery → Phase 3: Email Discovery →
Phase 4: LinkedIn Enrichment → Phase 5: Content Generation → Phase 6: Export
```

---

## Phase 1: Google Maps Scraping (Discovery)

**Tool:** Outscraper / Google Maps API
**Input:** Location, postcode, categories (e.g., "dentist", "gym", "cafe")
**Command:**
```bash
node ksd/local-outreach/orchestrator/main.js Bramhall SK7 --scrape-only
```

### What We GET:
- ✅ Business name
- ✅ Business phone number
- ✅ Business website URL
- ✅ Business address
- ✅ Business postcode
- ✅ Google rating (stars)
- ✅ Google review count
- ✅ Business category
- ✅ Business hours

### What We DO NOT GET:
- ❌ **NO owner names**
- ❌ **NO owner emails**
- ❌ **NO LinkedIn profiles**

**Database Status After Phase 1:** `"discovered"`

**Output Example:**
```json
{
  "name": "KissDental Bramhall",
  "phone": "+44 161 697 4889",
  "website": "https://kissdental.co.uk",
  "postcode": "SK7 1PA",
  "rating": 4.7,
  "reviewCount": 127,
  "category": "Dentist",
  "ownerFirstName": null,
  "ownerEmail": null
}
```

---

## Phase 2: Owner Discovery (Enrichment - Part 1)

**Tool:** Companies House API + Website Scraping
**Input:** Business data from Phase 1
**Function:** `enrichBusiness()` in `main.js`

### Step-by-Step Process:

#### Step 2.0: Scrape Website
- **Action:** Fetch website HTML and extract:
  - Company registration number
  - Owner names from "About" or "Team" pages
  - Registered address
- **Output:** `websiteData.registrationNumber`, `websiteData.ownerNames[]`

#### Step 2.1a: Companies House (via Registration Number)
- **If:** Registration number found on website
- **Action:** Query Companies House API: `GET /company/{regNumber}/officers`
- **Output:** List of ALL officers (up to 5) with full names and titles
- **Source:** `"companies-house"`

#### Step 2.1b: Website Scraping (Fallback)
- **If:** No registration number found
- **Action:** Use `websiteData.ownerNames[]` from website scraping
- **Output:** Owner names extracted from "About Us" or "Team" pages
- **Source:** `"website-scraping"`

#### Step 2.1c: Companies House (via Name Search)
- **If:** No owners from registration number or website
- **Action:** Query Companies House API: `GET /search/companies?q={businessName}`
- **Match:** Postcode-based verification
- **Output:** Company match + list of officers
- **Source:** `"companies-house-search"`

#### Step 2.2: Parse Owner Names
- **Action:** Split full names into `firstName` and `lastName`
- **Store:** `business.ownerFirstName`, `business.ownerLastName`, `business.ownerFullName`

### What We GET:
- ✅ Owner first names (e.g., "Kailesh", "Callum")
- ✅ Owner last names (e.g., "Solanki", "Coombs")
- ✅ Owner titles (e.g., "Director", "Secretary")
- ✅ Up to 5 owners per business

### What We DO NOT GET:
- ❌ **NO owner emails** (yet)
- ❌ **NO LinkedIn profiles** (yet)

**Database Status After Phase 2:** Still `"discovered"` (not yet enriched)

**Output Example:**
```json
{
  "name": "KissDental Bramhall",
  "ownerFirstName": "Kailesh",
  "ownerLastName": "Solanki",
  "ownerFullName": "Kailesh Solanki",
  "ownerEmail": null,
  "owners": [
    {
      "firstName": "Kailesh",
      "lastName": "Solanki",
      "fullName": "Kailesh Solanki",
      "title": "Director",
      "source": "companies-house"
    },
    {
      "firstName": "Callum",
      "lastName": "Coombs",
      "fullName": "Callum Coombs",
      "title": "Director",
      "source": "companies-house"
    }
  ]
}
```

---

## Phase 3: Email Discovery (Enrichment - Part 2)

**Tool:** ICYPeas (LinkedIn-based email finder)
**Input:** Business data + owner names from Phase 2
**Function:** `discoverEmail()` in `shared/outreach-core/email-discovery`

### ICYPeas Quota Management:
- **First 2 owners:** Use ICYPeas API (costs credits)
- **Remaining owners (3-5):** Pattern matching (e.g., `firstname.lastname@domain.com`)

### Step-by-Step Process:

#### Step 3.1: Extract Domain
- **Action:** Parse website URL to get domain (e.g., `kissdental.co.uk`)

#### Step 3.2: ICYPeas Email Discovery (Owners 1-2)
- **API Call:** `POST /enrich-email`
- **Payload:**
  ```json
  {
    "firstName": "Kailesh",
    "lastName": "Solanki",
    "companyDomain": "kissdental.co.uk"
  }
  ```
- **Response:** `{ "email": "kailesh.solanki@kissdental.co.uk", "verified": true }`

#### Step 3.3: Pattern Matching (Owners 3-5)
- **If:** Owner 3+ (to save ICYPeas credits)
- **Action:** Generate email patterns:
  - `firstname.lastname@domain.com`
  - `firstname@domain.com`
  - `f.lastname@domain.com`
- **Verification:** DNS MX record check (not full SMTP verification)

#### Step 3.4: Store Emails
- **Action:** Add `email`, `emailSource`, `emailVerified` to each owner object
- **Store:** `business.owners[]` array with email data

### What We GET:
- ✅ **Owner emails** (e.g., `kailesh.solanki@kissdental.co.uk`)
- ✅ Email verification status (true/false)
- ✅ Email source ("icypeas", "pattern-match", "website")

### What We DO NOT GET (yet):
- ❌ **NO LinkedIn profiles** (that's Phase 4)

**Database Status After Phase 3:** `"enriched"`

**Output Example:**
```json
{
  "name": "KissDental Bramhall",
  "ownerEmail": "kailesh.solanki@kissdental.co.uk",
  "owners": [
    {
      "firstName": "Kailesh",
      "lastName": "Solanki",
      "email": "kailesh.solanki@kissdental.co.uk",
      "emailSource": "icypeas",
      "emailVerified": true
    },
    {
      "firstName": "Callum",
      "lastName": "Coombs",
      "email": "callum@kissdental.co.uk",
      "emailSource": "icypeas",
      "emailVerified": true
    }
  ]
}
```

---

## Phase 4: LinkedIn Enrichment (Optional)

**Tool:** ICYPeas LinkedIn scraper
**Input:** Business data + owner names from Phase 2
**Function:** `enrichLinkedIn()` in `shared/outreach-core/linkedin-enrichment`

### What This Does:
- **Finds:** LinkedIn profile URL for first owner only
- **Scrapes:** Profile data (headline, company, title, location)
- **Stores:** `business.linkedInUrl`, `business.linkedInData`

### ICYPeas API Call:
```json
POST /enrich-linkedin
{
  "firstName": "Kailesh",
  "lastName": "Solanki",
  "companyName": "KissDental"
}
```

**Response:**
```json
{
  "linkedInUrl": "https://linkedin.com/in/kailesh-solanki-12345",
  "headline": "Director at KissDental Bramhall",
  "location": "Stockport, UK"
}
```

### What We GET:
- ✅ LinkedIn profile URL (first owner only)
- ✅ LinkedIn headline
- ✅ LinkedIn location

**Database Status After Phase 4:** Still `"enriched"`

---

## Phase 5: Content Generation (AI)

**Tool:** Claude/Anthropic API
**Input:** Enriched business data from Phases 1-4
**Function:** `generateOutreachContent()` in `shared/outreach-core/content-generation`

### What This Does:
- **Generates:** 4-email sequence personalized to business
- **Uses:** Merge variables (proximity, observation signals, tiered pricing)
- **Approval:** First email per category requires manual approval

### Approval Workflow:
1. First dentist → Pause for approval
2. User approves via CLI: `node shared/outreach-core/approval-system/approve-cli.js`
3. Remaining dentists use approved template
4. First gym → Pause for approval (new category)
5. Repeat...

**Database Status After Phase 5:** `"content_generated"`

---

## Phase 6: Export to Lemlist/Prosp

**Tool:** Lemlist API / Prosp API
**Input:** Business + content + owners from Phases 1-5
**Function:** `exportToLemlist()` or `exportToProsp()` in `shared/outreach-core/export-managers`

### What This Does:
- **Creates:** Lead record in Lemlist campaign
- **Populates:** All 9 merge variables
- **Sets up:** 4-email sequence with delays (Day 0, 3, 7, 14)

### Merge Variables Populated:
1. `{{firstName}}` - First owner's first name
2. `{{lastName}}` - First owner's last name
3. `{{companyName}}` - Business name
4. `{{location}}` - City/town
5. `{{businessType}}` - Plural category (e.g., "dentists")
6. `{{localIntro}}` - Proximity-based intro
7. `{{observationSignal}}` - Business-specific hook
8. `{{meetingOption}}` - In-person or phone
9. `{{microOfferPrice}}` - Tiered pricing
10. `{{multiOwnerNote}}` - Multi-owner acknowledgment

### Multi-Owner Export:
- **If:** 2+ owners with emails
- **Action:** Create separate lead for each owner
- **Result:** Each owner receives personalized email with `{{multiOwnerNote}}`

**Database Status After Phase 6:** `"exported"`

---

## Command Reference

### Full Pipeline (All Phases):
```bash
node ksd/local-outreach/orchestrator/main.js Bramhall SK7 "dentists,gyms,cafes"
```

### Phase 1 Only (Google Maps Scraping):
```bash
node ksd/local-outreach/orchestrator/main.js Bramhall SK7 --scrape-only
```

### Phases 2-3 Only (Owner + Email Enrichment):
```bash
node ksd/local-outreach/orchestrator/main.js Bramhall SK7 --enrich-only
```

### Phases 5-6 Only (Content + Export):
```bash
node ksd/local-outreach/orchestrator/main.js Bramhall SK7 --export-only
```

### Resume After Approval:
```bash
node ksd/local-outreach/orchestrator/utils/resume-approval.js Bramhall SK7
```

---

## Critical Reminders

### ❌ NEVER ASSUME:
- ❌ Google Maps provides owner names → **FALSE** (need Companies House)
- ❌ Google Maps provides emails → **FALSE** (need ICYPeas)
- ❌ Outscraper gives contact data → **FALSE** (only phone/website)
- ❌ Website has email → **MAYBE** (need to scrape or use ICYPeas)

### ✅ ALWAYS VERIFY:
- ✅ Business has `owners` array before exporting
- ✅ At least one owner has `email` field populated
- ✅ Email is from ICYPeas or verified pattern match
- ✅ Check database `status` field before each phase

---

## Testing the Full Pipeline

### Test Command (10 businesses):
```bash
node ksd/local-outreach/orchestrator/main.js Bramhall SK7 "dentists" --limit 10
```

### Expected Output:
```
Phase 1: Google Maps → 10 businesses discovered
Phase 2: Owner Discovery → 10 businesses with owner names
Phase 3: Email Discovery → 8-10 businesses with owner emails (some may fail)
Phase 4: LinkedIn Enrichment → 8-10 LinkedIn profiles found
Phase 5: Content Generation → First dentist pauses for approval
Phase 6: Export → 8-10 businesses exported to Lemlist (16-20 leads if multi-owner)
```

---

## Error Handling

### Common Failures & Recovery:

**Error:** "No owner firstName found - skipping business"
**Cause:** Companies House has no directors listed
**Recovery:** Skip business, log warning, continue to next

**Error:** "ICYPeas quota exceeded"
**Cause:** API rate limit reached
**Recovery:** Use pattern matching for remaining owners

**Error:** "Lemlist API error: duplicate email"
**Cause:** Business already exported
**Recovery:** Skip export, mark as "exported" in database

---

## Database Status Flow

```
null → "discovered" → "enriched" → "content_generated" → "exported"
```

**Query by Status:**
```javascript
// Get businesses ready for enrichment
loadBusinesses({ status: "discovered" })

// Get businesses ready for export
loadBusinesses({ status: "enriched" })

// Get businesses already exported
loadBusinesses({ status: "exported" })
```

---

## ICYPeas Usage & Costs

### What ICYPeas Provides:
1. **Email Discovery:** Finds work email for owner (Phase 3)
2. **LinkedIn Enrichment:** Finds LinkedIn profile URL (Phase 4)

### Quota Management:
- **Per business:** 2 ICYPeas calls (first 2 owners)
- **10 businesses:** 20 ICYPeas calls
- **100 businesses:** 200 ICYPeas calls

### Cost Estimate:
- ICYPeas: ~£0.10 per email found
- 100 businesses (200 owners): ~£20 in ICYPeas credits

---

## Production Checklist

Before running full production:

- [ ] `.env` file exists with `LEMLIST_API_KEY` and `LEMLIST_CAMPAIGN_ID`
- [ ] ICYPeas API key configured
- [ ] Companies House API key configured
- [ ] Anthropic API key configured (for Claude)
- [ ] Database file exists at `ksd/local-outreach/orchestrator/data/businesses.db`
- [ ] Approval queue cleared: `rm shared/outreach-core/data/approval-queue.json`
- [ ] Test with 5-10 businesses first
- [ ] Verify Lemlist merge variables populate correctly
- [ ] Check email preview in Lemlist UI before launching campaign

---

**END OF PRODUCTION FLOW**
