# PRD: LinkedIn profile-views ramp (`st.openPersonPage`)

**Status:** ready to build. Not started.
**Owner session:** new session, own branch (see §9).
**Prerequisite reading:** [`HANDOVER-2026-08-20-credit-burn.md`](./HANDOVER-2026-08-20-credit-burn.md) — especially §2.1 (the config trap) and §6 (credits).

---

## 1. Why

The likes engine is capped by LinkedIn, not by us. On **31 Jul 2026** it halted with:

```
limitExceeded: The configured limit for this action category has been exceeded
```

after 199 likes. The engine's own config carries the note *"linkedapi guide says ~100/day
likes even for trusted accounts."* So 190/day is a measured platform ceiling, and the goal of
~1,000 touches/day is unreachable through reactions alone on one account.

**The unlock:** [Linked API's limits config](https://linkedapi.io/docs/admin-limits) exposes
`stReactions` and `stPersonProfileViews` as **separate rate-limit categories**, plus
`nvPersonProfileViews` for the Sales Navigator namespace. Profile views draw on an
independent budget. Likes at 190/day and profile views in parallel do not compete.

Actual numeric limits are **not published** (only `stMessages: 50` and
`stConnectionRequests: 10` appear as examples). They vary by account age, SSI and
subscription, and are set in the Linked API dashboard. **This is why we ramp.**

## 2. The architectural inversion (read this before designing anything)

A like requires a **post**. A profile view requires only a **person**. Every constraint that
shaped the likes engine disappears:

| | Likes | Profile views |
|---|---|---|
| Needs a recent post | Yes | **No** |
| The 2,949 cached "dud" profiles (no post in 45d) | Unusable | **Fully addressable** |
| The 2,360 null/bad URN entries | Wasted spend | **Still viewable** |
| ksd / prosp / press / campaign person-lists | ~12 calls per like | **Their natural use** |
| Renidly credits per action | ~1.0 | **Potentially ~0** (see §5) |

The person-lists were expensive *because we were using them to hunt for posts*. For views
they are exactly the right shape, and discovery cost is zero — they are local CSV and DB.

Kobi's steer: **start with profiles already seen before** (the 8,463-entry resolve cache).
These are already ICP-classified, so gating is free.

## 3. Goal

Ramp profile views from **10/day** on a daily step, mirroring the proven likes ramp, running
alongside likes without touching the reactions limit.

For reference the likes ramp config is `base: 100, step: 10, ceiling: 190`,
`rampStartDate: 2026-07-21`. (Kobi recalls starting nearer 80; the committed config says 100.
Confirm the intended start before reusing the numbers.)

**Proposed views ramp:** `base: 10, step: 5, ceiling: TBD`.
Ceiling is deliberately unset — it must be discovered empirically by ramping until Linked API
reports a limit signal, then holding **below** that. Do not guess it.

## 4. Scope

### In scope
- New script `daily-profile-views.js`, modelled on `daily-reactions-batch.js`.
- Action: `st.openPersonPage` via the same `/workflows` POST-then-poll pattern as `reactToPost`.
- Target source, in priority order:
  1. **Cache replay** — the 8,463 resolve-cache entries, ICP-gated from cached profile data (0 credits).
  2. ksd / prosp / campaign / press person-lists (0 discovery credits, local files).
- Own ramp state, own cooldown, own STOP file, own daily log.
- Reuse the existing attribution machinery (§6).
- Ledger every Renidly call it makes, same `credit-ledger.jsonl` format, `workstream: "views"`.

### Out of scope
- Sales Navigator (`nv.*`). Note `nvPersonProfileViews` is a *third* independent pool if a
  Sales Nav seat exists — worth a later phase, not this one.
- Messaging, connection invites, comments. Different limit categories, different risk.
- Any change to `daily-reactions-batch.js`. The two engines stay independent.

## 5. Open question to resolve FIRST (affects the whole cost model)

Linked API documents `st.openPersonPage` as *"open a person page to retrieve their basic
information and perform additional person-related actions if needed."*

**If the response carries country, followers, headline and industry**, it supplies everything
`reaction-icp-gate.js` needs, which makes the Renidly `profile/overview` call **redundant for
viewed profiles**. Profile views would then cost **zero Renidly credits** — the only budget
in play is the linkedapi.io action quota.

**Verify this with ONE call before building the cost model.** Fire a single
`st.openPersonPage` at a known profile, dump the full response, compare its fields against
`GATE.icpVerdict()`'s inputs. This single check decides whether views are free or ~1 credit each.

## 6. Attribution (reuse, do not rebuild)

`reaction-attribution-run.js` credits inbound invites and connections against a 21-day window.
**It does not care which action earned them.** Tag view-sourced targets with a distinct pool
name (`views-cache`, `views-ksd`) and the existing machinery produces a like-vs-view
conversion comparison for free.

Baseline to beat, from the 18 Aug run: **2,404 likes → 12 credited connections (0.5%)**,
split `search 5, ksd 6, prosp 1`.

A view is a weaker signal per touch (no public artifact, no social proof on their post) but
permitted at far higher volume, and the view-back loop is a real mechanic. **Whether
weaker-but-more beats stronger-but-fewer is unknown for this ICP.** That is what this build
is for. Run both for three weeks before drawing conclusions.

## 7. Credit discipline — NON-NEGOTIABLE

The whole reason this is a fresh build is that the last engine ate £232/month unnoticed.
Every one of these is a hard requirement, not a nicety:

1. **Set the cap in `data/profile-views-config.json`, not just in the JS defaults.** The JSON
   spreads over `DEFAULT_CONFIG` and wins. See handover §2.1. This trap cost a full pack.
2. **A per-day credit budget enforced inside the loop**, checked per call, not per run.
   A floor ("stop when nearly empty") is NOT a cap ("stop when today's budget is gone").
   Both must exist.
3. **Ledger every billable call** to `credit-ledger.jsonl` with `workstream: "views"`,
   capturing `X-Credits-Consumed` and `X-Credits-Balance` from the response headers.
   Write `credits: null` on timeouts — a billed-but-unread call must not be mistaken for a
   rogue script during reconciliation.
4. **Zero-yield breaker.** If N calls produce no views, stop. The old engine burned
   1,366 calls on a day it did nothing at all.
5. **Prefer zero-credit sources.** Cache replay and local person-lists cost nothing to
   discover. Only spend credits when those are exhausted.
6. **Reconcile daily.** `balance_delta` vs `SUM(ledger.credits)`. Divergence means something
   is calling the API outside the tagged client. Alert on it.
7. **Target: this engine should cost ~0 Renidly credits.** If the §5 check comes back
   favourable it costs nothing at all. If it lands anywhere near the likes engine's old
   burn, stop and re-design.

## 8. Safety requirements (carried over — these were earned)

Copy these from `daily-reactions-batch.js`; each exists because of a specific incident:

- **Single-instance guard** via `pgrep` (double-run incidents 27 Jul, 5 Aug). Note it filters
  own pid and ppid only — a `timeout` wrapper makes the shell a *grandparent* and false-positives.
- **STOP file** halt, own path, not shared with reactions.
- **3-consecutive-failure halt** with WhatsApp alert.
- **Throttle** between actions. Likes use `throttleMinMs: 35000`. Views are lower-risk but
  must still be spread, not bursted.
- **Spread window** — do not fire outside working hours.
- **Person cooldown**, own value. Views can reasonably repeat more often than likes; pick a
  number and make it config.
- **`unhandledRejection` / `uncaughtException` guards** with WhatsApp (the 30 Jul EPIPE).
- **Watchdog** cron. Note the existing one runs hourly 08:00-20:00 = 13 runs/day; keep any
  new watchdog cheap, and never let it make billable calls just to check state.

## 9. Branch and deploy

- Repo: `github.com/kobestarr/outreach-automation`.
- **New branch** off `reengagement-engine`, named for this work e.g. `feat/profile-views-ramp`.
  Do not accrete onto an unrelated branch — see the monorepo branch-hygiene rule.
- Deploy: `scp` to `/root/linkedin-reactions/` on clawdbot, then add a cron.
- **Commit after every deploy.** On 20 Aug both the repo working copy and the VPS were ahead
  of git HEAD because a prior session deployed without committing.

## 10. Definition of done

1. `st.openPersonPage` response shape documented, and the §5 credit question answered in writing.
2. Ramp runs 14 consecutive days from 10/day without a `limitExceeded` signal.
3. `credit-ledger.jsonl` shows `workstream: "views"` rows, and daily reconciliation agrees
   with the balance delta.
4. Attribution reports view-sourced credited connections separately from like-sourced.
5. A written like-vs-view comparison after three weeks of parallel running, with a
   recommendation on where the next marginal touch should go.
