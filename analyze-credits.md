# Credit Usage Analysis

## Current Situation
- Starting credits: 200,000
- Credits after 41 businesses: 198,978
- Credits used: 1,022
- Credits per business: ~25

## HasData Pricing (from docs)
- Google Maps API: 5 credits per request
- We made 1 request for all 41 businesses
- Expected: 5 credits
- Actual: 1,022 credits

## Possible Explanations

### 1. Email Extraction Charges
If  charges per business:
- 41 businesses × 25 credits = 1,025 credits ✓ (matches!)

### 2. Per-Result Charging
If HasData charges per business result instead of per request:
- 41 businesses × 25 credits = 1,025 credits ✓ (matches!)

### 3. Multiple API Calls
If the system is making multiple HasData calls per business:
- Need to check for loops or retries

## Recommendation
1. Check HasData dashboard for detailed credit breakdown
2. Consider disabling email extraction if not needed
3. Batch requests more efficiently
4. Check if there are retry loops causing duplicate charges
