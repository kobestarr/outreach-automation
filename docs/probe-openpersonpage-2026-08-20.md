# Probe: `st.openPersonPage` response shape + the limits API (2026-08-20)

Answers PRD `PRD-profile-views-ramp.md` §5, the question that decides the cost model.
One live call, one 1st-degree connection, zero Renidly credits.

---

## 1. Verdict: profile views cost ZERO Renidly credits

`st.openPersonPage` returns everything `reaction-icp-gate.js` needs, and more.

Full `completion.data` for one real profile:

| Field | Value (truncated) | Gate use |
|---|---|---|
| `name` | Alexander Bell | display |
| `headline` | "Attention Intelligence® Keynote Speaker \| ..." | **gate: role regex** |
| `location` | London, England, United Kingdom | |
| `countryCode` | `GB` | **gate: country** |
| `followersCount` | 11525 | **gate: minFollowers** |
| `position` | Keynote Speaker | **gate: role regex (better than `industry`)** |
| `companyName` | Alexander Bell Co | gate: role regex |
| `about` | full about text, ~1,800 chars | **gate: role regex, much richer** |
| `urn` | `urn:li:member:29783883` | **free URN** |
| `hashedUrl` | `.../in/ACoAAAHGd0sB...` | |
| `publicUrl`, `avatarUrl`, `companyUrl`, `companyHashedUrl` | | |

Request shape: `POST /workflows` with
`{ actionType: "st.openPersonPage", personUrl, basicInfo: true }`, then poll
`GET /workflows/{id}` exactly as `reactToPost` does. Completed in ~30s (5 polls).

### What is missing, and why it does not matter

`industry` is **not** returned. The gate blends it into a regex blob:

```js
const blob = [p.headline, p.industry].filter(Boolean).join(" | ");
```

`position` + `companyName` + `about` are a strictly better substitute. LinkedIn's
`industry` taxonomy is a coarse dropdown ("Marketing and Advertising"); `position`
is the actual job title, which is what `DECISION_MAKER_RE` is really testing for.

### Two bonuses beyond the PRD's expectation

1. **`urn` comes free.** 2,360 of the 8,463 resolve-cache entries have a null/bad URN,
   each one paid for and useless. Views backfill them at zero cost.
2. **`about` is a far richer ICP signal** than anything the linkdapi `profile/overview`
   ever returned. Worth revisiting `EXCLUDED_ROLE_RE` / `DECISION_MAKER_RE` precision
   once views are producing this at volume.

**Consequence: every profile view is also a free cache write that makes the LIKES
engine cheaper.** The two engines are independent in their rate limits but the views
engine subsidises the likes engine's resolution costs.

---

## 2. The ceiling is not unknown. The limits API publishes it.

PRD §3 says the views ceiling "must be discovered empirically". Partly wrong:
`POST /admin/limits.getDefaults` (auth: `linked-api-token`, body `{}`) returns the
whole table. No accountId needed, read-only, free.

| Category | daily | weekly | enabled |
|---|---|---|---|
| **`stPersonProfileViews`** | **80** | **560** | **true** |
| `stCompanyPageViews` | 100 | 700 | true |
| `stConnectionRequests` | 10 | 50 | true |
| `stMessages` | 50 | 350 (off) | true |
| `stSearchQueries` | 10 | 70 | **false** |
| **`stReactions`** | **20** | 140 (off) | **true** |
| `stComments` | 10 | 70 | true |
| `stPosts` | 1 | 7 | true |
| `nvPersonProfileViews` | **1000** | **7000** | true |
| `nvCompanyPageViews` | 1000 | 7000 | true |
| `nvMessages` | 25 | 50 (off) | true |

### The finding that reframes the whole PRD

**`stReactions` default is 20/day. We fire 190/day.**

So our account is NOT on defaults — someone raised the limits in the linkedapi.io
dashboard. Which means the `limitExceeded` at 199 likes on 31 Jul was very likely
**linkedapi.io's own configured ceiling, not LinkedIn's platform limit.**

PRD §1 states "190/day is a measured platform ceiling". That premise is now in doubt.
It may be a dashboard number that can simply be raised. LinkedIn's real limit is
somewhere above it and still unknown.

This does not mean raise it. It means we never actually found LinkedIn's wall, and
the safety argument for the views engine (add volume in a separate category) stands
on its own merits regardless.

### Open: our account's ACTUAL limits

`limits.get` and `limits.getUsage` both require an `accountId`:

```
401 {"type":"accountIdRequired","message":"Valid accountId is required"}
```

Not in `~/.credentials/api-keys.json` (only `apiKey`, `identificationToken`).
No `/admin/accounts.*` endpoint exists (all 404). **Needs a human to read it out of
the linkedapi.io dashboard.** With it we get, for free and per-run:

- our real configured `stPersonProfileViews` ceiling, instead of guessing
- `limits.getUsage`, i.e. a live spent-vs-remaining read, which is a far better
  ramp governor than counting our own fires

---

## 3. What this changes for the build

1. Renidly budget for this engine is **zero by design**, not by discipline. The ledger
   and per-day cap still get built (PRD §7 is non-negotiable) but they should record
   zero rows in normal operation. A non-zero row is then a real alarm, not noise.
2. The gate runs on **cached data only** at targeting time. It cannot gate on
   `openPersonPage` output, because opening the page *is* the view. View first,
   enrich after, gate the *next* one better.
3. Ramp target is **80/day** (the default) until the dashboard says otherwise, with
   the weekly 560 as the real binding constraint. 80 x 7 = 560, so daily and weekly
   bind at exactly the same point: no headroom for catch-up days.
4. `nvPersonProfileViews` at 1000/day is 12x the standard pool. Out of scope per
   PRD §4, but that is a large enough number to be worth a Sales Navigator seat
   conversation separately.
