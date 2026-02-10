# Lemlist Email Sequence - Final Version
## Updated with user feedback (2026-02-10)

---

## Email 1 (Day 0) - Initial Outreach

### Subject Line
```
quick thought {{firstName}}
```

### Email Body
```
{% if firstName %}Hi {{firstName}}{% else %}Hi there{% endif %},

I noticed {{companyName}} in {{location}} and thought I'd reach out. I work with local {{businessType}} and help them use AI for things like keeping clients coming back, managing bookings, and saving time on admin.

It's pretty simple to set up – from just {{microOfferPrice}} to get started. No big commitment, just a quick way to see if it's useful for you.

Fancy a chat?

Sent from my iPhone
```

**Notes:**
- Subject uses firstName only (more personal, shorter)
- Body has fallback for missing firstName
- Uses `{{microOfferPrice}}` (tiered pricing based on business revenue)

---

## Email 2 (Day 3) - Follow-Up

### Subject Line
```
re: {{companyName}}
```

### Email Body
```
{% if firstName %}Hi {{firstName}}{% else %}Hi there{% endif %},

Following up on my email about {{companyName}} – I know you're probably busy, but wanted to check if you saw my message about using AI to help with client retention and admin work.

I've been helping {{businessType}} in the area with this, and it's been working really well. From just {{microOfferPrice}} to get started.

If you're interested, let me know and I can show you how it works.

Cheers,

Sent from my iPhone
```

**Notes:**
- "I've been helping {{businessType}}" is correct (plural, no apostrophe)
- Uses `{{microOfferPrice}}` for consistent pricing

---

## Email 3 (Day 7) - Different Angle

### Subject Line
```
one more thing {{firstName}}
```

### Email Body
```
{% if firstName %}Hi {{firstName}}{% else %}Hi there{% endif %},

I sent you a couple emails about {{companyName}} – didn't want to be a pest, but I had one more thought.

A lot of {{businessType}} I work with struggle with online bookings and managing their schedule. The AI system I mentioned could help with that too – it's pretty flexible.

From just {{microOfferPrice}} to get set up. Worth a quick chat?

Let me know if you're interested.

Sent from my iPhone
```

**Notes:**
- Changed subject to "one more thing {{firstName}}" (more personal)
- Fallback for firstName in body

---

## Email 4 (Day 14) - Final Attempt

### Subject Line
```
last one {{firstName}}
```

### Email Body
```
{% if firstName %}Hi {{firstName}}{% else %}Hi there{% endif %},

This'll be my last email – I know I've reached out a few times about {{companyName}}.

If you're not interested in using AI to help with client retention and bookings, no worries. But if you are curious, I'm happy to show you a quick demo. From just {{microOfferPrice}}.

Let me know – otherwise, I'll leave you alone!

Sent from my iPhone
```

**Notes:**
- Changed subject to "last one {{firstName}}"
- Consistent pricing variable

---

## Merge Variables Required

Ensure these are populated when exporting to Lemlist:

| Variable | Description | Example | Fallback |
|----------|-------------|---------|----------|
| `firstName` | Owner first name | "Sarah" | "there" (handled by conditional) |
| `lastName` | Owner last name | "Smith" | "" |
| `companyName` | Humanized business name | "KissDental" | Required |
| `location` | City/town | "Bramhall" | Required |
| `businessType` | Plural business type | "dentists" | "local businesses" |
| `microOfferPrice` | Tiered micro-offer pricing | "£97" or "£485" | "£97" |
| `linkedinUrl` | LinkedIn profile URL | "https://linkedin.com/in/..." | Optional |

---

## New Variable: {{microOfferPrice}}

This needs to be calculated based on the business tier:

### Tier-Based Pricing Logic

```javascript
// Tier multipliers
const tierMultipliers = {
  tier1: 5,    // High revenue → £485
  tier2: 3,    // Medium-high → £291
  tier3: 2,    // Medium → £194
  tier4: 1.5,  // Medium-low → £145
  tier5: 1     // Low revenue → £97
};

// Base micro-offer by region
const baseMicroOffer = {
  UK: 97,
  US: 127,
  AU: 147,
  CA: 127,
  NZ: 147,
  EU: 97
};

// Calculate tiered micro-offer
const tier = business.assignedOfferTier || 'tier5';
const country = detectCountryFromLocation(business.location);
const basePrice = baseMicroOffer[country];
const multiplier = tierMultipliers[tier];
const tierMicroOffer = basePrice * multiplier;

// Format with currency symbol
const currency = getCurrencyForLocation(business.location);
const microOfferPrice = `${currency.symbol}${tierMicroOffer}`;
```

### Example Outputs

| Business | Tier | Region | Base | Multiplier | Final Price |
|----------|------|--------|------|------------|-------------|
| KissDental Bramhall | tier2 | UK | £97 | 3× | **£291** |
| Joe's Barber Shop | tier5 | UK | £97 | 1× | **£97** |
| Elite Fitness Studio | tier1 | US | $127 | 5× | **$635** |

---

## Implementation Required

To use `{{microOfferPrice}}` in Lemlist, the export script needs to be updated:

### File: `shared/outreach-core/export-managers/lemlist-exporter.js`

Add calculation before creating lead:

```javascript
// Calculate tiered micro-offer price
const tierMultipliers = {
  tier1: 5,
  tier2: 3,
  tier3: 2,
  tier4: 1.5,
  tier5: 1
};

const tier = business.assignedOfferTier || 'tier5';
const multiplier = tierMultipliers[tier];
const currency = getCurrencyForLocation(business.location);
const baseMicroOffer = currency.microOffer; // From currency-localization.js
const tierMicroOfferAmount = baseMicroOffer * multiplier;
const microOfferPrice = `${currency.symbol}${tierMicroOfferAmount}`;

// Add to custom fields
customData.push({
  property: 'microOfferPrice',
  value: microOfferPrice
});
```

**I can implement this if you want!**

---

## Summary of Changes

| Issue | Before | After | Status |
|-------|--------|-------|--------|
| Subject line personalization | "quick thought for {{companyName}}" | "quick thought {{firstName}}" | ✅ Fixed |
| Follow-up subject | "one more thing – {{companyName}}" | "one more thing {{firstName}}" | ✅ Fixed |
| Final subject | "last one – {{companyName}}" | "last one {{firstName}}" | ✅ Fixed |
| Missing firstName fallback | "Hi {{firstName}}," | "{% if firstName %}Hi {{firstName}}{% else %}Hi there{% endif %}," | ✅ Fixed |
| Fixed pricing | "from just £97" | "from just {{microOfferPrice}}" | ✅ Fixed |
| Grammar | "I've been helping {{businessType}}" | No change needed (already correct) | ✅ Confirmed |

---

## Next Steps

**Option 1 (Quick Fix):** Use these templates as-is with static £97 pricing
- Copy-paste into Lemlist now
- Manually adjust pricing per campaign if needed

**Option 2 (Full Implementation):** Update export script to calculate `{{microOfferPrice}}`
- I can implement the tiered pricing logic
- Export script will calculate correct price per business
- Lemlist merge variable will auto-populate

**Which would you prefer?**
