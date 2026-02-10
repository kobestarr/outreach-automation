# Outreach Automation - System Architecture

**Version:** 1.0.0
**Last Updated:** 2026-02-10

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Module Directory](#module-directory)
3. [Complete Process Flow](#complete-process-flow)
4. [Data Enrichment Strategy](#data-enrichment-strategy)
5. [Email and Name Matching Logic](#email-and-name-matching-logic)
6. [Module Details](#module-details)
7. [Decision Trees](#decision-trees)

---

## System Overview

The Outreach Automation system is a **multi-stage pipeline** that:

1. **Discovers** local businesses via Google Maps scraping
2. **Enriches** business data with owner names, emails, and business intelligence
3. **Generates** personalized merge variables for email templates
4. **Exports** leads to outreach platforms (Lemlist)

### Core Principle: Two-Phase Enrichment

**Phase 1: Data Collection** - Gather ALL available data first
- Business info (name, address, phone, website)
- Owner/staff names from website
- Email addresses from website
- Company registration data

**Phase 2: Intelligent Matching** - Combine and validate data
- Match names to email addresses (personal + role-based)
- Prioritize contacts by email validation
- Generate merge variables for personalization

---

## Module Directory

### 1. Data Collection Modules

#### `ksd/local-outreach/orchestrator/modules/google-maps-scraper-outscraper.js`
**Purpose:** Scrape businesses from Google Maps using Outscraper API
**When to use:** Initial business discovery for a location/postcode
**Input:** Location, postcode, business categories
**Output:** Array of businesses with basic info (name, address, phone, website, reviews)

#### `shared/outreach-core/enrichment/website-scraper.js`
**Purpose:** Extract company registration, owner names, and emails from websites
**When to use:** After Google Maps scraping, for each business with a website
**Input:** Website URL
**Output:** Registration number, registered address, owner names (with email matches), emails

#### `shared/outreach-core/email-discovery/website-email-extractor.js`
**Purpose:** Extract all email addresses from a website
**When to use:** When you need comprehensive email discovery (fallback if website-scraper doesn't find enough)
**Input:** Website URL
**Output:** Array of email addresses found on the site

#### `shared/outreach-core/email-discovery/email-pattern-matcher.js`
**Purpose:** Generate potential email patterns and verify them
**When to use:** When website has no visible emails but you have owner names
**Input:** Owner name, company domain
**Output:** Verified email addresses that match common patterns

#### `shared/outreach-core/email-discovery/social-media-email-extractor.js`
**Purpose:** **DEPRECATED** - Extract emails from social media profiles
**When to use:** **DO NOT USE** - Violates Terms of Service
**Status:** Disabled to avoid legal issues

#### `shared/outreach-core/email-discovery/icypeas-finder.js`
**Purpose:** Find business emails using Icypeas API (LinkedIn-based)
**When to use:** Premium email discovery when website scraping fails
**Input:** Business name, domain, location
**Output:** Verified business emails with confidence scores

### 2. Validation & Verification Modules

#### `shared/outreach-core/email-verification/reoon-verifier.js`
**Purpose:** Verify email deliverability using Reoon API
**When to use:** Before exporting leads to Lemlist to avoid bounces
**Input:** Email address
**Output:** Verification status (valid/invalid/risky)

### 3. Content Generation Modules

#### `shared/outreach-core/content-generation/email-merge-variables.js`
**Purpose:** Generate all merge variables for email personalization
**When to use:** After enrichment, before export to Lemlist
**Input:** Enriched business object
**Output:** Complete set of merge variables (firstName, lastName, localIntro, observationSignal, etc.)

**Key Functions:**
- `getAllMergeVariables(business)` - Main function, returns all variables
- `getMultiOwnerNote(business)` - Handles multi-owner scenarios (capped at 5, Oxford comma)
- `getLocalIntro(postcode)` - Proximity-based intro (local vs UK-wide)
- `getObservationSignal(business)` - Business-specific hooks
- `getMicroOfferPrice(business)` - Tiered pricing based on business tier
- `getMeetingOption(postcode)` - In-person vs phone based on proximity

#### `shared/outreach-core/content-generation/observation-signals.js`
**Purpose:** Compute observation signals for email hooks
**When to use:** Called by email-merge-variables automatically
**Input:** Business data (reviews, website quality, social media)
**Output:** Ranked signals (lowReviews, noWebsite, poorWebsite, etc.)

#### `shared/outreach-core/content-generation/gpt-email-generator.js`
**Purpose:** Generate custom email copy using GPT-4
**When to use:** For fully custom emails (not using templates)
**Input:** Business data, prompt template
**Output:** Custom-written email content

### 4. Export Modules

#### `shared/outreach-core/export-managers/lemlist-exporter.js`
**Purpose:** Export leads to Lemlist email campaigns
**When to use:** Final step after enrichment and merge variable generation
**Input:** Campaign ID, lead data with merge variables
**Output:** Success/failure status, handles duplicates

### 5. Utility Modules

#### `shared/outreach-core/logger.js`
**Purpose:** Centralized logging with PII masking
**When to use:** All logging throughout the system
**Key Feature:** Automatically masks email addresses to avoid GDPR violations

#### `shared/outreach-core/credentials-loader.js`
**Purpose:** Load API credentials and track usage quotas
**When to use:** System initialization, quota checking
**Output:** API keys, usage tracking data

---

## Complete Process Flow

### Standard Outreach Campaign Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 1: BUSINESS DISCOVERY                                     │
└─────────────────────────────────────────────────────────────────┘

1. google-maps-scraper-outscraper.js
   ├─ Input: Location ("Bramhall"), Postcode ("SK7"), Categories (["dentists"])
   └─ Output: Array of businesses with basic info

      Business Object (Initial):
      {
        name: "Arundel Dental Practice",
        businessName: "Arundel Dental Practice",
        website: "https://www.arundeldentalpractice.co.uk",
        phone: "+44 161 439 2896",
        address: "4 Bramhall Lane South, Bramhall, Stockport",
        postcode: "SK7 1AL",
        location: "Bramhall, Stockport",
        category: "Dentist",
        rating: 4.9,
        reviews: 247,
        assignedOfferTier: "tier5" // Auto-assigned based on revenue signals
      }

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 2: DATA COLLECTION (Get everything first!)                │
└─────────────────────────────────────────────────────────────────┘

2. website-scraper.js (scrapeWebsite)
   ├─ Input: business.website
   └─ Output: Registration data + owner names + emails

   STEP 2A: Extract ALL emails from website
   ├─ extractEmails(html)
   └─ Returns: ["reception@...", "pm@...", "christopher.needham@..."]

   STEP 2B: Extract ALL owner/staff names from website
   ├─ extractOwnerNames(html, emails)
   ├─ Searches: main page, /about, /team, /contact, etc.
   └─ Returns: Array of names with titles

      [
        { name: "Christopher Needham", title: "BDS", hasEmailMatch: false },
        { name: "Amanda Lynam", title: "Practice Manager", hasEmailMatch: true },
        { name: "Zoe Tierney", title: "Receptionist", hasEmailMatch: true },
        ...
      ]

   STEP 2C: Validate names against emails
   ├─ nameMatchesEmailPattern(name, emails, title)
   ├─ Tests personal patterns: christopher.needham@, christopher@, cneedham@
   ├─ Tests role-based patterns: pm@ (Practice Manager), reception@ (Receptionist)
   └─ Returns: true if name matches any email

   STEP 2D: Sort names by email validation
   ├─ Names with email matches FIRST
   └─ Ensures best contact is primary

   Final Website Data:
   {
     registrationNumber: "12345678",
     registeredAddress: "...",
     ownerNames: [
       { name: "Amanda Lynam", title: "Practice Manager", hasEmailMatch: true },
       { name: "Zoe Tierney", title: "Receptionist", hasEmailMatch: true },
       { name: "Christopher Needham", title: "BDS", hasEmailMatch: false },
       ...
     ],
     scrapedAt: "2026-02-10T21:22:10.913Z"
   }

3. Merge website data into business object
   ├─ business.ownerFirstName = "Amanda"
   ├─ business.ownerLastName = "Lynam"
   └─ business.owners = [{ firstName: "Amanda", fullName: "Amanda Lynam", title: "Practice Manager" }, ...]

4. website-email-extractor.js (if needed for fallback)
   ├─ Input: business.website
   └─ Output: Array of emails (if website-scraper missed any)

5. email-verification/reoon-verifier.js
   ├─ Input: Primary email address
   └─ Output: Verification status (valid/invalid/risky)

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 3: INTELLIGENT ENRICHMENT (Combine and validate)          │
└─────────────────────────────────────────────────────────────────┘

6. email-merge-variables.js (getAllMergeVariables)
   ├─ Input: Enriched business object
   └─ Output: Complete merge variables

   Business Object (Fully Enriched):
   {
     name: "Arundel Dental Practice",
     ownerFirstName: "Amanda",
     ownerLastName: "Lynam",
     owners: [
       { firstName: "Amanda", fullName: "Amanda Lynam", title: "Practice Manager" },
       { firstName: "Zoe", fullName: "Zoe Tierney", title: "Receptionist" },
       { firstName: "Christopher", fullName: "Christopher Needham", title: "BDS" },
       { firstName: "Michael", fullName: "Michael Clark", title: "Dr" },
       { firstName: "Barbara", fullName: "Barbara Woodall", title: "Dental Hygienist" },
       ...12 total
     ],
     ...all other fields
   }

   Merge Variables Generated:
   {
     firstName: "Amanda",
     lastName: "Lynam",
     companyName: "Arundel Dental Practice",
     location: "Bramhall, Stockport",
     businessType: "dental practice",
     localIntro: "I'm Kobi, a digital marketing consultant based in Poynton, so pretty close to you!",
     observationSignal: "saw you're building up your online reputation",
     meetingOption: "meet in person if that's easier",
     microOfferPrice: "£97",
     multiOwnerNote: "Quick note – I'm also reaching out to Zoe, Christopher, Michael, Barbara, and Nicola since I wasn't sure who handles this at Arundel Dental Practice. ",
     noNameNote: "",
     isNearby: true,
     tier: "tier5",
     postcode: "SK7 1AL"
   }

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 4: EXPORT TO OUTREACH PLATFORM                            │
└─────────────────────────────────────────────────────────────────┘

7. lemlist-exporter.js (addLeadToCampaign)
   ├─ Input: Campaign ID, lead data with merge variables
   ├─ Creates lead in Lemlist with all merge variables
   └─ Output: Success/failure, handles duplicates

   Lead Data Sent to Lemlist:
   {
     email: "pm@arundeldentalpractice.co.uk",
     firstName: "Amanda",
     lastName: "Lynam",
     companyName: "Arundel Dental Practice",
     location: "Bramhall, Stockport",
     businessType: "dental practice",
     localIntro: "...",
     observationSignal: "...",
     meetingOption: "...",
     microOfferPrice: "£97",
     multiOwnerNote: "...",
     noNameNote: "",
     companyDomain: "arundeldentalpractice.co.uk",
     phone: "+44 161 439 2896"
   }
```

---

## Data Enrichment Strategy

### Two-Phase Approach (Current Best Practice)

**❌ OLD WAY (Sequential, wasteful):**
```javascript
// Step 1: Scrape Google Maps
const businesses = await scrapeGoogleMaps();

// Step 2: Get names
const names = await scrapeWebsite(business.website);

// Step 3: Get emails separately
const emails = await extractEmailsFromWebsite(business.website);

// Step 4: Try to match them somehow
// Problem: Two separate website fetches, no intelligent matching
```

**✅ NEW WAY (Parallel, intelligent):**
```javascript
// Step 1: Scrape Google Maps
const businesses = await scrapeGoogleMaps();

// Step 2: Get EVERYTHING from website in one pass
const websiteData = await scrapeWebsite(business.website);
// Returns: { ownerNames, emails, registrationNumber, registeredAddress }
// ownerNames already validated against emails with hasEmailMatch property

// Step 3: Use the validated data
business.ownerFirstName = websiteData.ownerNames[0].firstName; // Best contact already first
business.ownerLastName = websiteData.ownerNames[0].lastName;
business.owners = websiteData.ownerNames.map(...);
```

### Why This Works Better

1. **Single website fetch** - Faster, less bandwidth, less likely to get blocked
2. **Email validation happens during name extraction** - No separate matching step needed
3. **Smart prioritization** - Names with validated emails automatically sorted first
4. **Role-based matching** - Understands that "Practice Manager" → `pm@` email
5. **Deduplication** - Handles multiple people sharing same email (see below)

---

## Email and Name Matching Logic

### Personal Email Patterns

When we extract a name like "Christopher Needham", we test these patterns:

```javascript
const firstName = "christopher";
const lastName = "needham";

const patterns = [
  `${firstName}.${lastName}@`,      // christopher.needham@domain.com
  `${firstName}${lastName}@`,       // christopherneedham@domain.com
  `${firstName}@`,                  // christopher@domain.com
  `${firstName[0]}${lastName}@`,    // cneedham@domain.com
  `${firstName[0]}.${lastName}@`    // c.needham@domain.com
];
```

### Role-Based Email Patterns

When we extract a name with a job title, we also test role-based emails:

| Job Title | Matching Email Patterns |
|-----------|------------------------|
| Practice Manager, Office Manager | `pm@`, `manager@`, `office@` |
| Owner, Founder, Proprietor | `owner@`, `director@`, `ceo@` |
| Director, Managing Director | `director@`, `md@` |
| Receptionist | `reception@`, `front@` |

**Example:**
```javascript
Name: "Amanda Lynam"
Title: "Practice Manager"
Emails found: ["reception@...", "pm@...", "info@..."]

// Test personal patterns first
christopher.needham@ → NOT FOUND
amanda.lynam@ → NOT FOUND
amanda@ → NOT FOUND

// Test role-based patterns
pm@ → FOUND! ✅
manager@ → NOT FOUND
office@ → NOT FOUND

Result: hasEmailMatch = true
```

### Duplicate Email Handling

**Problem:** Multiple people share the same email (e.g., two receptionists both have `reception@`)

**Current Behavior (BUGGY):**
```javascript
// Both marked as email matches
{ name: "Zoe Tierney", title: "Receptionist", hasEmailMatch: true }
{ name: "Natasha Lallement", title: "Receptionist", hasEmailMatch: true }

// Problem: Both claim the same email, inflates match count
// emailMatchCount: 3 (but only 2 unique emails)
```

**Fixed Behavior (TO IMPLEMENT):**

```javascript
// Track which emails have been claimed
const claimedEmails = new Set();

// Priority order for claiming emails:
// 1. Personal email patterns (highest priority)
// 2. Senior role-based emails (owner@, director@, pm@)
// 3. Junior role-based emails (reception@, front@)

// Process names in order
for (const owner of ownerNames) {
  const matchedEmail = findMatchingEmail(owner.name, owner.title, emails, claimedEmails);

  if (matchedEmail) {
    owner.hasEmailMatch = true;
    owner.matchedEmail = matchedEmail; // Store which email matched
    claimedEmails.add(matchedEmail); // Claim it so others can't use it
  } else {
    owner.hasEmailMatch = false;
  }
}
```

**Example:**
```javascript
// Input
Emails: ["pm@...", "reception@..."]
Names: [
  { name: "Amanda Lynam", title: "Practice Manager" },
  { name: "Zoe Tierney", title: "Receptionist" },
  { name: "Natasha Lallement", title: "Receptionist" }
]

// Processing
1. Amanda Lynam (Practice Manager)
   - Tests: pm@, manager@, office@
   - Match: pm@ ✅
   - Claims: pm@

2. Zoe Tierney (Receptionist)
   - Tests: reception@, front@
   - Match: reception@ ✅
   - Claims: reception@

3. Natasha Lallement (Receptionist)
   - Tests: reception@, front@
   - reception@ already claimed by Zoe
   - Match: NONE ❌

// Final Result
[
  { name: "Amanda Lynam", title: "Practice Manager", hasEmailMatch: true, matchedEmail: "pm@..." },
  { name: "Zoe Tierney", title: "Receptionist", hasEmailMatch: true, matchedEmail: "reception@..." },
  { name: "Natasha Lallement", title: "Receptionist", hasEmailMatch: false }
]

// emailMatchCount: 2 (correct - 2 unique emails)
```

### Email Match Priority Rules

1. **Personal email beats role-based email**
   - If `christopher.needham@` exists, it beats `pm@` even if Christopher is Practice Manager

2. **Senior roles beat junior roles for shared emails**
   - Practice Manager > Receptionist for `reception@` (if both could match)

3. **First match wins for same-level roles**
   - If two receptionists both match `reception@`, first one claims it

4. **Email validation happens DURING name extraction**
   - No separate matching step needed
   - Names already sorted by hasEmailMatch when returned

---

## Module Details

### website-scraper.js Deep Dive

**File:** `shared/outreach-core/enrichment/website-scraper.js`

#### Key Functions

**`scrapeWebsite(url)`**
- Main entry point for website scraping
- Returns: `{ registrationNumber, registeredAddress, ownerNames, scrapedAt }`

**`extractEmails(html)`**
- Extracts all email addresses from HTML
- Filters out generic emails (info@, contact@, hello@, support@)
- Returns: Array of email addresses

**`nameMatchesEmailPattern(fullName, emails, title)`**
- Tests if a person's name matches any email patterns
- Checks both personal and role-based patterns
- Returns: `true` if name matches any email

**`extractOwnerNames(html, emails)`**
- Main name extraction function
- Uses 5 different pattern-matching strategies:
  1. Professional qualifications (BDS, MSc, PhD, etc.)
  2. Business titles before name (Owner, Founder, Principal)
  3. Context clues (founded by, joined by, graduated from)
  4. Direct job title pattern (Name + Job Title)
  5. GDC proximity pattern (UK dental professionals)
- Validates each name against emails
- Sorts by email match (validated names first)
- Returns: Array of `{ name, title, hasEmailMatch }`

#### Pattern Matching Strategies

**Pattern 1: Professional Qualifications**
```javascript
// Matches: "Christopher Needham BDS", "Laura Gill BDS MJDF RCS Eng"
/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(BDS|MBChB|MBBS|MD|PhD|BSc|MSc|MFDS|MJDF|RCS|NVQ|Level\s+\d)/gi
```

**Pattern 2: Business Titles Before Name**
```javascript
// Matches: "Principal Christopher Needham", "Owner Sarah Johnson"
/(?:Principal|Owner|Founder|Director|Managing Director|CEO|Proprietor|Partner)[\s:]+(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/gi
```

**Pattern 3: Context Clues**
```javascript
// Matches: "founded by Christopher Needham", "practice was started by Sarah Johnson"
/(?:founded|started|established|run|led|owned|joined|managed|graduated)\s+(?:by|from)\s+(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/gi
```

**Pattern 4: Direct Job Title**
```javascript
// Matches: "Amanda Lynam Practice Manager", "Natasha Lallement Receptionist"
/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\s+(Practice\s+Manager|Office\s+Manager|...|Receptionist|Manager|Director)/gi
```

**Pattern 5: GDC Proximity**
```javascript
// Matches: "Barbara Woodall Dental Hygienist - GDC Number"
/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\s+[A-Za-z\s-]{0,30}?GDC\s+Number/gi
```

#### Name Validation

**`isValidPersonName(name)`** - Helper function to filter false positives

**Rejection Rules:**
1. Common non-name words (visiting, become, qualified, etc.)
2. Second word is a qualification (BDS, MSc, etc.)
3. Ends with job-related words (Dental, Manager, etc.)
4. Contains lowercase articles (the, and, as, an)
5. Doesn't match proper name format `[A-Z][a-z]+`

**Example:**
```javascript
isValidPersonName("Christopher Needham") → true ✅
isValidPersonName("Needham BDS") → false (qualification as second word) ❌
isValidPersonName("visiting the") → false (non-name word) ❌
isValidPersonName("GDC registered") → false (non-name word) ❌
```

#### Website Pages Checked

The scraper checks **16 different URL paths** to maximize name discovery:

```javascript
const teamPageUrls = [
  '/about', '/about-us', '/about-me', '/aboutus',
  '/team', '/meet-the-team', '/our-team', '/meet-the-team-subtitle', '/team-members',
  '/staff', '/people', '/directors',
  '/contact', '/contact-us', '/contactus',
  '/blog', '/insights', '/news'
];
```

---

## Decision Trees

### When to Use Which Email Discovery Method?

```
START
│
├─ Business has website?
│  │
│  YES → Use website-scraper.js
│  │     │
│  │     ├─ Found names AND emails?
│  │     │  │
│  │     │  YES → DONE ✅
│  │     │  │
│  │     │  NO → Found names but no emails?
│  │     │     │
│  │     │     YES → Use email-pattern-matcher.js
│  │     │     │     (Generate patterns like firstname.lastname@domain)
│  │     │     │
│  │     │     NO → Found emails but no names?
│  │     │           │
│  │     │           Use generic name fallback
│  │     │           firstName = "there"
│  │     │
│  NO → Try icypeas-finder.js (premium LinkedIn-based discovery)
│       │
│       Found email?
│       │
│       YES → DONE ✅
│       │
│       NO → SKIP (no email, no outreach possible)
```

### When to Use Email Verification?

```
START
│
├─ Email discovered via website scraping?
│  │
│  YES → Skip verification (likely legitimate)
│  │
│  NO → Email discovered via pattern matching?
│       │
│       YES → ALWAYS verify with reoon-verifier.js
│       │    (Pattern-matched emails might not exist)
│       │
│       NO → Email discovered via Icypeas?
│            │
│            Icypeas confidence > 0.8?
│            │
│            YES → Skip verification (Icypeas already verified)
│            │
│            NO → Verify with reoon-verifier.js
```

### Multi-Owner Note Decision

```
START
│
├─ How many owners found?
│  │
│  0 or 1 → multiOwnerNote = "" (empty)
│  │
│  2-6 → Format with Oxford comma
│  │     │
│  │     2 owners: "Michael and Barbara"
│  │     3+ owners: "Michael, Barbara, and Nicola"
│  │     Cap at 5 names max (skip the rest)
│  │
│  7+ → Cap at 5: "Michael, Barbara, Nicola, Lauren, and Amanda"
│        (Skips the remaining 2+ owners silently)
```

---

## Common Pitfalls and Solutions

### Pitfall 1: Fetching Website Multiple Times

**❌ WRONG:**
```javascript
const names = await scrapeWebsite(url); // Fetch #1
const emails = await extractEmailsFromWebsite(url); // Fetch #2
const registration = await getRegistrationNumber(url); // Fetch #3
```

**✅ RIGHT:**
```javascript
const websiteData = await scrapeWebsite(url); // Fetch #1 (gets everything)
// websiteData = { ownerNames, emails, registrationNumber, registeredAddress }
```

### Pitfall 2: Not Validating Names Against Emails

**❌ WRONG:**
```javascript
const names = extractOwnerNames(html);
// Names not validated, might pick wrong person as primary contact
business.ownerFirstName = names[0].firstName; // Could be random staff member
```

**✅ RIGHT:**
```javascript
const emails = extractEmails(html);
const names = extractOwnerNames(html, emails); // Pass emails for validation
// Names already sorted by hasEmailMatch
business.ownerFirstName = names[0].firstName; // Best contact (email-validated)
```

### Pitfall 3: Ignoring Duplicate Emails

**❌ WRONG:**
```javascript
// Both receptionists marked as email matches
emailMatchCount = ownerNames.filter(n => n.hasEmailMatch).length; // Returns 3
// But only 2 unique emails exist (pm@, reception@)
```

**✅ RIGHT (TO FIX):**
```javascript
const uniqueEmails = new Set(
  ownerNames
    .filter(n => n.hasEmailMatch)
    .map(n => n.matchedEmail)
);
emailMatchCount = uniqueEmails.size; // Returns 2 (correct)
```

### Pitfall 4: Using Social Media Extractors

**❌ NEVER DO THIS:**
```javascript
const emails = await extractFromInstagram(url); // VIOLATES TOS!
```

**✅ DO THIS:**
```javascript
// social-media-email-extractor.js is DEPRECATED
// Use website-scraper.js or icypeas-finder.js instead
```

---

## Testing Flow

### Unit Tests (Individual Modules)

```bash
# Test name extraction
node tests/test-name-extraction.js

# Test email validation
node tests/test-email-validation.js

# Test demo with full flow
node tests/demo-name-extraction.js
```

### Integration Tests (Full Pipeline)

```bash
# Test full enrichment pipeline
node tests/integration-test-bramhall.js

# Test export to Lemlist (10 businesses)
node tests/export-10-to-lemlist.js

# Test specific category (5 dentists)
node tests/export-5-dentists.js
```

### Stress Tests (Performance & Reliability)

```bash
# Full pipeline stress test
node tests/stress-test.js
```

---

## Configuration

### API Keys Required

Set these in `.env`:

```bash
# Outscraper (Google Maps scraping)
OUTSCRAPER_API_KEY=your_key_here

# Icypeas (LinkedIn-based email discovery)
ICYPEAS_API_KEY=your_key_here

# Reoon (Email verification)
REOON_API_KEY=your_key_here

# Lemlist (Email campaign export)
LEMLIST_API_KEY=your_key_here

# OpenAI (Custom email generation - optional)
OPENAI_API_KEY=your_key_here
```

### Nearby Postcodes (for proximity detection)

Edit `email-merge-variables.js`:

```javascript
const NEARBY_POSTCODES = [
  'SK12', // Poynton (base location)
  'SK7',  // Bramhall
  'SK6',  // High Lane
  // Add more postcodes here
];
```

### Tier Pricing Multipliers

Edit `email-merge-variables.js`:

```javascript
const TIER_MULTIPLIERS = {
  tier1: 5,    // High revenue businesses → £485
  tier2: 3,    // Medium-high → £291
  tier3: 2,    // Medium → £194
  tier4: 1.5,  // Medium-low → £145
  tier5: 1     // Low revenue → £97
};
```

---

## Version History

- **v1.0.0** (2026-02-10): Initial architecture documentation
  - Complete system overview
  - Module directory with purpose and usage
  - Two-phase enrichment strategy
  - Email and name matching logic
  - Duplicate email handling strategy (to be implemented)

---

## Next Steps (Implementation Required)

1. **Fix duplicate email handling** in `website-scraper.js`
   - Track claimed emails with Set
   - Add `matchedEmail` property to owner objects
   - Ensure only one person claims each email

2. **Update emailMatchCount calculation** in `website-scraper.js`
   - Count unique emails, not unique people with emails

3. **Add email claim priority logic**
   - Personal emails > Senior roles > Junior roles
   - First match wins for same priority

4. **Create automated tests** for duplicate email scenarios
   - Test: Two receptionists, one `reception@` email
   - Test: Practice Manager + Receptionist, `pm@` + `reception@` emails
   - Test: Personal email vs role-based email conflict

---

**End of Architecture Documentation**
