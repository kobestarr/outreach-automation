# Credit model: VERIFIED against live traffic (2026-08-20)

Supersedes the "expected spend" section of
[`HANDOVER-2026-08-20-credit-burn.md`](./HANDOVER-2026-08-20-credit-burn.md) §4.

**Method:** Kobi's call. Rather than fund a pack and hope, spend the **last 15 credits**
testing the safety mechanisms. Live config backed up, temporarily set to
`creditHardFloor 5, resolveCallBudget 3, search 1x1`, run `--dry-run` so **zero likes
fired**, then restored and diffed byte-identical. **Total cost: 5 credits.**

---

## 1. The four unproven mechanisms: all four now proven

Before this, `credit-ledger.jsonl` **did not exist on the VPS**. Zero rows, ever.

| Question | Verdict | Evidence |
|---|---|---|
| Does the ledger write one row per call? | **YES** | 3 calls, 3 rows |
| Does it capture the credit headers? | **YES** | `credits` and `balance_after` populated on every row |
| Does `resolveCallBudget` actually bind? | **YES** | `linkdapi call budget (3) reached.` |
| Does the ledger reconcile with the balance? | **YES** | ledger sum 5, balance 15 to 10 |

Raw ledger, first three rows ever written:

```json
{"ts":"...T14:45:12.145Z","workstream":"reactions","endpoint":"/search/posts",   "http":200,"credits":1,"balance_after":14,"call":1}
{"ts":"...T14:45:14.334Z","workstream":"reactions","endpoint":"/profile/overview","http":200,"credits":2,"balance_after":12,"call":2}
{"ts":"...T14:45:18.071Z","workstream":"reactions","endpoint":"/profile/overview","http":200,"credits":2,"balance_after":10,"call":3}
```

---

## 2. FINDING: `/profile/overview` costs 2 credits, not 1

The handover states *"calls bill at ~1.03 credits, so calls == credits."* That is true for
`/search/posts` and **false for the ICP gate call**, which is the dominant call type.

| Endpoint | Credits per call |
|---|---|
| `/search/posts` | **1** |
| `/profile/overview` | **2** |

### What this does to the cost model

Handover §4 projects steady state at **~185 credits/day** for 190 likes, built from
"~318 candidates gated per 190 fired" at 1 credit each. At 2 credits per gate call:

| | Handover §4 | Corrected |
|---|---|---|
| gate calls per day | ~318 | ~318 |
| credits per gate call | 1 | **2** |
| **steady state credits/day** | **~185** | **~640** |
| at $100 / 18,500 credits | ~£24/month | **~£83/month** |

Still far better than the ~£232/month that burned the pack, but **3.4x the figure the
handover promised**, and that figure is what any funding decision would have been based on.

### The lever this hands us

Gate calls are now the single largest line item, so **the reactions gate fix deployed today
matters more than we thought**. Gating from the cache costs 0 and refuses 455 of 1,322
banked candidates. Every person the gate refuses from cache is a person we never pay 2
credits to classify.

It also strengthens the views engine's case: `st.openPersonPage` returns the same fields
for **zero** credits, so every profile viewed is a 2-credit gate call the likes engine will
never have to make.

---

## 3. FINDING: the balance endpoint LAGS, by minutes

Three readings of the same balance around one run:

| Source | Reading |
|---|---|
| `/credits/balance/k/` before the run | 15 |
| `X-Credits-Balance` header, last call | **10** |
| `/credits/balance/k/` immediately after | 14 |
| `/credits/balance/k/` a few minutes later | **10** |

The header is real-time. The balance endpoint catches up later.

### Two consequences, both bad

1. **`creditHardFloor` reads stale data.** `linkdapiBalance()` is called once at the start
   of a run and compared against the floor. It can be minutes behind, so the floor can pass
   a run that should have been blocked.
2. **The engine under-reports its own burn.** The daily summary computes burn as
   `startBalance - endBalance` from the lagging endpoint. This run reported
   **`burned 1`** when the truth was **5**. The `ledger 5` figure in the same line was
   correct.

That second point matters historically: the handover's entire burn table is built from that
summary line. Those daily figures should be treated as **lower bounds**, not measurements.

### Fix (not yet implemented)

Prefer `X-Credits-Balance` from the last ledger row over `linkdapiBalance()` for both the
floor check and the summary. The header is already captured; it is simply not used.

---

## 4. FINDING: `resolveCallBudget` is not enforced during pool construction

`searchPool()` runs **before** the `outer:` loop that checks the budget, and contains no
budget check of its own:

```js
for (const kw of kws) {                                          // searchKeywordsPerRun
  for (let page = 0; page < cfg.searchPagesPerKeyword; page++) { // x searchPagesPerKeyword
    const r = linkdapi(`/search/posts?...`);                     // unchecked, billable
```

At the live setting of `8 x 3` that is a floor of **24 credits per run regardless of the
budget**. Immaterial against a budget of 400, and it is not what caused the burn, but the
handover's claim that the cap is "enforced per-call" is inaccurate, and a small budget set
in good faith would silently overrun by 24.

---

## 5. What this cost, and what it replaces

**5 credits, about 3 pence.** 10 remain.

It replaces a plan to buy a £100 pack and discover, from the ledger, that the cost model was
3.4x optimistic and the burn figures were lower bounds. Verify the meter before filling the
tank.

## 6. Still not verified

- **The zero-yield breaker** (`resolveYieldProbe 120`). Needs a run of 120+ calls to trip,
  which the remaining balance cannot fund.
- **The 400/day cap binding in anger.** It bound at 3. It has never been near 400.
- **Whether `/urn` resolution and per-person post lookups also cost 2**, or 1. Only
  `/search/posts` and `/profile/overview` have been observed.
