# Outscraper API Integration Issue - Post-Mortem

**Date:** February 7, 2026  
**Status:** RESOLVED  
**Affected Versions:** v1.1.0 - v1.1.2  
**Resolution:** v1.1.3

---

## Executive Summary

The Outscraper Google Maps scraper was failing silently due to an incorrect API endpoint configuration. The job submission endpoint (`api.outscraper.com`) was working correctly, but the results polling endpoint was incorrectly configured, causing all scrapes to timeout or return empty results.

---

## The Problem

### Symptom
- Outscraper scraper appeared to start successfully
- Jobs would hang indefinitely or return empty results
- No clear error messages in logs
- Fallback to HasData scraper was working, masking the issue

### Root Cause
Outscraper uses **two different domains** for their API:

| Purpose | Domain | Endpoint Example |
|---------|--------|------------------|
| Job Submission | `api.outscraper.com` | `GET /maps/search-v3` |
| Results Polling | `api.outscraper.cloud` | `GET /requests/{jobId}` |

**The Bug:** The original code was attempting to poll results from `api.outscraper.com/requests/{jobId}`, but this endpoint doesn't exist on that domain. The correct domain for polling is `api.outscraper.cloud`.

### Code Before Fix (BROKEN)
```javascript
const OUTSCRAPER_BASE_URL = "api.outscraper.com";

// Job submission - CORRECT
const options = {
  hostname: OUTSCRAPER_BASE_URL,  // api.outscraper.com
  path: `/maps/search-v3?${params.toString()}`,
  // ...
};

// Results polling - INCORRECT (same domain)
const options = {
  hostname: OUTSCRAPER_BASE_URL,  // api.outscraper.com - WRONG!
  path: `/requests/${jobId}`,
  // ...
};
```

### Code After Fix (WORKING)
```javascript
const OUTSCRAPER_BASE_URL = "api.outscraper.com";
const OUTSCRAPER_RESULTS_URL = "api.outscraper.cloud";

// Job submission - CORRECT
const options = {
  hostname: OUTSCRAPER_BASE_URL,  // api.outscraper.com
  path: `/maps/search-v3?${params.toString()}`,
  // ...
};

// Results polling - CORRECT (different domain)
const options = {
  hostname: OUTSCRAPER_RESULTS_URL,  // api.outscraper.cloud - CORRECT!
  path: `/requests/${jobId}`,
  // ...
};
```

---

## Why This Happened

### 1. Incomplete API Documentation
The Scrapula API documentation provided (`scrapula-api-docs.json`) only contained **Platform UI endpoints** (`/tasks`, `/requests`, `/profile`, etc.) and did not include the actual **scraping endpoints** (`/maps/search-v3`).

### 2. Misleading Rebranding
Outscraper has rebranded to Scrapula, causing confusion about:
- Which API endpoints to use
- Whether the old Outscraper endpoints still work
- Whether Scrapula uses different endpoints

**Key Finding:** The old Outscraper endpoints (`api.outscraper.com` and `api.outscraper.cloud`) continue to work with Scrapula API keys.

### 3. Silent Failure Mode
The bug caused silent failures:
- HTTP requests to wrong domain would timeout or return 404
- Error handling caught these but logged at debug level
- System fell back to HasData scraper, masking the issue

---

## Investigation Process

### Step 1: Identify the Issue
- User reported Outscraper "wasn't working"
- Checked logs - no clear errors
- Tested API key manually with curl

### Step 2: Test API Endpoints
```bash
# Test job submission - WORKED
curl -H "X-API-KEY: <key>" \
  "https://api.outscraper.com/maps/search-v3?query=..."
# Returns: {"id":"...","status":"Pending"}

# Test results polling on same domain - FAILED
curl -H "X-API-KEY: <key>" \
  "https://api.outscraper.com/requests/{id}"
# Returns: 404 or timeout

# Test results polling on .cloud domain - WORKED
curl -H "X-API-KEY: <key>" \
  "https://api.outscraper.cloud/requests/{id}"
# Returns: {"data": [...], "status": "Success"}
```

### Step 3: Verify Fix
- Updated code to use separate domains
- Tested with live API key
- Confirmed 29 hairdressers returned for "Bramhall SK7" query

---

## Technical Details

### API Flow

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   Client        │────▶│  api.outscraper.com  │────▶│   Job Queue     │
│   (Our Code)    │     │  /maps/search-v3     │     │                 │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
         │                                                    │
         │                                                    │
         │              ┌──────────────────────┐              │
         └─────────────▶│  api.outscraper.cloud│◀─────────────┘
                        │  /requests/{jobId}   │
                        │  (Poll for results)  │
                        └──────────────────────┘
```

### Response Format

**Job Submission Response:**
```json
{
  "id": "a-a06e0a0b-5ca0-489c-ad5c-f8748c6f7f84",
  "results_location": "https://api.outscraper.cloud/requests/a-a06e0a0b-...",
  "status": "Pending"
}
```

**Results Response:**
```json
{
  "data": [[
    {
      "name": "Eds Hair",
      "address": "13 Bramhall Ln S, Bramhall...",
      "phone": "+44 161 439 8058",
      "rating": 4.9,
      "reviews": 814,
      ...
    }
  ]],
  "status": "Success"
}
```

Note: `data` is a nested array `[[{...}]]` - one outer array per query, inner array contains businesses.

---

## Lessons Learned

### For Developers

1. **Always Test Full API Flow**
   - Don't just test the initial request
   - Test the complete lifecycle: submit → poll → retrieve

2. **Check for Multiple Domains**
   - Some APIs use different domains for different operations
   - Common pattern: submission API vs results CDN

3. **API Documentation May Be Incomplete**
   - The provided `scrapula-api-docs.json` was missing scraping endpoints
   - When docs are incomplete, test with actual API calls

4. **Silent Failures Are Dangerous**
   - The fallback to HasData masked the issue
   - Consider making primary scraper failures more visible

### For Future Maintenance

1. **Document API Endpoint Changes**
   - Outscraper → Scrapula rebranding caused confusion
   - Keep API endpoint documentation up-to-date

2. **Version API Integrations**
   - Track API changes from third-party providers
   - Set up monitoring for API endpoint deprecations

3. **Test with Real API Keys**
   - Mock tests wouldn't catch this issue
   - Regular integration tests with live keys

---

## Configuration

### Required Credentials

Add to `~/.credentials/api-keys.json`:

```json
{
  "outscraper": {
    "apiKey": "ZHAjMDg5YTdjYTM4YmUwNDA0NGE3ZWMzZWViZmIyZTI1NDB8MmM5ZDRkZWZiZg"
  }
}
```

Note: The same API key works for both Outscraper and Scrapula.

### Environment Variables

Optional overrides:
```bash
OUTSCRAPER_BASE_URL=api.outscraper.com        # Job submission
OUTSCRAPER_RESULTS_URL=api.outscraper.cloud   # Results polling
```

---

## Related Commits

- `0107796` - fix: correct Outscraper API endpoints
- `0f5322f` - fix: update Outscraper integration to use Scrapula API (attempted wrong fix)
- `2706c54` - feat: add Outscraper scraper with HasData fallback system

---

## References

- Outscraper/Scrapula API Docs: https://outscraper.com/google-maps-scraper/
- API Base URLs:
  - Submission: `https://api.outscraper.com`
  - Results: `https://api.outscraper.cloud`
