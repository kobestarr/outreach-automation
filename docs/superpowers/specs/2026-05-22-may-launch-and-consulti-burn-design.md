# May 26 Launch + Consulti Credit Burn-Down — Design Spec

**Date:** 2026-05-22 (Fri)
**Author:** Kobi Omenaka + Claude
**Status:** Draft, awaiting review
**Operational deadline:** 2 campaigns live by Tue 26 May 2026 (Mon 25 May is UK bank holiday)
**Hard external deadline:** Consulti beta credits expire Sun 31 May 2026 — must be burned aggressively

---

## 1. Goal

Stand up two cold outreach campaigns by Tuesday morning while simultaneously exhausting the Consulti beta credit pool before the 31 May expiry. The two campaigns are independent and use different sending tools, but share infrastructure (DB, Consulti verification/lookup, enrichment pipeline) and a synchronised launch window.

## 2. Non-goals

- Building any new pricing logic (already in DB: `assigned_tier`, `setup_fee`, `monthly_price`)
- LinkedIn outreach for the local trades campaign (audience has no usable LI URLs)
- Finalising email subject lines and body copy in this spec — see §10
- Kondo integration (deferred; Kondo is inbox/CRM-leaning, not cold outreach)
- Reoon usage (Consulti is the verifier of record for this launch to burn beta credits)

## 3. Constraints + facts pulled from the live system (2026-05-22)

- **Consulti credit balance:** 24,062 verification credits + 12,498 lead-lookup credits. Lead credits are the more valuable asset.
- **Burn-rate target:** ~2,670 verify/day, ~1,390 lead-lookup/day for full zeroing. Realistic: 5–10k verify burned, 8–10k lead-lookup burned if we aggressively scrape new LinkedIn lists Wed–Fri next week.
- **Pricing tiers (live in DB):**
  - T1: 569 businesses · £47 setup · £197/mo
  - T2: 594 businesses · £997 setup · £297/mo
  - T3: 61 businesses · £2,997 setup · £497/mo
  - T4: 10 businesses · £5,997 setup · £497/mo
  - T5: 2 businesses · £7,997 setup · £797/mo
- **Local trades audience already in DB (non-cleaning, SM/E-Ches postcodes):** ~291 with email. Affluent WA14/15/16 + SK9/10/12 are not yet scraped.
- **Cardiologists in DB:** 284 (LeadRocks re-import, May 17–18, currently uncommitted).
- **Consulti API:** `/credits` is free; `/verify` is 1 credit (0 on cache hit / invalid); `/leads/find-by-linkedin` and `/leads/find-by-name` are 1 lead-credit each (0 on no-match). Server-side cache is 6 months.

## 4. Architecture overview

Two campaigns, three Waves:

| Wave | Window | Cardiologists | Local trades |
|---|---|---|---|
| **1** | Tue 26 May (launch day) | Lemlist multichannel · ~284 LeadRocks contacts · Nigel Stephens hook · email + LI in one sequence | Mailead email-only · ~291 SM/E-Ches non-cleaning contacts · David Wood hook · 3-email sequence |
| **2** | Wed/Thu 28–29 May | Newly Consulti-enriched cardiologists from LinkedIn → email lookup, plus an adjacent-specialty cohort (private consultants in other specialties scraped via Apify LI-search) | Newly scraped WA14/15/16/SK9/10/12 contacts, verified via Consulti |
| **3** | Week of 2 Jun | Prosp-driven LI-only push for cardiologists who didn't respond to Wave 1 email touches | TBD — follow-up cadence, opt-outs, bounce sweeps |

### 4.1 Tool routing

| Tool | Wave 1 role | Why |
|---|---|---|
| **Lemlist** | Cardiologists (email + LI in one sequence) | Native multichannel; LeadRocks gave us LI URLs; `kobi@kobestarr.io` sender already warm |
| **Mailead** | Local trades (3 emails) | Pre-warmed sender pool, 150/day per inbox, proven on UFH launch |
| **Prosp** | Wave 2/3 LinkedIn DM lane for cardiologist non-responders | LinkedIn DM automation tool — kept out of Wave 1 to avoid double-tapping Lemlist's LI step |
| **Kondo** | Wave 2/3 LinkedIn DM lane (A/B against Prosp on a second cohort) | Also a LinkedIn DM tool. Wave 1 uses Lemlist's native LI step; Prosp + Kondo split the follow-up work in Wave 2/3 |
| **Consulti** | Verifier of record + lead-lookup engine across both campaigns and all Waves | Beta credits expiring 31 May — must burn |
| **Reoon** | Standby fallback if Consulti hits issues | Lifetime deal credits don't expire; defer use until next launch |

## 5. Audience selection

### 5.1 Cardiologists (`cardiologists-nigel-2026`)

```sql
SELECT * FROM businesses
WHERE category = 'Consultant Cardiologist'
  AND owner_email IS NOT NULL AND owner_email != ''
  AND (consulti_status IN ('good','risky') OR consulti_status IS NULL);
```

The `consulti_status IS NULL` bucket must be passed through Consulti `/verify` before send. Target ~230 clean post-verify. Wave 2 adds contacts where we have a LinkedIn URL but no email — Consulti `/leads/find-by-linkedin` to discover.

### 5.2 Local trades (`local-trades-david-wood-2026`)

```sql
SELECT * FROM businesses
WHERE substr(postcode,1,3) IN (
    'SK7','SK8','SK9','SK10','SK11','SK12',
    'WA14','WA15','WA16',
    'M33','SK6','SK1','SK2','SK3','SK4'
  )
  AND category NOT IN (
    'Football club','Soccer club','Sports club','Sports complex','Sports school',
    'Soccer field','Soccer practice','Park','Club','Pub',
    'Consultant Cardiologist','journalist','podcast'
  )
  AND category NOT LIKE '%cleaner%'
  AND category NOT LIKE '%gutter%'
  AND category NOT LIKE '%window%'
  AND owner_email IS NOT NULL AND owner_email != ''
  AND assigned_tier >= 1;
```

Cleaner/gutter/window exclusions protect David Wood from his own outreach reaching competitors. Tier filter is a sanity guard. Target ~291 today; with Saturday scrape projected 500–700 by Mon.

### 5.3 Wave 2 scrape (local trades)

Postcodes to add via `explore-football-clubs.js` (or its multi-campaign equivalent retargeted to local trades):
`WA14 Altrincham, WA15 Hale/Hale Barns, WA16 Knutsford, SK9 Alderley Edge/Wilmslow, SK10 Prestbury/Macclesfield, SK12 Poynton`

Categories: same TRADESPEOPLE / HOME_SERVICES / PROFESSIONAL / AUTOMOTIVE groups as the Bramhall scrape minus the cleaning exclusions.

## 6. Enrichment + verification flow

```
Cardiologist (LeadRocks)        Local trade (Maps scrape)
       │                                  │
       ▼                                  ▼
 has email? ──no──►  Consulti       has email? ──no──► LLM extractor
       │           /find-by-linkedin       │           (existing)
       │                  │                │
       ▼                  ▼                ▼
        ───── Consulti /verify (all emails, including re-verifies) ─────
                              │
                              ▼
                  consulti_status persisted to DB
                              │
                              ▼
        Filter: deliverable OR risky → Export to Lemlist / Mailead
```

All Consulti calls go through `shared/outreach-core/email-verification/consulti-verifier.js`. DB columns `consulti_status`, `consulti_deliverable`, `consulti_role`, `consulti_catch_all`, `consulti_verified_at` already exist.

## 7. Sequence shape (both campaigns)

3 emails, Day 0 / Day 3 / Day 7 — same cadence proven on the UFH football clubs launch. Cardiologists Lemlist sequence interleaves LI touches between email steps (specific LI cadence TBD in copy session, but envelope is: LI connection request Day 1, LI message Day 5).

DB campaign tags:
- `cardiologists-nigel-2026`
- `local-trades-david-wood-2026`

Reply detection via existing `shared/outreach-core/export-managers/check-replies.js` + `reply-detector.js`.

## 8. Pricing in copy

Each email uses Mailead/Lemlist merge variables to surface tier-appropriate pricing:
- `{{setup_fee}}` and `{{monthly_price}}` from DB
- Frame depends on tier — T1 leads with the low-friction starter price, T3+ leads with the full programme

The copy session (see §10) will lock the exact phrasing per tier. Engineering-side: the merge-variable schema is already implemented (`shared/outreach-core/content-generation/email-merge-variables.js`).

## 9. Consulti burn-down schedule

| Day | Verify | Lead-lookup | Outcome |
|---|---|---|---|
| Fri 22 May | Re-verify all DB emails (~1,500) | Lookup-by-LinkedIn for all 284 cardiologists | Cardiologist Wave 1 list locked |
| Sat 23 May | Verify new scrape (~500–800 new contacts) | — | Wave 2 trades list built |
| Sun 24 May | — | Lookup any LI URLs from new scrapes (~300) | Wave 2 trades enriched |
| Mon 25 May (BH) | Final pre-send verify pass on Wave 1 | — | Final QA |
| **Tue 26 May** | — | — | **Wave 1 LIVE** |
| Wed 27 May | Verify new adjacent-specialty scrape | Lead-lookup the new vertical | Wave 2 cardiology adjacent |
| Thu 28 May | — | Lead-lookup more verticals | Burn lead credits aggressively |
| Fri 29 May | Final verify | Final lookups | Empty lead-credit bucket |
| Sat 30 May | Spillover | Spillover | Burn anything left |
| Sun 31 May | — | — | Credits expire 23:59 |

Estimated final burn: 5–10k verify (of 24k), 8–10k lead-lookup (of 12.5k). Lead-lookup is where time should land — it produces new contacts, not just status updates.

## 10. Deferred work (explicitly NOT in this spec)

The following are out of scope for the implementation plan and will be handled in dedicated sessions:

1. **Email copy and subject lines.** Both campaigns. To be drafted in a focused copy session on Mon 25 May. Subject lines must pass a cold-reader audit (see [[feedback-subject-lines-cold-reader]]). Real customer quotes are body-copy material, not subject-line material.
2. **Nigel Stephens case-study specifics.** Kobi to supply: Nigel's role/specialism, one concrete before/after result (enquiries, ranking, AI Overview presence), one direct quote. Without these the cardiologist email reads generic.
3. **Mailead AI training doc update.** Trades-specific auto-reply tone, building on the existing UFH version at `exports/ufh-mailead-training-doc.md`.
4. **Wave 3 Prosp LI sequence design.** Locked once Wave 1 cardiologist response data is in.

## 11. Tuesday readiness checklist

By 23:59 Mon 25 May:

1. ~284 cardiologists Consulti-verified, Lemlist sequence built and uploaded, Nigel hook copy finalised with §10.2 facts.
2. ~291+ local trades Consulti-verified, Mailead sequence built and uploaded, David Wood hook copy finalised with tier-pricing merge.
3. Each sequence test-sent to one personal inbox.
4. DB tagged: `cardiologists-nigel-2026` and `local-trades-david-wood-2026`.
5. Reply detection wired and tested (existing scripts).
6. Mailead training doc updated for trades.
7. Bounce/unsubscribe sweep scheduled for Wed 28 May.

## 12. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Consulti API rate limits or downtime during burn-down | Reoon as standby; burn-down spread across 9 days, not concentrated |
| Cardiologist domains are corporate (NHS / hospital) — high bounce risk | Verify everything via Consulti before send; risky tier still send via Lemlist (per established practice) |
| LeadRocks 2024 emails 2 years stale — high bounce | Consulti re-verify before Wave 1; drop `consulti_status = 'invalid'` rows |
| Mailead sender warm-up insufficient for 291+ contacts on Day 1 | Stagger send across multiple Mailead inboxes; respect 150/day cap; pre-warmed pool already established from UFH launch |
| Bank holiday Mon → DNS/SMTP issues unnoticed | Test sends Sun evening, not Mon |
| Subject lines drafted by Claude without cold-reader audit | Defer all copy to Mon copy session; Claude not to finalise subjects (see [[feedback-subject-lines-cold-reader]]) |

## 13. Success criteria

By Wed 27 May EOD:

- Both campaigns sent Day 0 emails with <5% bounce rate
- Consulti verify credits down by ≥3,000 from current 24,062
- Consulti lead-lookup credits down by ≥1,500 from current 12,498
- Reply detection actively firing for both campaigns
- Wave 2 scrape complete and verified, ready to ship Wed/Thu

By Sun 31 May 23:59:

- Consulti verify credits ≤19,000 burned (target 10,000 used)
- Consulti lead-lookup credits ≤4,000 remaining (target 8,500 used)
- All three Waves shipped
