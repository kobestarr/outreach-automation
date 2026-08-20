# Handover: reactions credit burn, diagnosis + fixes (2026-08-20)

**Read this before touching `daily-reactions-batch.js` or topping up Renidly credits.**

Companion doc: [`PRD-profile-views-ramp.md`](./PRD-profile-views-ramp.md) — the next build.
Prior modelling: `kobestarr-tools/docs/superpowers/specs/2026-08-05-renidly-burn-model.md`.

---

## 1. What happened

An 18,500-credit Renidly pack (~$100, bought ~5 Aug) was **exhausted in 10 days**.
Balance on 20 Aug: **16 credits**. Account demoted to `Testing` tier (7 req/min).

Measured burn, from the engine's own daily summary line:

| Date | Likes fired | API calls | Credits burned |
|---|---|---|---|
| 6 Aug | 190 | 1,256 | 1,388 |
| 7 Aug | 190 | 2,602 | **2,854** |
| 8 Aug | 190 | 2,614 | **2,897** |
| 9 Aug | 190 | 2,048 | 1,857 |
| 10 Aug | 190 | 1,852 | 1,400 |
| 11 Aug | 190 | 2,033 | 1,895 |
| 12 Aug | 190 | 1,878 | 1,332 |
| 13 Aug | 56 | 944 | 475 |
| 14 Aug | 88 | 1,302 | 885 |
| 15 Aug | 17 | 891 | 143 (dry) |

**17,924 credits in 10 days, ~1,790/day. Calls bill at ~1.03 credits, so calls == credits.**

Sole consumer: `/root/linkedin-reactions/daily-reactions-batch.js` on clawdbot.
Nothing to do with linkedin-content-intel, the infographics engine, or any swipe-miner work.

## 2. Root causes

### 2.1 The JSON config overrides the JS defaults (THE TRAP)

```js
const cfg = { ...DEFAULT_CONFIG, ...loadJson(CONFIG_PATH, {}) };
```

`data/reactions-daily-config.json` **wins** over `DEFAULT_CONFIG` in the `.js`.
Editing the script's defaults alone changes **nothing** for any key present in the JSON.
This is why the source read `resolveCallBudget: 2500` while the engine actually ran at **6000**.

**Always patch both.** Verify with the run's own `Pools:` log line, not by reading the source.

### 2.2 A floor is not a cap

The only guard was `creditHardFloor: 150` — stop when nearly *empty*. There was no per-day
budget that ever bound, because the pools ran dry at ~2,600 calls before the 6,000 ceiling.
Peak day: 2,897 credits.

### 2.3 ~13.7 API calls per like fired

Not a caching failure — URNs and profiles cache indefinitely. It was **volume**:
the engine walked ~2,373 person-candidates per run and resolved every uncached one.

Cache composition measured 20 Aug (8,463 entries):

| | Count |
|---|---|
| with URN (cached forever) | 6,103 |
| URN null/bad | 2,360 |
| posts-checked: productive | 1,460 |
| posts-checked: **dud** (no post in 45d) | **2,949** |
| never posts-checked | 4,054 |

**66.9% of checked profiles are duds.** With a 7-day person cooldown removing most of the
productive remainder, you resolve ~4.5 people per like that actually fires.

### 2.4 Zero-yield days still billed

2-4 Aug fired **0 likes** and burned 495 / 1,154 / 1,366 calls. Invisible at the time because
the balance was 0 so calls failed free. The instant credits landed on 5 Aug, the same
behaviour started billing.

### 2.5 No per-call tracking

The `renidly_ledger` table specified in the 5 Aug burn model was never created.
`credit-ledger.jsonl` had 7 rows, stopping 6 Aug at balance 17,646.
**17,630 credits burned with zero attribution.** The only forensic trail was the engine's
own summary log line.

## 3. Fixes deployed 2026-08-20

Backups on VPS: `daily-reactions-batch.js.bak-20260820`, `data/reactions-daily-config.json.bak-20260820`.
Rollback = copy those two back.

| Change | Was | Now | Why |
|---|---|---|---|
| `resolveCallBudget` (≈ credits/day) | 6,000 | **400** | Kobi's call. Real cap, enforced per-call in the pool loop. |
| `ksdFetchMultiplier` | 5 (950 rows) | 4 (760) | Fewer candidates walked per run |
| `searchKeywordsPerRun` × `searchPagesPerKeyword` | 10 × 4 = 40 calls | 8 × 3 = 24 | Search is the CHEAPEST paid source — do not cut it further |
| Dud re-check TTL | 168h for all | 168h productive / **504h dud** (`postsTtlHoursDud`) | Duds are 2/3 of resolve spend |
| Zero-yield breaker | none | `resolveYieldProbe: 120`, `resolveYieldMin: 1` | Kills the 2-4 Aug pattern |
| Per-call ledger | none | `data/credit-ledger.jsonl` | Captures `X-Credits-Consumed` / `X-Credits-Balance` per call |
| **`banked` pool** | did not exist | runs FIRST, 0 credits | See below |

### 3.1 The `banked` pool — the big win

`posts-seen.jsonl` banks every post ever fetched (**194,380** of them) but was only ever used
for the Friday report. It was never used for targeting.

New `bankedPool()` replays it: unreacted posts inside `maxPostAgeDays`, deduped to the most
recent per author, newest first. **Costs zero API calls — the post URL is already paid for.**

Measured 20 Aug:

| | Count |
|---|---|
| banked candidates | 1,399 |
| profile already cached (0 credits) | 1,258 |
| **PASS the ICP gate** | **751** |
| blocked by gate | 507 (country 507, not-decision-maker 243, followers 97, excluded-role 50) |
| unknown, needs 1 gate call | 141 |

**751 fireable likes at zero credits** — roughly 4 days at cap 190.
It is a **backlog**, not a renewable source: once spent it replenishes only as fast as new
posts get fetched.

### 3.2 The architectural lesson: post-first, not person-first

- **Person-first** ("did these 2,373 people post?") = 1 call per person, ~67% answer no. You pay to discover absence.
- **Post-first** ("show me recent posts matching my keywords") = 1 call returns 10-25 posts, every one a valid target.

Cost per like by source:

| Source | Calls per like |
|---|---|
| `banked` replay | **0.00** |
| `search/posts` | ~0.13 discovery, **~1.0 all-in** (see caveat) |
| ksd / prosp / press / campaign | **~12** |

**Caveat that matters:** the ~0.13 figure counts *discovery only*. The ICP gate costs one
`profile/overview` call per person never classified before, at fire time. Search surfaces
strangers, so it triggers that often. Realistic steady state is **~1.0 calls/like**, built
from a 59.7% gate pass rate (751 of 1,258 classified) meaning ~318 candidates gated per 190 fired.

**Decisive evidence for post-first:** the 18 Aug attribution run credits 12 connections as
`search 5, ksd 6, prosp 1`. Search delivered nearly as many credited connections as ksd,
at roughly 1/24th the cost per like. The expensive targeting was not buying better outcomes.

## 4. Expected spend after the fixes

| Phase | Credits/day | Calls/like |
|---|---|---|
| Before (measured) | ~1,790 | 13.7 |
| Days 1-4 (banked backlog) | ~35 | ~0.05 |
| Steady, warm cache (20% new people) | ~90 | 0.5 |
| **Steady, expected (50% new)** | **~185** | **1.0** |
| Steady, cold cache (80% new) | ~280 | 1.5 |

At $100 / 18,500 credits: **~£24/month expected** vs ~£232/month before. Roughly a 10x
reduction (range 6-20x) at the same 190 likes/day. The 400/day cap sits comfortably above
expected, so it is a safety net rather than a throttle.

## 5. STATUS: NOT VERIFIED AGAINST LIVE TRAFFIC

Everything above was deployed while the balance was **16 credits, below the 150 hard floor**,
so no resolution ran. The ledger, the yield breaker and the asymmetric TTL are verified by
code inspection, a header-parsing unit test, and a dry run only.

**The first funded run is the real test.** Check:
1. The `Banked: N unreacted posts` line appears and N is non-zero.
2. `credit-ledger.jsonl` gets one row per call.
3. In the summary line, `ledger N` and the balance delta **agree**. If they diverge,
   something is calling the API outside this script.

## 6. Before topping up

1. **Verify auto top-up is OFF** in the Renidly dashboard. Only vector that can outspend a
   prepaid balance. Still unconfirmed — needs a human, it is behind their login.
2. **Buy in ONE transaction.** Credits-per-dollar is band-based; two small top-ups land worse.
3. The engine still calls the **pre-rebrand** `https://linkdapi.com/api/v1` with header
   `X-linkdapi-apikey`. Works, never migrated to Renidly. Risk if the old host retires.

## 7. Source of truth

`github.com/kobestarr/outreach-automation`, branch `reengagement-engine`.

**On 20 Aug the repo copy was byte-identical to the VPS but BOTH were ahead of git HEAD** —
a previous session deployed without committing. Fixed in this commit. Deploy path is
`scp` to `/root/linkedin-reactions/`. **Always commit after deploying**, or the next session
builds on stale code.
