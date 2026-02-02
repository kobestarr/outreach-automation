# Credit Usage Optimization

## Issue
- 1,022 credits used for 41 businesses (~25 credits per business)
- HasData appears to charge per business result, not per API request

## Solutions

### Option 1: Disable Email Extraction (if not critical)
Set  in google-maps-scraper.js
- Email extraction might add extra cost per business
- We can extract emails separately using other methods

### Option 2: Use Direct API Instead of Job API
- Direct API: 5 credits per request (all businesses)
- Job API: ~25 credits per business result
- Trade-off: Direct API might have rate limits

### Option 3: Batch Processing
- Process businesses in smaller batches
- Only scrape what you need
- Skip businesses that don't meet criteria early

### Option 4: Check HasData Dashboard
- Verify actual credit breakdown
- Confirm per-business vs per-request pricing
- Contact HasData support for clarification

## Immediate Action
1. Check HasData dashboard for credit breakdown
2. Consider disabling email extraction for testing
3. Verify if we can use direct API instead
