# Design: LinkedIn profile-views ramp engine (`daily-profile-views.js`)

**Date:** 2026-08-20
**Branch:** `feat/profile-views-ramp` (off `reengagement-engine`)
**Status:** design approved in chat, awaiting spec review
**Inputs:** [`../../PRD-profile-views-ramp.md`](../../PRD-profile-views-ramp.md),
[`../../HANDOVER-2026-08-20-credit-burn.md`](../../HANDOVER-2026-08-20-credit-burn.md),
[`../../probe-openpersonpage-2026-08-20.md`](../../probe-openpersonpage-2026-08-20.md)

---

## 1. What the probe settled

Three PRD assumptions changed before any code was written.

| PRD said | Reality (measured 2026-08-20) |
|---|---|
| §5: unknown whether views cost Renidly credits | **Zero.** `st.openPersonPage` returns `countryCode`, `followersCount`, `headline`, `position`, `companyName`, `about` and `urn`. Everything the gate needs, plus the URN we currently pay for. |
| §3: views ceiling must be found by blind ramping | **Published.** `limits.get` says `stPersonProfileViews` 200/day but **560/week enabled**, so the real sustainable rate is **80/day**. |
| §1: 190 likes/day is a LinkedIn platform ceiling | **False.** `stReactions` is set to 200/day; the 31 Jul halt at 199 was linkedapi's own dashboard number. LinkedIn's real wall is unmeasured. |

`limits.getUsage` gives a free, live `currentUsage` vs `maxValue` per category and counts
our actions in real time. It is the ramp governor, in preference to self-counting.

## 2. Goal

Add outbound touch volume in a rate-limit category independent of `stReactions`, ramping
`10 +5/day` to **80/day** and holding, without spending a single Renidly credit, and
without touching `daily-reactions-batch.js`.

Secondary and free: every view writes back a full profile, which permanently enriches the
targeting data both engines depend on.

## 3. The measured target universe

```
post authors (from 194,380 banked posts)  : 5,071   (~38 posts each)
  ...already in the resolve cache         : 4,942
  ...genuinely new                        :   129
resolve cache (all)                       : 8,463
pool-ksd.csv 6,662 people, new vs cache   :     4
UNION of all free sources, minus 1st-deg  : 8,496   <- the addressable universe
  ...with a cached profile (free to gate) : 2,662
  ...no profile data at all               : 5,834
```

At 80/day the universe lasts **~106 days** with no repeats.

**Consequence for targeting:** post-first *discovery* is worthless for views (129 new
people). Posts are valuable as a **recency signal** instead: someone who posted last week
is active and will actually see the view notification. Posts rank the queue; they do not
populate it.

## 4. Architecture: one scored queue, pool labels for attribution

Rejected: separate `views-ksd` / `views-press` / `views-cache` pools mirroring the
reactions engine. The pools overlap almost completely (pool-ksd.csv contributes 4 people
not already in the cache), so the tiers would be fictional and the config surface tripled.

Adopted: a **single scored queue** over the whole 8,496, with every target carrying a
`pool` label derived from its origin. `reaction-attribution-run.js` keys off pool names
and does not care which action earned a connection, so a per-source like-vs-view
comparison (PRD §6, DoD #4/#5) comes out for free.

### 4.1 Exclusions, applied before scoring

| Rule | Source |
|---|---|
| 1st-degree connections | `data/first-degree-connections.txt` (2,978) |
| blocklist | `data/reactions-blocklist.txt` |
| company / school / showcase pages | `GATE.isCompanyAuthor()` |
| **cached gate FAIL** | `GATE.icpVerdict()` over cached profile data |
| viewed within cooldown | `data/profile-views-state.json` |

### 4.2 Scoring

Deliberate departure from PRD §4, which says gate from cached data first. We exclude only
**known** fails and let **unknowns** through, because for views an unknown is not a risk,
it is a free lookup that improves every future decision for both engines. The only thing
we refuse to spend a slot on is someone already proven off-ICP.

| Person | Priority | Rationale |
|---|---|---|
| cached PASS + posted within 14d | highest | live view-back candidate |
| no profile + posted within 14d | high | active, and the view enriches for free |
| cached PASS + dormant | medium | right person, may not see it |
| no profile + dormant | low | enrichment tail, fills spare capacity |
| cached FAIL | excluded | already proven unable to buy |

Early runs are dominated by unknowns, so the engine behaves as the enrichment crawl.
As the cache fills it self-converts into a view-back engine. No mode switch needed.

## 5. Ramp and the weekly budget

```
base 10, step 5  ->  day 0 = 10, day 14 = 80, then hold
safetyCeiling 400  (runaway guard, must never bind)
weeklyBudget 560   (matches the live linkedapi setting)
```

**The daily cap is not the binding constraint. The weekly one is.** 560/7 = 80 exactly, so
there is zero slack. A naive daily ramp past 80 spends the week's allowance by Wednesday
and then sits dead, which reads as a broken engine.

Therefore the engine enforces **both**, per call:

1. today's ramp cap, and
2. a **rolling trailing-7-day total** below `weeklyBudget`.

Cumulative ramp fits throughout: week 1 = 175, week 2 = 420, week 3 = 560.

### 5.1 Limit governor

Before firing, and every 20 actions, call `limits.getUsage`. It is free, and authoritative
in a way our own counter is not (a manual LinkedIn session, or Prosp, also consumes quota).
Stop for the day when `currentUsage >= maxValue` for either the daily or weekly period.

On a `limitExceeded` error: record the count reached, **stop ramping permanently**, hold at
10% below the observed number, end the day cleanly, **never write a STOP file** (mirrors
`LIMIT_RE` in the reactions engine). Tripping the limit every day is the pattern that
looks like abuse.

On `RESTRICTION_RE` (restrict / challenge / checkpoint / banned / unauthorised): STOP file
plus WhatsApp. That one kills the seat.

## 6. Renidly spend: structurally zero

The linkdapi client is **not wired into this script at all**. No credentials, no import,
no code path. The engine is incapable of spending rather than merely instructed not to.
This is a stronger guarantee than PRD §7's per-day budget, and is only possible because
the §5 probe came back favourable.

PRD §7 is still honoured:

- `data/credit-ledger.jsonl` rows with `workstream: "views"` are still written for any
  billable call. There should never be one. **A single row is an alarm, not noise.**
- Caps are set in **both** `data/profile-views-config.json` and `DEFAULT_CONFIG`, per
  handover §2.1, and a test pins the override behaviour (§10).
- Reconciliation is trivial: if the Renidly balance moves on a day views ran, it was not views.

## 7. State and files — nothing shared with reactions

```
daily-profile-views.js               the engine
data/profile-views-config.json       caps set HERE and in DEFAULT_CONFIG
data/profile-views-state.json        viewed{}, ramp, observedLimit, rolling week
data/STOP-profile-views              own STOP file
data/profile-views-YYYY-MM-DD.log    own log
data/profile-enrichment.jsonl        append-only enrichment output (§8)
```

## 8. Enrichment output, and the race condition it avoids

The obvious destination for the free profile data is `reaction-resolve-cache.json`. That
is wrong: it is a 1.8MB blob the reactions engine reads whole and writes whole. Two
processes doing read-modify-write on it will silently clobber each other and we would lose
cache entries already paid for in Renidly credits.

Instead views **appends** one line per view to `data/profile-enrichment.jsonl`:

```json
{"ts":"...","username":"alexanderpbell","urn":"urn:li:member:29783883",
 "countryCode":"GB","followers":11525,"headline":"...","position":"Keynote Speaker",
 "companyName":"...","about":"...","source":"st.openPersonPage"}
```

Append-only, no shared mutable state, no clobber. A **separate later change** teaches the
reactions engine to warm its cache from this file at startup. That keeps
`daily-reactions-batch.js` untouched in this branch, as instructed.

## 9. Safety guards, carried over from `daily-reactions-batch.js`

Each exists because of a specific incident (PRD §8):

| Guard | Note |
|---|---|
| single-instance `pgrep` | filters own pid and ppid only; a `timeout` wrapper makes the shell a *grandparent* and false-positives |
| STOP file | own path, never shared with reactions |
| 3-consecutive-failure halt | plus WhatsApp alert |
| throttle between actions | 80/day over a 12h window = ~540s apart; randomise 300-800s |
| spread window | 08:15-20:00 UTC, staggered 30 min after the reactions cron |
| person cooldown | **30 days.** 106 days of unique supply, so no need to repeat in cycle one |
| `unhandledRejection` / `uncaughtException` | plus WhatsApp (the 30 Jul EPIPE) |

### 9.1 Flagged, deliberately not built in v1

Likes and views are separate limit categories at linkedapi but drive the **same LinkedIn
seat**. Nothing watches the combined rate:

```
today          190 likes              ~17 actions/hour over 11h
views at  80   190 + 80  = 270        ~25/hour
views at 150   190 + 150 = 340        ~31/hour
```

Roughly one action every two minutes at the top. Defensible, not nothing. A shared
`data/action-rate.jsonl` heartbeat so both engines can see the total is **phase 2**.

## 10. Testing (TDD, tests before implementation)

Pure functions, tested first:

1. **scorer** — ordering across the five priority bands in §4.2
2. **ramp maths** — daily cap, and the rolling trailing-7-day budget, including the
   transition week where both bind
3. **limit handling** — `limitExceeded` records the count, stops ramping, holds 10% below,
   writes no STOP; `RESTRICTION_RE` writes a STOP and alerts
4. **exclusion chain** — 1st-degree, blocklist, company page, cached FAIL, cooldown
5. **config merge** — **assert `data/profile-views-config.json` overrides `DEFAULT_CONFIG`.**
   This pins the §2.1 trap that cost an 18,500-credit pack as a test, not a doc comment.
6. **enrichment record shape** — one valid JSONL line per view, append-only
7. **response parsing** — the real `st.openPersonPage` completion payload captured in §1
   used as a fixture

## 11. Attribution

Targets carry `pool` labels (`views-active`, `views-cache`, `views-ksd`, `views-press`).
`reaction-attribution-run.js` already credits inbound invites and connections against a
21-day window regardless of which action earned them, so no changes are needed there.

Baseline to beat, 18 Aug run: **2,404 likes -> 12 credited connections (0.5%)**,
split `search 5, ksd 6, prosp 1`.

## 12. Deploy

`scp` to `/root/linkedin-reactions/` on clawdbot, cron at **08:15 UTC** (30 min after the
reactions cron at 07:45). **Commit after every deploy** — on 20 Aug both the repo and the
VPS were ahead of git HEAD because a prior session deployed without committing.

## 13. Definition of done

1. ~~`st.openPersonPage` response shape documented, §5 credit question answered~~ **done**,
   see the probe doc.
2. Ramp runs 14 consecutive days from 10/day to 80/day with no `limitExceeded`.
3. `credit-ledger.jsonl` shows **zero** `workstream: "views"` rows, and the Renidly balance
   is unchanged across days where only views ran.
4. `profile-enrichment.jsonl` grows one line per view and the records parse.
5. Attribution reports view-sourced credited connections separately from like-sourced.
6. A written like-vs-view comparison after three weeks of parallel running, with a
   recommendation on where the next marginal touch should go.

## 14. Out of scope / later

- **Raising the weekly cap** via `limits.set`. Kobi's call 2026-08-20: only after 14 clean
  days at 80/day. Evidence before volume.
- **`nvPersonProfileViews` at 1000/day, 7000/week** is a *third* independent pool, 12x the
  standard one. Needs a Sales Navigator seat. Worth a separate conversation.
- **Reactions cache warming** from `profile-enrichment.jsonl`.
- **Combined action-rate heartbeat** across both engines (§9.1).
- **Prosp warm-up handoff** (view today, connect in 1-3 days) — becomes a filter over this
  same queue, not a new system.

## 15. Separately agreed this session (not part of this branch)

The reactions ICP gate is skipped entirely when Renidly credits are below the hard floor,
**including for profiles already cached, which cost nothing to check**
([`daily-reactions-batch.js:585`](../../../daily-reactions-batch.js#L585)). With search at 0
and banked the only live pool, roughly 76 of 190 daily likes go to people the gate already
knows are off-ICP. Kobi approved a one-line fix, deployed after today's run completes, as
its own commit.
