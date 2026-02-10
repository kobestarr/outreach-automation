# Lemlist Merge Variables Reference

## Overview
This system automatically generates dynamic merge variables for each lead exported to Lemlist. These variables personalize emails based on business data, location, revenue tier, and ownership structure.

---

## Core Variables

### Basic Contact Info
```
{{firstName}}       - Owner's first name (or "there" if unknown)
{{lastName}}        - Owner's last name (or empty if unknown)
{{companyName}}     - Business name
{{location}}        - Business location/address
{{businessType}}    - Type of business (e.g., "salon", "dentist")
{{postcode}}        - Business postcode
```

---

## Dynamic Variables

### 1. Local Introduction
```
{{localIntro}}
```

**For nearby businesses (SK7, SK12, SK6, SK8, etc.):**
> "I'm Kobi, a digital marketing consultant based in Poynton, so pretty close to you!"

**For distant businesses:**
> "I'm Kobi, a digital marketing consultant working with local businesses across the UK."

---

### 2. Observation Signal
```
{{observationSignal}}
```

Automatically selects most relevant observation:
- `lowReviews` → "saw you're building up your online reputation"
- `noWebsite` → "noticed you don't have a website yet"
- `poorWebsite` → "thought your website could use a refresh"
- `noSocialMedia` → "saw you could use help with social media"
- `lowRating` → "noticed you could improve your online presence"
- `highReviews` → "saw you've built up a solid reputation online"
- Default → "thought I'd reach out"

---

### 3. Meeting Option
```
{{meetingOption}}
```

**For nearby businesses:**
> "meet in person if that's easier"

**For distant businesses:**
> "have a chat"

---

### 4. Tiered Pricing
```
{{microOfferPrice}}
```

Automatically calculates price based on revenue tier:

| Tier | Multiplier | UK Price | US Price |
|------|-----------|----------|----------|
| tier1 | 5x | £485 | $635 |
| tier2 | 3x | £291 | $381 |
| tier3 | 2x | £194 | $254 |
| tier4 | 1.5x | £145.50 | $190.50 |
| tier5 | 1x | £97 | $127 |

Currency and pricing automatically localized based on business location.

---

### 5. Multi-Owner Acknowledgment
```
{{multiOwnerNote}}
```

**When contacting multiple owners at same business:**
> "Quick note – I'm also reaching out to Sarah and John since I wasn't sure who handles this at [CompanyName]. "

**Single owner or no multi-owner scenario:**
> "" (empty string)

---

### 6. No-Name Acknowledgment
```
{{noNameNote}}
```

**When no owner names found (using "[CompanyName] Team" fallback):**
> "I couldn't find your names anywhere! "

**When real names found:**
> "" (empty string)

---

## Example Email Template

```
Subject: Quick idea for {{companyName}}

Hi {{firstName}},

{{multiOwnerNote}}{{noNameNote}}{{localIntro}}

I {{observationSignal}} and thought I'd reach out.

[Your value proposition here...]

From just {{microOfferPrice}} I can get you started with a simple plan that actually fits into your day.

Worth a quick chat? Here's my calendar: [link]

We can {{meetingOption}}.

Best,
Kobi
```

---

## Sample Output

### Example 1: Nearby Salon with High Revenue
```
Subject: Quick idea for Francesco Hair Salon

Hi Sarah,

I'm Kobi, a digital marketing consultant based in Poynton, so pretty close to you!

I saw you've built up a solid reputation online and thought I'd reach out.

From just £291 I can get you started with a simple plan that actually fits into your day.

Worth a quick chat? Here's my calendar: [link]

We can meet in person if that's easier.

Best,
Kobi
```

### Example 2: Distant Business with Multiple Owners
```
Subject: Quick idea for London Dental Practice

Hi Dr. Smith,

Quick note – I'm also reaching out to Dr. Jones since I wasn't sure who handles this at London Dental Practice. I'm Kobi, a digital marketing consultant working with local businesses across the UK.

I noticed you don't have a website yet and thought I'd reach out.

From just £145.50 I can get you started with a simple plan that actually fits into your day.

Worth a quick chat? Here's my calendar: [link]

We can have a chat.

Best,
Kobi
```

### Example 3: No Owner Names Found
```
Subject: Quick idea for Bramhall Cafe

Hi there,

I couldn't find your names anywhere! I'm Kobi, a digital marketing consultant based in Poynton, so pretty close to you!

I saw you could use help with social media and thought I'd reach out.

From just £97 I can get you started with a simple plan that actually fits into your day.

Worth a quick chat? Here's my calendar: [link]

We can meet in person if that's easier.

Best,
Kobi
```

---

## Boolean Flags

These are also available for conditional logic:

```
{{isNearby}}     - true/false if business is within 45 minutes
{{tier}}         - "tier1" through "tier5" revenue classification
```

---

## Nearby Postcodes (45 minutes from Poynton SK12)

**Included by default:**
- SK1, SK2, SK3, SK4, SK6, SK7, SK8, SK9, SK10, SK12, SK17, SK22, SK23
- M13, M14, M19, M20, M21, M22, M23
- WA14, WA15, WA16

---

## Usage in Lemlist

1. **Campaign Setup:**
   - Create your campaign in Lemlist UI
   - Add email steps/sequences
   - Use merge variables with double braces: `{{variableName}}`

2. **Export from System:**
   ```bash
   node ksd/local-outreach/orchestrator/export-to-lemlist.js cam_bJYSQ4pqMzasQWsRb
   ```

3. **System automatically:**
   - Enriches business data
   - Calculates all merge variables
   - Exports to campaign with all variables populated
   - Real emails sent (not masked)
   - Logs remain GDPR compliant (emails masked)

---

## Testing

To test merge variables for a specific business:

```javascript
const { getAllMergeVariables } = require('./shared/outreach-core/content-generation/email-merge-variables');

const business = {
  name: "Francesco Hair Salon",
  postcode: "SK7 1AL",
  category: "Hair Salon",
  ownerFirstName: "Sarah",
  assignedOfferTier: "tier2",
  owners: [
    { firstName: "Sarah", fullName: "Sarah Johnson" }
  ]
};

const variables = getAllMergeVariables(business);
console.log(variables);
```

---

## Notes

- All variables are **automatically generated** - no manual input needed
- Variables are **context-aware** based on business data
- Pricing is **currency-localized** for international businesses
- Multi-owner handling is **automatic** when multiple owners detected
- Empty strings returned for irrelevant variables (clean output)
