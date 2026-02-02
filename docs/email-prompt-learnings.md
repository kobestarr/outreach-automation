# Email Prompt Engineering - Learnings & Test Results

**Date:** February 1, 2026  
**Status:** In Progress - Initial Testing Complete

---

## Overview

This document tracks the iterative process of refining email generation prompts through systematic testing across all business scenarios.

---

## Issues Identified in Initial Testing

### Test Results Summary (Restaurant Category, Tier 2)
- **Total Scenarios Tested:** 12
- **Passed:** 4 (33%)
- **Failed:** 8 (67%)
- **Average Quality Score:** 86% (but failing due to personalization issues)

### Key Issues Found

#### 1. **Owner Name Not Mentioned** ❌
**Problem:** Many emails used "Hi there" instead of "Hi Sarah"
- **Root Cause:** Prompt had bug: `Owner First Name: ${businessName}` instead of `${ownerFirstName}`
- **Impact:** Failed personalization check (20% of quality score)
- **Fix Applied:** ✅ Fixed prompt to use `${ownerFirstName}` and added explicit requirement

#### 2. **Missing Category-Specific References** ❌
**Problem:** Emails didn't use restaurant-specific language (food, meals, dining, etc.)
- **Root Cause:** No guidance on category-specific terminology
- **Impact:** Failed category check (25% of quality score)
- **Fix Applied:** ✅ Added category-specific language guidance for all 7 categories

#### 3. **Prompt Structure Issues** ⚠️
**Problem:** Requirements were scattered and not prioritized
- **Fix Applied:** ✅ Reorganized into "PERSONALIZATION REQUIREMENTS (CRITICAL)" section

---

## Prompt Improvements Made

### 1. Fixed Owner Name Bug
**Before:**
```
- Owner First Name: ${businessName} (use this naturally in opening)
```

**After:**
```
- Owner First Name: ${ownerFirstName} (MUST use this name in opening greeting - e.g., "Hi ${ownerFirstName},")
```

### 2. Added Category-Specific Language Guidance
**Added:**
```
- Category-Specific Language: Since this is a ${category}, use relevant terms naturally:
  * Restaurant: food, meals, dining, menu, dishes, cuisine, customers, footfall
  * Salon: hair, styling, cuts, treatments, appointments, clients
  * Gym: fitness, workouts, membership, training, exercise, members
  * Dentist: dental, teeth, oral health, checkups, patients
  * Plumber: plumbing, pipes, repairs, installations, emergencies
  * Cafe: coffee, drinks, brews, cuppa, morning rush, regulars
  * Accountant: accounting, tax, financial, books, compliance, clients
  Reference the category naturally in your email (e.g., "restaurant" or "food" for restaurants)
```

### 3. Strengthened Personalization Requirements
**Before:**
```
- Use ${ownerFirstName}'s name naturally in the opening
```

**After:**
```
- PERSONALIZATION REQUIREMENTS (CRITICAL):
  * MUST start with "Hi ${ownerFirstName}," or "Hello ${ownerFirstName}," - use their actual name, NOT "Hi there" or "Hello"
  * MUST mention ${businessName} by name in the email body
  * MUST reference ${location} specifically
  * MUST use category-specific language (see above)
```

### 4. Improved Example
**Before:**
```
Subject: Quick question about ${businessName}
Body: Hi ${ownerFirstName},

I noticed ${businessName} in ${location} and was impressed by your ${rating || "excellent"} rating.

[Rest of email...]
```

**After:**
```
Subject: Quick question about ${businessName}
Body: Hi ${ownerFirstName},

I noticed ${businessName} in ${location} and your ${rating || "excellent"} rating shows strong customer satisfaction. As a ${category} owner, I reckon you're focused on ${jtbdFear || "growing your business"}. Fancy a quick chat over a cuppa to discuss how we could help?

Cheers,
[Your Name]
```

---

## Test Framework Created

### Files Created
1. **`shared/outreach-core/content-generation/email-quality-validator.js`**
   - Comprehensive validation functions
   - Quality scoring system
   - Checks: UK tone, length, personalization, rating handling, banned phrases, subject parsing, CTA

2. **`ksd/local-outreach/orchestrator/utils/email-prompt-tester.js`**
   - Test scenario matrix generator
   - Automated testing across categories, tiers, data quality, barter scenarios
   - Quality reporting

### Test Scenarios Matrix
- **Categories:** 7 (Restaurant, Salon, Gym, Dentist, Plumber, Cafe, Accountant)
- **Tiers:** 5 (Tier 1-5 with different revenue ranges and offers)
- **Data Quality:** 4 scenarios (High rating, Low rating, No reviews, Standard)
- **Barter:** 3 scenarios (With barter, No barter, Barter taken)
- **Total Combinations:** 7 × 5 × 4 × 3 = 420 scenarios

---

## Next Steps

### Immediate (When API Quota Available)
1. Re-test restaurant category with improved prompts
2. Verify owner name is now included
3. Verify category-specific language is used
4. Test other categories (salons, gyms, etc.)

### Short-term
1. Test all tier variations
2. Test edge cases (low ratings, missing data)
3. Test barter scenarios
4. Test email sequence positions

### Long-term
1. A/B test different prompt variations
2. Track open/reply rates in Lemlist
3. Iterate based on real-world performance

---

## Quality Metrics

### Current Quality Checks
- ✅ UK Tone (15% weight)
- ✅ Length (10% weight)
- ✅ Personalization (20% weight) - **CRITICAL**
- ✅ Rating Handling (15% weight)
- ✅ Banned Phrases (20% weight) - **CRITICAL**
- ✅ Subject Parsing (10% weight)
- ✅ CTA (10% weight)

### Target Quality Score
- **Minimum:** 85% overall
- **Must Pass:** Banned phrases check (deal-breaker)
- **Goal:** 90%+ for production

---

## Examples

### Good Email (From Test)
```
Subject: Boosting traffic at The Restaurant Test
Body: Hi there,

Just spotted The Restaurant Test in lovely Bramhall and your brilliant 4.8 rating caught my eye. It's clear customers adore your place, but...

Score: 86%
Issues: Owner name not mentioned, no category-specific references
```

### Expected After Fixes
```
Subject: Quick question about The Bramhall Bistro
Body: Hi Sarah,

I noticed The Bramhall Bistro in Bramhall and your 4.5 rating shows strong customer satisfaction. As a restaurant owner, I reckon you're focused on getting more customers through the door. Fancy a quick chat over a cuppa to discuss how we could help?

Cheers,
[Your Name]

Expected Score: 95%+
```

---

## Files Modified

1. **`shared/outreach-core/content-generation/gpt-email-generator.js`**
   - Fixed owner name bug
   - Added category-specific guidance
   - Strengthened personalization requirements
   - Improved example

2. **`shared/outreach-core/content-generation/email-quality-validator.js`** (NEW)
   - Quality validation functions

3. **`ksd/local-outreach/orchestrator/utils/email-prompt-tester.js`** (NEW)
   - Test framework

---

## Notes

- **API Quota:** Hit OpenAI quota limit during testing - need to wait or use different API key
- **Testing Approach:** Automated testing + manual review in chat
- **Iteration Cycle:** Test → Review → Fix → Re-test

---

**Last Updated:** February 1, 2026  
**Next Test:** When API quota available - re-test restaurant category
