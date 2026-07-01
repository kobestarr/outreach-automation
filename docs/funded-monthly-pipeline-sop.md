# Funded Founders (LeadByte) — Monthly Campaign SOP

The repeatable pipeline for the monthly "1K - Current Month" funded drop (LeadByte source).
Run this each time a new drop lands. **Newest drop sends first** (recency rule) — a fresh
drop takes priority over the prior month's leftovers.

## 0. When the drop lands
File arrives at `~/Downloads/1K - Current Month (N).csv` (~1,000 recently-funded companies
with decision-maker email + Needs-Website flag). Note the N (increments each month).

## 1. Process (ICP filter + truth-check + AI-score) — ~10-20 min
```
node process-funded-startups.js "/Users/kobestarr/Downloads/1K - Current Month (N).csv"
```
→ `exports/funded-startups-<month>-checked.csv`. Does: English-geo + decision-maker + has-email
filter; buckets by pitch (kobestarr=AI/SaaS, stripped=media, dealflow=default); fetches each
site and classifies (dead/parked/thin/http4xx/ok); scores AI-search readiness (aiScore, aiInvisible).

## 2. Verify emails (Reoon) — splits by deliverability
```
node verify-funded-startups.js exports/funded-startups-<month>-checked.csv
```
→ `-warm.csv` (safe — send now) · `-other.csv` (catch_all/risky — slow drip) · `-drop.csv` (invalid — never send).
**Reality: expect heavy attrition.** Last drop was ~46% invalid. A 700-row checked file
typically yields only ~200 safe. That's normal — protect domain reputation, send warm only.

## 3. Assemble Mailead-ready route files
```
node assemble-funded-mailead.js --warm exports/funded-startups-<month>-warm.csv \
     --other exports/funded-startups-<month>-other.csv --date <YYYY-MM-DD> --safe-only
```
→ `funded-mailead-{A,B,C}-<date>.csv`. Routes by lead component (A build-led / B AI-search /
C podcast), naturalises shouty names, dedups. `--safe-only` = first wave (reoonSafe only).

## 4. Load to Mailead (manual, ~20 min)
- **One NEW dated campaign per identity** (never re-upload — Mailead deletes on re-upload).
  - `KSD · AI Search · Funded · Build · <month>` (Route A)
  - `KSD · AI Search · Funded · AI-Search · <month>` (Route B)
  - `KSD · AI Search · Funded · Podcast · <month>` (Route C → Stripped boxes)
- **Boxes:** DealFlow for A/B, Stripped for C (funded = B2B → DealFlow per ICP audit).
- **Sequence:** [leadbyte-funded-sequence.md](../exports/leadbyte-funded-sequence.md) — 4 emails, subject
  `AI search for {{company_name}} {{first_name}}`, "Sent from my iPhone" voice, blank after E1.
- **Column mapping gotcha:** map CSV `company_name` → Mailead **Company Name** field.
- **Cadence:** Day 0/3/6/12, Mon-Fri, first touch never Friday.

## 5. The two standing realities
- **Audit on reply (the door):** every email promises an AI-visibility audit "already prepared."
  Generate it ON REPLY via **Searchable** (`api.searchable.com/v1` + MCP) per the replier's domain.
  See the on-reply audit-generator (build in progress). Until built, produce manually from
  `funded-startups-<month>-checked.csv` (aiScore, siteStatus, signals).
- **LinkedIn is broken off this list:** the funded LinkedIn URLs are enrichment guesses — ~94%
  don't resolve. So this list is an EMAIL play. For the LinkedIn lane (reactions + Prosp connects),
  use the **engagement hunter** (real active commenters on ICP posts), NOT these handles.

## Funnel expectation (per ~1,000 drop)
~1,000 raw → ~700 truth-checked → ~200 Reoon-safe emailable → routed A/B/C. LinkedIn-usable: a handful.

## Offer + ladder
Free AI-visibility audit → Foundation (build/retrofit) → Authority Engine retainer.
See [funded-startups-authority-offer.md](funded-startups-authority-offer.md).
