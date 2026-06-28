# Mailead Load Settings — next batches (2026-06-28)

The 81 pilot is sent. These are the next batches, all prepped and Mailead-ready.
Mailead has no API, so loading is manual (~20 min each). Settings below are exact.

## ⚠️ Two things that block a clean send
1. **Column → merge-tag mapping.** Mailead renders `{{company_name}}` and `{{first_name}}`. If a column is named `company` it renders BLANK. On load, map the CSV `company` column to Mailead's **Company Name** field (the funded files already use `company_name`; the KSD file uses `company` — map it).
2. **Reoon before send.** KSD + LeadByte are DB/list-sourced (unverified). Funded is already Reoon-safe. Recommend verifying KSD 1,181 + LeadByte 226 first (your go-ahead — costs credits).

---

## Batch 1 — KSD accountants/solicitors (1,181) ✅ ready
- **File:** [exports/ksd-proservices-batch2-2026-06-24.csv](../exports/ksd-proservices-batch2-2026-06-24.csv) (clean, naturalised, deduped vs the 81)
- **Campaign:** `KSD · AI Search · Professional Services` (append to the existing one — same identity as the 81)
- **Boxes:** the 9 Kobestarr Digital boxes only
- **Sequence:** the locked 4-email KSD sequence — [pilot-ksd-pro-services-sequence.md](../exports/pilot-ksd-pro-services-sequence.md)
- **Subject (LOCKED, audited):** `AI search for {{company_name}} {{first_name}}`
- **Mapping:** `first_name`→First Name, `company`→**Company Name**, `category`/`town`→custom vars
- **Pacing:** 8–10/box/day across 9 boxes (~90/day → ~13 days for 1,181). First touch Mon–Thu, never Friday.
- **Pre-send:** Reoon-verify recommended (see Batch 4 command).

## Batch 2 — Funded founders, reoon-safe (187) ✅ ready, ⚠️ subjects unaudited
Three routes, three sequences ([funded-startups-2026-05-sequences.md](../exports/funded-startups-2026-05-sequences.md)). **Subjects are DRAFT — they need a cold-reader audit before send (house rule).** This is the one real blocker on the funded side.

| Route | File | Count | Pitch | Boxes (confirmed 2026-06-28) |
|-------|------|-------|-------|-----------------|
| A · Build-led | `exports/funded-mailead-A-buildled-2026-06-28.csv` | 52 | site is broken/thin → Kobestarr Digital build | DealFlow |
| B · AI-search | `exports/funded-mailead-B-aisearch-2026-06-28.csv` | 130 | live but AI-invisible | DealFlow |
| C · Podcast | `exports/funded-mailead-C-podcast-2026-06-28.csv` | 5 | media/founder-fit → Dealflow Media | Stripped |

- **Campaigns:** one per route (`KSD · Funded · Build`, `· AI Search`, `· Podcast`).
- **Mapping:** files already use `first_name` + `company_name` (correct). Extra columns (`route`, `siteStatus`, `round`, `fundUsd`) are reference, not merge tags.
- **Sequence:** A1–A4 / B1–B4 / C1–C4, Day 0/3/6/12, blank subjects after E1.
- **Box decision needed:** funded-founder identity = DealFlow/Stripped per the go-live pack. Confirm which 9 boxes before load.

## Batch 3 — LeadByte funded (226) ⏳ needs Reoon + format
- **File:** [exports/ToSend-leadbyte-funded.csv](../exports/ToSend-leadbyte-funded.csv) (`email,first_name,last_name,company,website,linkedin_url`)
- Needs: Reoon verify → map `company`→Company Name → same funded routing/sequences as Batch 2.

## Batch 4 — Reoon pre-send (when you say go)
Reoon verify works on **DB emails by campaign tag** (not a CSV path):
```bash
node verify-existing-emails-reoon.js --campaign=<tag> --dry-run   # plan only, no credits
node verify-existing-emails-reoon.js --campaign=<tag>             # live, respects 2,100/day
```
TODO before running: confirm which campaign tag covers the 1,181 KSD accountants/solicitors
(the batch was a DB pull; may need `tag-businesses.js` to stamp a `ksd-proservices-batch2` tag
first so the verify queue matches the exported file exactly).

---

## Send order (recency rule)
Newest drop sends first. KSD 1,181 is the freshest prepped batch → load it first. Funded 187 next (once subjects audited). LeadByte after Reoon.

## LinkedIn (parallel track)
Same-morning Prosp no-note connects + linkedapi.io ICP reactions reinforce these emails. linkedapi.io account must be connected in app.linkedapi.io first (see separate walkthrough).
