# Testing Summary

**Last Updated:** 2026-02-23

---

## Multi-Owner Lemlist Integration (2026-02-10)

**Status:** Production ready (with manual verification recommended)

- Multi-owner lead creation works (tested with KissDental Bramhall, 2 owners)
- Custom fields preserved (businessId, multiOwnerGroup, ownerCount, ownerIndex)
- Retry logic + rate limiting functional
- Bug fixed: empty Lemlist API response handling (commit f2df249)
- Known issue: GET /leads API returns empty — use Lemlist UI to verify

---

## UFH Football Clubs Pipeline (2026-02-22/23)

**Status:** Launch-ready for Tuesday 2026-02-24

### Scraping Results

| Area | Locations | Queries | Businesses Found | New Records |
|------|-----------|---------|-----------------|-------------|
| GM + East Cheshire | 36 | 216 | 1,331 | 912 |
| Chelsea-area | 16 | 96 | 711 | 472 |

### Enrichment Results

| Campaign | Websites Scraped | Regex Names | Regex Emails | LLM Names | LLM Emails | LLM Cost |
|----------|-----------------|-------------|-------------|-----------|-----------|----------|
| ufh-football-clubs | 461 + 411 (2 runs) | 83 | 229 | 120 | 14 | $0.60 |
| ufh-chelsea-area-clubs | 416 | 120 | 246 | 53 | 5 | $0.27 |

### Export Filtering

| Campaign | Raw Emails | After Junk Filter | After Reoon | Final |
|----------|-----------|-------------------|-------------|-------|
| GM + East Cheshire | 516 | 274 | **255** | **255** |
| Chelsea-area | 267 | 156 | **144** | **144** |

Junk filter removed: sentry/wixpress emails, non-football businesses (schools, pubs, hotels, shops, rugby/cricket/boxing clubs, etc.), garbage contact names (Pitchero artifacts).

### Reoon Verification

- 412 unique emails verified
- Valid: 323 | Risky (catch-all, kept): 63 | Invalid (removed): 26 | Errors: 0
- 93% pass rate

### Issues Encountered

1. **soccerstars.com hang** — website with 24 sitemap URLs caused enrichment to hang indefinitely. Fixed by:
   - Marking business as skipped in `business_data` JSON (not just flat columns)
   - Adding 60s per-website timeout to `enrich-campaign.js` for future runs
2. **Category pollution** — Google Maps returns non-football businesses for football searches. Fixed with comprehensive category-based filtering in export (50+ excluded categories).
3. **Broken email patterns** — Cloudflare email obfuscation produces `6AEMail...` prefixes. Added to junk email filter.

### Files Produced

- `exports/ufh-football-clubs-mailead-2026-02-22-verified.csv` — 255 verified GM leads
- `exports/ufh-chelsea-area-clubs-mailead-2026-02-22-verified.csv` — 144 verified Chelsea leads
- `exports/ufh-football-clubs-email-sequence.md` — 3-email sequences (both campaigns)
- `exports/ufh-press-pitch.md` — Casual press pitch (Lexi/Chelsea mascot story)
- `exports/ufh-press-release.md` — Formal press release
