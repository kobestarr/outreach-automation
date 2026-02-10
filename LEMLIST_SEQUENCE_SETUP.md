# Lemlist Email Sequence Setup Guide

## Overview
This is the EXACT 4-email sequence to set up in Lemlist UI. These templates use merge variables and will work for ALL business categories (dentists, gyms, restaurants, etc.).

---

## Email 1 — Initial Outreach (Day 0)

### Subject Line
```
quick thought for {{companyName}}
```

### Email Body
```
Hi {{firstName}},

I noticed {{companyName}} in {{location}} and saw [SIGNAL_OBSERVATION]. Just had a quick thought – have you considered using AI to help with that? I work with local {{businessType}} and I've got a simple setup that could help.

Happy to show you what I mean – from just [PRICING]. No big commitment, just a quick way to see if it's useful.

Fancy a chat?

Sent from my iPhone
```

### Lemlist Setup
1. Add "Email" step in campaign
2. Set delay: **0 days** after previous step
3. Paste subject above (lowercase, no period)
4. Paste body above
5. **IMPORTANT:** Replace placeholders manually for each lead:
   - `[SIGNAL_OBSERVATION]` = your observation hook (e.g., "you've built up a solid reputation with 45+ reviews")
   - `[PRICING]` = your pricing (e.g., "£97" or "$127")
6. Verify merge variables work: `{{firstName}}`, `{{companyName}}`, `{{location}}`, `{{businessType}}`
7. Enable tracking: Opens ✓, Clicks ✓

---

## Email 2 — Follow-Up 1 (Day 3)

### Subject Line
```
re: {{companyName}}
```

### Email Body
```
Hi {{firstName}},

Following up on my email about {{companyName}} – I know you're probably busy, but I wanted to check if you saw my message about using AI to [BENEFIT].

I've been helping {{businessType}} in the area with this, and it's been working really well. From just [PRICING] to get started.

If you're interested, let me know and I can show you how it works.

Cheers,

Sent from my iPhone
```

### Lemlist Setup
1. Add "Email" step in campaign
2. Set delay: **3 days** after previous step
3. Paste subject above
4. Paste body above
5. **IMPORTANT:** Replace placeholders:
   - `[BENEFIT]` = benefit from your angle (e.g., "keep clients coming back" or "save time on admin")
   - `[PRICING]` = your pricing (e.g., "£97")
6. Enable tracking: Opens ✓, Clicks ✓

---

## Email 3 — Different Angle (Day 7)

### Subject Line
```
one more thing – {{companyName}}
```

### Email Body
```
Hi {{firstName}},

I sent you a couple emails about {{companyName}} – didn't want to be a pest, but I had one more thought.

A lot of {{businessType}} I work with struggle with [DIFFERENT_ANGLE]. The AI system I mentioned could help with that too – it's pretty flexible.

From just [PRICING] to get set up. Worth a quick chat?

Let me know if you're interested.

Sent from my iPhone
```

### Lemlist Setup
1. Add "Email" step in campaign
2. Set delay: **7 days** after previous step
3. Paste subject above
4. Paste body above
5. **IMPORTANT:** Replace placeholders:
   - `[DIFFERENT_ANGLE]` = different problem from Email 1/2 (e.g., "keeping track of bookings" or "following up with clients")
   - `[PRICING]` = your pricing
6. Enable tracking: Opens ✓, Clicks ✓

---

## Email 4 — Final Attempt (Day 14)

### Subject Line
```
last one – {{companyName}}
```

### Email Body
```
Hi {{firstName}},

This'll be my last email – I know I've reached out a few times about {{companyName}}.

If you're not interested in using AI to help with [MAIN_BENEFIT], no worries. But if you are curious, I'm happy to show you a quick demo. From just [PRICING].

Let me know – otherwise, I'll leave you alone!

Sent from my iPhone
```

### Lemlist Setup
1. Add "Email" step in campaign
2. Set delay: **14 days** after previous step
3. Paste subject above
4. Paste body above
5. **IMPORTANT:** Replace placeholders:
   - `[MAIN_BENEFIT]` = main benefit from Email 1 (e.g., "client retention" or "online bookings")
   - `[PRICING]` = your pricing
6. Enable tracking: Opens ✓, Clicks ✓

---

## Important Notes

### Merge Variables You MUST Map in Lemlist

When adding leads to the campaign, ensure these custom fields are populated:

| Lemlist Field | Source | Example |
|--------------|--------|---------|
| `firstName` | Business owner first name | "Sarah" |
| `lastName` | Business owner last name | "Smith" |
| `companyName` | Humanized business name | "KissDental" (NOT "KissDental Bramhall") |
| `location` | City/town | "Bramhall" |
| `businessType` | Plural business type | "dentists" or "gyms" or "salons" |
| `linkedinUrl` | LinkedIn profile URL | "https://linkedin.com/in/sarah-smith" |

### Manual Replacements Required

The system generates personalized content for each business, but you need to manually replace these placeholders when setting up the sequence:

1. **`[SIGNAL_OBSERVATION]`** - The observation hook about their business
   - Examples:
     - "you've built up a solid reputation with 45+ reviews"
     - "you don't have much of an online presence yet"
     - "your website could use a refresh"

2. **`[PRICING]`** - Your micro-offer pricing
   - UK: "£97"
   - US: "$127"
   - AU: "A$147"

3. **`[BENEFIT]`** - The main benefit/angle
   - Examples:
     - "keep clients coming back"
     - "get more bookings online"
     - "save time on admin work"

4. **`[DIFFERENT_ANGLE]`** - A different problem (for Email 3)
   - Should be different from Email 1/2
   - Examples:
     - "keeping track of bookings"
     - "following up with clients"
     - "managing reviews"

5. **`[MAIN_BENEFIT]`** - Main benefit from Email 1 (for Email 4)
   - Same as the primary angle from Email 1

---

## Why This Approach?

**Generic + Manual Customization:**
- Email body is generic enough to work for all businesses
- Merge variables (`{{firstName}}`, `{{companyName}}`, etc.) auto-populate per lead
- Manual placeholders (`[SIGNAL_OBSERVATION]`, `[BENEFIT]`) allow you to inject the AI-generated personalization

**Workflow:**
1. System generates personalized emails with AI (Claude/GPT)
2. You extract the observation/angle/benefit from generated email
3. You paste those into the placeholders in Lemlist sequence
4. Sequence runs automatically for all leads with those customizations

---

## Alternative: Fully Manual Entry Per Lead

If you want FULLY personalized sequences (each lead gets unique emails), you'd need to:

1. Generate content for each business using the system
2. Manually add each business to Lemlist with their custom email sequence
3. Use the `export-email-sequence.js` script to format content for copy-paste

**Command:**
```bash
node ksd/local-outreach/orchestrator/utils/export-email-sequence.js "KissDental Bramhall"
```

This outputs the 4 emails with proper merge variables for manual Lemlist setup.

---

## Recommended Approach

**For scalability, use the generic sequence with manual placeholders:**

1. Set up the 4-email sequence in Lemlist (as shown above)
2. When generating content, extract the observation/benefit/angle from AI output
3. Replace the placeholders in Lemlist sequence once per campaign
4. Export all businesses to that campaign with proper merge variables

**This gives you:**
- ✅ Scalability (one sequence for all businesses)
- ✅ Personalization (merge variables auto-populate)
- ✅ Quality control (you review/customize the angles)
- ✅ Speed (bulk export instead of one-by-one)

---

## Questions?

If you want me to generate the EXACT personalized content for a specific business category, just ask:
- "Show me the exact emails for dentists"
- "What observation hooks work best for gyms?"
- "What are good angles for restaurants?"

I can provide category-specific templates with the observation/benefit/angle already filled in.
