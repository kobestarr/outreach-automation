# LinkedIn Profile-Views Ramp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `daily-profile-views.js`, a LinkedIn profile-views engine that ramps 10 `+5`/day to 80/day in a rate-limit category independent of reactions, spending zero Renidly credits.

**Architecture:** Three pure, unit-tested modules (`profile-views-config.js`, `profile-views-ramp.js`, `profile-views-targeting.js`) plus a thin injected-transport limits client (`linkedapi-limits.js`), orchestrated by `daily-profile-views.js` which owns all I/O, the linkedapi.io workflow calls and the safety guards. Pure logic is testable without network or filesystem; the orchestrator is exercised via `--dry-run`.

**Tech Stack:** Node.js (no framework), zero runtime dependencies, `require('assert')` tests run as `node tests/<name>.test.js`. Deployed by `scp` to `/root/linkedin-reactions/` on clawdbot, driven by cron.

**Spec:** [`../specs/2026-08-20-profile-views-ramp-design.md`](../specs/2026-08-20-profile-views-ramp-design.md)

## Global Constraints

- **Do NOT modify `daily-reactions-batch.js`** in this branch. The two engines stay independent. (Task 0 is the one approved exception and lives on its own branch.)
- **The linkdapi/Renidly client must NOT be imported, required or referenced** by any file in this plan. Renidly spend is structurally zero, not budgeted.
- **Every cap is set in BOTH** `DEFAULT_CONFIG` (JS) **and** `data/profile-views-config.json`. The JSON spreads over the JS defaults and wins; patching only the JS is inert. This trap cost an 18,500-credit pack.
- **Zero runtime dependencies.** The engine runs standalone on the VPS. No npm installs.
- Tests: `require('assert')`, hand-rolled `test()` helper matching `tests/reaction-icp-gate.test.js`, run via `node tests/<name>.test.js`, set `process.exitCode = 1` on failure.
- **No em dashes** in any log line, comment, commit message or WhatsApp alert.
- Branch: `feat/profile-views-ramp`. **Commit after every deploy.**
- Node lives at `/opt/homebrew/bin` locally; prefix `PATH="/opt/homebrew/bin:$PATH"` if `node` is not found.
- Account limits, verified 2026-08-20: `stPersonProfileViews` daily 200, **weekly 560 enabled**. The weekly is the binding constraint (560/7 = 80/day).

---

## File Structure

| File | Responsibility |
|---|---|
| `profile-views-config.js` | `DEFAULT_CONFIG` + `loadConfig()`. Pure. |
| `profile-views-ramp.js` | Daily cap, rolling 7-day budget, limit observation. Pure. |
| `profile-views-targeting.js` | Exclusions, scoring, queue build. Pure. |
| `linkedapi-limits.js` | `limits.get` / `limits.getUsage` with injected transport. |
| `daily-profile-views.js` | Orchestrator: I/O, workflows, safety guards, logging. |
| `data/profile-views-config.json` | Live config. Overrides the JS defaults. |
| `tests/profile-views-config.test.js` | Pins the JSON-overrides-JS trap. |
| `tests/profile-views-ramp.test.js` | Ramp and weekly budget maths. |
| `tests/profile-views-targeting.test.js` | Exclusions and scoring. |
| `tests/linkedapi-limits.test.js` | Usage parsing and stop conditions. |

---

### Task 0: Fix the reactions ICP gate skipping cached profiles

**This task is on its own branch, NOT `feat/profile-views-ramp`.** It is a reactions-engine fix, approved separately by Kobi on 2026-08-20. Deploy only after the day's reactions run has finished (roughly 20:25 UTC), never mid-run.

**Files:**
- Modify: `daily-reactions-batch.js:585`
- Test: `tests/reactions-gate-credit-guard.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks rely on. Fully independent.

**Background:** the gate block is guarded by `!creditsExhausted`, but `profileOverview()` reads a cache and only calls out on a miss. So when credits are below the hard floor the gate is skipped even for profiles already cached, which cost nothing to check. Measured effect: roughly 507 of 1,258 cached banked candidates are gate FAILs, so about 76 of 190 daily likes go to people already proven off-ICP.

- [ ] **Step 1: Create the branch from `reengagement-engine`**

```bash
git checkout reengagement-engine
git checkout -b fix/reactions-gate-cached-profiles
```

- [ ] **Step 2: Write the failing test**

Create `tests/reactions-gate-credit-guard.test.js`:

```js
// tests/reactions-gate-credit-guard.test.js
// A cached profile costs zero credits to gate, so the gate must run even when
// the Renidly balance is below the hard floor. Before this fix the whole gate
// block sat behind !creditsExhausted, so below-floor days fired ungated at the
// banked backlog: ~507 of 1,258 cached banked candidates are gate FAILs.
const assert = require('assert');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

// Mirror of the decision the batch makes before gating a target.
// shouldGate(hasCachedProfile, creditsExhausted, underBudget)
function shouldGate(hasCachedProfile, creditsExhausted, underBudget) {
  if (hasCachedProfile) return true;                 // free, always gate
  return !creditsExhausted && underBudget;           // paid lookup, needs both
}

(async () => {
  await test('cached profile is gated even when credits are exhausted', () => {
    assert.strictEqual(shouldGate(true, true, false), true);
  });

  await test('cached profile is gated when credits are healthy', () => {
    assert.strictEqual(shouldGate(true, false, true), true);
  });

  await test('uncached profile is NOT gated when credits are exhausted', () => {
    assert.strictEqual(shouldGate(false, true, true), false);
  });

  await test('uncached profile is NOT gated when over the call budget', () => {
    assert.strictEqual(shouldGate(false, false, false), false);
  });

  await test('uncached profile IS gated when credits healthy and under budget', () => {
    assert.strictEqual(shouldGate(false, false, true), true);
  });

  console.log(`\n${passed} passed`);
})();
```

- [ ] **Step 3: Run it and confirm it passes against the reference logic**

Run: `PATH="/opt/homebrew/bin:$PATH" node tests/reactions-gate-credit-guard.test.js`
Expected: `5 passed`. This test pins the intended decision table before the edit.

- [ ] **Step 4: Make the one-line change**

In `daily-reactions-batch.js`, replace:

```js
    const gu = usernameOf(target.linkedinUrl);
    if (gu && !creditsExhausted && resolveCalls < cfg.resolveCallBudget) {
      const prof = profileOverview(gu, cache);
```

with:

```js
    const gu = usernameOf(target.linkedinUrl);
    // A cached profile costs ZERO credits to gate, so the credit guard must
    // only apply to the cache-MISS path. Before 2026-08-20 the whole block sat
    // behind !creditsExhausted, so below-floor days fired the banked backlog
    // ungated: ~507 of 1,258 cached banked candidates are gate FAILs.
    const cachedProf = gu && cache[gu] && cache[gu].profile ? cache[gu].profile : null;
    const canPayForLookup = !creditsExhausted && resolveCalls < cfg.resolveCallBudget;
    if (gu && (cachedProf || canPayForLookup)) {
      const prof = cachedProf || profileOverview(gu, cache);
```

- [ ] **Step 5: Verify the edit did not change the paid path**

Run: `PATH="/opt/homebrew/bin:$PATH" node -e "require('./daily-reactions-batch.js')" 2>&1 | head -5`
Expected: no syntax error. (The script guards its main on being run directly, so a require is a parse check.)

Then run the existing gate tests to confirm nothing regressed:
Run: `PATH="/opt/homebrew/bin:$PATH" node tests/reaction-icp-gate.test.js`
Expected: all existing assertions pass.

- [ ] **Step 6: Dry run against real state**

Run: `PATH="/opt/homebrew/bin:$PATH" node daily-reactions-batch.js --dry-run 2>&1 | head -40`
Expected: a `Pools:` line, and `⊘ gated (banked) <name>: country=...` lines now appearing where previously every banked target fired. Confirm the gated count is non-zero.

- [ ] **Step 7: Commit**

```bash
git add tests/reactions-gate-credit-guard.test.js daily-reactions-batch.js
git commit -m "fix(reactions): gate cached profiles even below the credit floor

profileOverview() reads a cache and only calls out on a miss, but the whole
gate block sat behind !creditsExhausted. So on below-floor days the engine
fired completely ungated, including at profiles already classified.

Measured: 507 of 1,258 cached banked candidates are gate FAILs (mostly
country), so roughly 76 of 190 daily likes went to people already proven
unable to buy, out of a backlog that does not replenish while search is at 0.

The credit guard now applies only to the cache-miss path."
```

- [ ] **Step 8: Deploy AFTER the day's run has finished, then commit the deploy**

```bash
ssh clawdbot 'pgrep -f daily-reactions-batch.js || echo "run finished, safe to deploy"'
scp daily-reactions-batch.js clawdbot:/root/linkedin-reactions/
ssh clawdbot 'cd /root/linkedin-reactions && md5sum daily-reactions-batch.js'
md5 -q daily-reactions-batch.js
```

Expected: the two checksums match. Do not proceed if `pgrep` finds a running process.

---

### Task 1: Config module and the override trap test

**Files:**
- Create: `profile-views-config.js`
- Create: `data/profile-views-config.json`
- Test: `tests/profile-views-config.test.js`

**Interfaces:**
- Produces: `DEFAULT_CONFIG` (object), `loadConfig(readJson, jsonPath)` returning the merged config. `readJson` is injected as `(path, fallback) => object` so the test needs no filesystem.

- [ ] **Step 1: Write the failing test**

Create `tests/profile-views-config.test.js`:

```js
// tests/profile-views-config.test.js
// Pins the trap from HANDOVER-2026-08-20-credit-burn.md section 2.1: the JSON
// config spreads OVER the JS defaults and WINS. Patching DEFAULT_CONFIG alone
// is inert for any key present in the JSON. That cost an 18,500-credit pack,
// so it is a test here, not a comment.
const assert = require('assert');
const C = require('../profile-views-config.js');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

(async () => {
  await test('JSON overrides the JS default (the section 2.1 trap)', () => {
    const cfg = C.loadConfig(() => ({ ceiling: 999 }), 'ignored.json');
    assert.strictEqual(cfg.ceiling, 999, 'JSON must win over DEFAULT_CONFIG');
  });

  await test('keys absent from the JSON fall back to the JS default', () => {
    const cfg = C.loadConfig(() => ({ ceiling: 999 }), 'ignored.json');
    assert.strictEqual(cfg.base, C.DEFAULT_CONFIG.base);
    assert.strictEqual(cfg.step, C.DEFAULT_CONFIG.step);
  });

  await test('a missing JSON file yields the pure defaults', () => {
    const cfg = C.loadConfig(() => ({}), 'missing.json');
    assert.deepStrictEqual(cfg, C.DEFAULT_CONFIG);
  });

  await test('defaults encode the agreed ramp: 10 +5 to 80, weekly 560', () => {
    assert.strictEqual(C.DEFAULT_CONFIG.base, 10);
    assert.strictEqual(C.DEFAULT_CONFIG.step, 5);
    assert.strictEqual(C.DEFAULT_CONFIG.ceiling, 80);
    assert.strictEqual(C.DEFAULT_CONFIG.weeklyBudget, 560);
    assert.strictEqual(C.DEFAULT_CONFIG.hardMax, 200);
  });

  await test('Renidly spend is structurally zero', () => {
    assert.strictEqual(C.DEFAULT_CONFIG.renidlyCallBudget, 0);
  });

  console.log(`\n${passed} passed`);
})();
```

- [ ] **Step 2: Run it and verify it fails**

Run: `PATH="/opt/homebrew/bin:$PATH" node tests/profile-views-config.test.js`
Expected: FAIL, `Cannot find module '../profile-views-config.js'`

- [ ] **Step 3: Write the implementation**

Create `profile-views-config.js`:

```js
/**
 * profile-views-config.js — config for daily-profile-views.js.
 *
 * HARD RULE (handover 2026-08-20 section 2.1): data/profile-views-config.json
 * spreads OVER DEFAULT_CONFIG and WINS. Patching the defaults here alone is
 * inert for any key the JSON also carries. Set caps in BOTH, and verify from
 * the run log rather than by reading source. tests/profile-views-config.test.js
 * pins this behaviour.
 */

const DEFAULT_CONFIG = {
  // Ramp. Account limits read 2026-08-20 via limits.get: stPersonProfileViews
  // daily 200 but weekly 560 ENABLED, so 560/7 = 80/day is the real ceiling.
  rampStartDate: null,      // set to today's date on the very first run
  base: 10,
  step: 5,
  ceiling: 80,              // the hold point, set by the weekly budget
  hardMax: 200,             // mis-edit backstop only; must never bind
  weeklyBudget: 560,        // rolling trailing-7-day cap, the binding constraint

  // Targeting
  activeWithinDays: 14,     // activity signal; the reactions engine's 45 is post eligibility
  personCooldownDays: 30,   // 8,496 addressable / 80 a day = 106 days of unique supply

  // Pacing
  spreadStartHourUTC: 8,
  spreadEndHourUTC: 20,
  throttleMinMs: 120000,    // floor between actions
  throttleMaxMs: 900000,    // fallback ceiling once past the spread window

  // Safety
  maxConsecutiveFailures: 3,
  usagePollEvery: 20,       // re-read limits.getUsage every N actions

  // Renidly: structurally zero. The linkdapi client is not wired into this
  // engine at all, so this is an assertion, not a budget.
  renidlyCallBudget: 0,
};

/**
 * @param {(path:string, fallback:object)=>object} readJson injected reader
 * @param {string} jsonPath
 */
function loadConfig(readJson, jsonPath) {
  return { ...DEFAULT_CONFIG, ...readJson(jsonPath, {}) };
}

module.exports = { DEFAULT_CONFIG, loadConfig };
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `PATH="/opt/homebrew/bin:$PATH" node tests/profile-views-config.test.js`
Expected: `6 passed`

- [ ] **Step 5: Create the live JSON config with the SAME caps**

Create `data/profile-views-config.json`:

```json
{
  "rampStartDate": null,
  "base": 10,
  "step": 5,
  "ceiling": 80,
  "hardMax": 200,
  "weeklyBudget": 560,
  "activeWithinDays": 14,
  "personCooldownDays": 30,
  "spreadStartHourUTC": 8,
  "spreadEndHourUTC": 20,
  "throttleMinMs": 120000,
  "throttleMaxMs": 900000,
  "maxConsecutiveFailures": 3,
  "usagePollEvery": 20,
  "renidlyCallBudget": 0
}
```

- [ ] **Step 6: Commit**

```bash
git add profile-views-config.js data/profile-views-config.json tests/profile-views-config.test.js
git commit -m "feat(views): config module, with the JSON-overrides-JS trap pinned by a test

Caps set in BOTH the JS defaults and the JSON, per handover section 2.1."
```

---

### Task 2: Ramp maths and the rolling weekly budget

**Files:**
- Create: `profile-views-ramp.js`
- Test: `tests/profile-views-ramp.test.js`

**Interfaces:**
- Consumes: `DEFAULT_CONFIG` shape from Task 1 (`base`, `step`, `ceiling`, `hardMax`, `weeklyBudget`, `rampStartDate`).
- Produces:
  - `dailyCap(cfg, state, todayISO)` -> `number`
  - `weeklyRemaining(cfg, state, todayISO)` -> `number`
  - `effectiveCap(cfg, state, todayISO)` -> `number` (the min of the two, floored at 0)
  - `recordFires(state, todayISO, n)` -> mutates `state.history[todayISO]`
  - `recordLimitHit(state, count)` -> sets `state.observedLimit` and `state.rampFrozen = true`
  - `state` shape: `{ history: {"YYYY-MM-DD": number}, observedLimit: number|null, rampFrozen: boolean, viewed: {username: isoString} }`

- [ ] **Step 1: Write the failing test**

Create `tests/profile-views-ramp.test.js`:

```js
// tests/profile-views-ramp.test.js
// The daily cap is NOT the binding constraint. Our account reads
// stPersonProfileViews daily 200 but weekly 560 ENABLED, and 560/7 = 80 exactly,
// so there is zero slack. A naive daily ramp past 80 spends the week's budget by
// Wednesday and then sits dead, which reads as a broken engine.
const assert = require('assert');
const R = require('../profile-views-ramp.js');
const { DEFAULT_CONFIG } = require('../profile-views-config.js');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

const cfg = (over = {}) => ({ ...DEFAULT_CONFIG, rampStartDate: '2026-09-01', ...over });
const blank = () => ({ history: {}, observedLimit: null, rampFrozen: false, viewed: {} });

(async () => {
  // ---------- dailyCap ----------
  await test('day 0 fires the base', () => {
    assert.strictEqual(R.dailyCap(cfg(), blank(), '2026-09-01'), 10);
  });

  await test('day 1 adds one step', () => {
    assert.strictEqual(R.dailyCap(cfg(), blank(), '2026-09-02'), 15);
  });

  await test('day 14 reaches the 80 ceiling exactly', () => {
    assert.strictEqual(R.dailyCap(cfg(), blank(), '2026-09-15'), 80);
  });

  await test('day 30 holds at the ceiling, does not keep climbing', () => {
    assert.strictEqual(R.dailyCap(cfg(), blank(), '2026-10-01'), 80);
  });

  await test('a date before the ramp start clamps to the base, never negative', () => {
    assert.strictEqual(R.dailyCap(cfg(), blank(), '2026-08-20'), 10);
  });

  await test('hardMax clamps a mis-edited ceiling', () => {
    const c = cfg({ ceiling: 5000, step: 1000 });
    assert.strictEqual(R.dailyCap(c, blank(), '2026-09-15'), c.hardMax);
  });

  // ---------- observed limit freezes the ramp ----------
  await test('recordLimitHit freezes the ramp and holds 10% below the observed number', () => {
    const s = blank();
    R.recordLimitHit(s, 120);
    assert.strictEqual(s.observedLimit, 120);
    assert.strictEqual(s.rampFrozen, true);
    assert.strictEqual(R.dailyCap(cfg(), s, '2026-10-01'), 108); // floor(120 * 0.9)
  });

  await test('a frozen ramp never rises again even far in the future', () => {
    const s = blank();
    R.recordLimitHit(s, 100);
    assert.strictEqual(R.dailyCap(cfg(), s, '2027-01-01'), 90);
  });

  // ---------- rolling weekly budget ----------
  await test('an empty history leaves the whole weekly budget', () => {
    assert.strictEqual(R.weeklyRemaining(cfg(), blank(), '2026-09-15'), 560);
  });

  await test('the trailing 7 days INCLUDING today are counted', () => {
    const s = blank();
    // the six days before, plus today
    for (const d of ['2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13','2026-09-14']) s.history[d] = 80;
    s.history['2026-09-15'] = 20;
    assert.strictEqual(R.weeklyRemaining(cfg(), s, '2026-09-15'), 560 - 500);
  });

  await test('days older than 7 fall out of the window', () => {
    const s = blank();
    s.history['2026-09-01'] = 500;   // 14 days before, must not count
    assert.strictEqual(R.weeklyRemaining(cfg(), s, '2026-09-15'), 560);
  });

  await test('weeklyRemaining never goes negative', () => {
    const s = blank();
    s.history['2026-09-15'] = 9999;
    assert.strictEqual(R.weeklyRemaining(cfg(), s, '2026-09-15'), 0);
  });

  // ---------- effectiveCap: the whole point ----------
  await test('effectiveCap is the daily cap when the week has room', () => {
    assert.strictEqual(R.effectiveCap(cfg(), blank(), '2026-09-15'), 80);
  });

  await test('effectiveCap is cut by the weekly budget when the week is nearly spent', () => {
    const s = blank();
    for (const d of ['2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13','2026-09-14']) s.history[d] = 90;
    // 540 spent, 20 left, daily cap would be 80
    assert.strictEqual(R.effectiveCap(cfg(), s, '2026-09-15'), 20);
  });

  await test('effectiveCap is 0 once the weekly budget is gone', () => {
    const s = blank();
    for (const d of ['2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13','2026-09-14']) s.history[d] = 100;
    assert.strictEqual(R.effectiveCap(cfg(), s, '2026-09-15'), 0);
  });

  await test('the full 14-day ramp never breaches the weekly budget', () => {
    const s = blank();
    const start = Date.parse('2026-09-01T00:00:00Z');
    for (let d = 0; d < 21; d++) {
      const iso = new Date(start + d * 864e5).toISOString().slice(0, 10);
      const cap = R.effectiveCap(cfg(), s, iso);
      R.recordFires(s, iso, cap);
      assert.ok(R.weeklyRemaining(cfg(), s, iso) >= 0, `week breached on ${iso}`);
    }
    // week 1 = 175, week 2 = 420, week 3 = 560
    const wk = (days) => days.reduce((a, d) => a + (s.history[d] || 0), 0);
    const iso = (d) => new Date(start + d * 864e5).toISOString().slice(0, 10);
    assert.strictEqual(wk([0,1,2,3,4,5,6].map(iso)), 175);
    assert.strictEqual(wk([7,8,9,10,11,12,13].map(iso)), 420);
    assert.strictEqual(wk([14,15,16,17,18,19,20].map(iso)), 560);
  });

  // ---------- recordFires ----------
  await test('recordFires accumulates within a day', () => {
    const s = blank();
    R.recordFires(s, '2026-09-15', 3);
    R.recordFires(s, '2026-09-15', 4);
    assert.strictEqual(s.history['2026-09-15'], 7);
  });

  console.log(`\n${passed} passed`);
})();
```

- [ ] **Step 2: Run it and verify it fails**

Run: `PATH="/opt/homebrew/bin:$PATH" node tests/profile-views-ramp.test.js`
Expected: FAIL, `Cannot find module '../profile-views-ramp.js'`

- [ ] **Step 3: Write the implementation**

Create `profile-views-ramp.js`:

```js
/**
 * profile-views-ramp.js — ramp maths for daily-profile-views.js. Pure.
 *
 * The daily cap is NOT the binding constraint. Account limits read 2026-08-20:
 * stPersonProfileViews daily 200 but weekly 560 ENABLED, and 560/7 = 80 exactly.
 * Ramping past 80/day spends the week's budget by Wednesday and then sits dead,
 * so a rolling trailing-7-day budget is enforced alongside the daily cap.
 */

const DAY_MS = 864e5;
const dayKey = (d) => (d instanceof Date ? d : new Date(d + "T00:00:00Z")).toISOString().slice(0, 10);

/** Days elapsed since the ramp start, floored at 0. */
function rampDay(cfg, todayISO) {
  if (!cfg.rampStartDate) return 0;
  const diff = Date.parse(todayISO + "T00:00:00Z") - Date.parse(cfg.rampStartDate + "T00:00:00Z");
  return Math.max(0, Math.floor(diff / DAY_MS));
}

/**
 * Today's ramp cap, before the weekly budget is applied.
 * A frozen ramp (we have seen limitExceeded) holds 10% below the observed number
 * forever. Tripping the platform limit every single day is the pattern that
 * looks like abuse, so the ramp never rises again once it has been frozen.
 */
function dailyCap(cfg, state, todayISO) {
  if (state && state.rampFrozen && state.observedLimit) {
    return Math.max(0, Math.min(Math.floor(state.observedLimit * 0.9), cfg.hardMax));
  }
  const raw = cfg.base + cfg.step * rampDay(cfg, todayISO);
  return Math.max(0, Math.min(raw, cfg.ceiling, cfg.hardMax));
}

/** Budget left in the trailing 7 days, INCLUDING today's fires so far. */
function weeklyRemaining(cfg, state, todayISO) {
  const end = Date.parse(todayISO + "T00:00:00Z");
  let spent = 0;
  for (let i = 0; i < 7; i++) {
    spent += (state.history && state.history[dayKey(new Date(end - i * DAY_MS))]) || 0;
  }
  return Math.max(0, cfg.weeklyBudget - spent);
}

/** What we may actually fire today. */
function effectiveCap(cfg, state, todayISO) {
  return Math.max(0, Math.min(dailyCap(cfg, state, todayISO), weeklyRemaining(cfg, state, todayISO)));
}

/** Accumulate fires for a day. Called after every successful view. */
function recordFires(state, todayISO, n) {
  if (!state.history) state.history = {};
  state.history[todayISO] = (state.history[todayISO] || 0) + n;
  return state;
}

/**
 * We hit linkedapi's limitExceeded at `count`. Record it and stop ramping.
 * Caller must still end the day CLEANLY and must NOT write a STOP file.
 */
function recordLimitHit(state, count) {
  state.observedLimit = count;
  state.rampFrozen = true;
  return state;
}

module.exports = { rampDay, dailyCap, weeklyRemaining, effectiveCap, recordFires, recordLimitHit };
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `PATH="/opt/homebrew/bin:$PATH" node tests/profile-views-ramp.test.js`
Expected: `18 passed`

- [ ] **Step 5: Commit**

```bash
git add profile-views-ramp.js tests/profile-views-ramp.test.js
git commit -m "feat(views): ramp maths with a rolling trailing-7-day budget

The weekly 560 binds before the daily 200. A naive daily ramp past 80 spends
the week by Wednesday then sits dead. limitExceeded freezes the ramp at 10%
below the observed number rather than retripping it daily."
```

---

### Task 3: Targeting, exclusions and scoring

**Files:**
- Create: `profile-views-targeting.js`
- Test: `tests/profile-views-targeting.test.js`

**Interfaces:**
- Consumes: `cfg` from Task 1 (`activeWithinDays`, `personCooldownDays`), `state.viewed` from Task 2.
- Produces:
  - Candidate shape: `{ username, linkedinUrl, pool, lastPostedAt }` where `lastPostedAt` is epoch ms or `null`.
  - `scoreOf(candidate, ctx)` -> `number` (higher fires first), or `null` if excluded.
  - `buildQueue(candidates, ctx)` -> sorted array of candidates, excluded ones removed, each annotated with `score`.
  - `ctx` shape: `{ cfg, state, firstDegree: Set, blocklist: Set, cache: object, gate: module, nowMs: number }`
- Note: `gate` is the existing `reaction-icp-gate.js`, consumed read-only. Do not modify it.

- [ ] **Step 1: Write the failing test**

Create `tests/profile-views-targeting.test.js`:

```js
// tests/profile-views-targeting.test.js
// Views target a PERSON, not a post, so every constraint that shaped the likes
// engine disappears. Posts are used only as a RECENCY signal for ordering:
// 194,380 banked posts collapse to 5,071 authors of whom only 129 are not
// already in the cache, so post-first discovery buys nothing here.
//
// Deliberate departure from the PRD: we exclude only KNOWN gate fails and let
// UNKNOWNS through, because st.openPersonPage returns the full profile for free,
// so a view of an unknown is a free lookup that improves every later decision.
const assert = require('assert');
const T = require('../profile-views-targeting.js');
const GATE = require('../reaction-icp-gate.js');
const { DEFAULT_CONFIG } = require('../profile-views-config.js');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

const NOW = Date.parse('2026-09-15T12:00:00Z');
const daysAgo = (n) => NOW - n * 864e5;

// A profile that passes the gate: GB, plenty of followers, decision-maker title.
const PASS_PROFILE = { countryCode: 'GB', followers: 5000, headline: 'Founder at Acme', industry: '' };
// A profile that fails: wrong country.
const FAIL_PROFILE = { countryCode: 'IN', followers: 5000, headline: 'Founder at Acme', industry: '' };

const ctx = (over = {}) => ({
  cfg: { ...DEFAULT_CONFIG },
  state: { viewed: {}, history: {} },
  firstDegree: new Set(),
  blocklist: new Set(),
  cache: {},
  gate: GATE,
  nowMs: NOW,
  ...over,
});

const cand = (over = {}) => ({
  username: 'someone',
  linkedinUrl: 'https://www.linkedin.com/in/someone',
  pool: 'views-cache',
  lastPostedAt: null,
  ...over,
});

(async () => {
  // ---------- exclusions ----------
  await test('1st-degree connections are excluded', () => {
    const c = ctx({ firstDegree: new Set(['someone']) });
    assert.strictEqual(T.scoreOf(cand(), c), null);
  });

  await test('blocklisted people are excluded', () => {
    const c = ctx({ blocklist: new Set(['someone']) });
    assert.strictEqual(T.scoreOf(cand(), c), null);
  });

  await test('company pages are excluded', () => {
    const c = ctx();
    const company = cand({ username: 'acme', linkedinUrl: 'https://www.linkedin.com/company/acme/' });
    assert.strictEqual(T.scoreOf(company, c), null);
  });

  await test('a KNOWN gate fail is excluded', () => {
    const c = ctx({ cache: { someone: { profile: FAIL_PROFILE } } });
    assert.strictEqual(T.scoreOf(cand(), c), null);
  });

  await test('an UNKNOWN profile is NOT excluded, because the view enriches for free', () => {
    const c = ctx();
    assert.ok(T.scoreOf(cand(), c) > 0);
  });

  await test('someone viewed inside the cooldown is excluded', () => {
    const c = ctx({ state: { viewed: { someone: new Date(daysAgo(5)).toISOString() }, history: {} } });
    assert.strictEqual(T.scoreOf(cand(), c), null);
  });

  await test('someone viewed beyond the 30 day cooldown is eligible again', () => {
    const c = ctx({ state: { viewed: { someone: new Date(daysAgo(31)).toISOString() }, history: {} } });
    assert.ok(T.scoreOf(cand(), c) > 0);
  });

  // ---------- scoring bands ----------
  await test('cached PASS + recently active outranks every other band', () => {
    const c = ctx({ cache: { someone: { profile: PASS_PROFILE } } });
    const active = T.scoreOf(cand({ lastPostedAt: daysAgo(3) }), c);
    const dormant = T.scoreOf(cand({ lastPostedAt: daysAgo(200) }), c);
    assert.ok(active > dormant, 'active should outrank dormant');
  });

  await test('unknown + active outranks cached PASS + dormant', () => {
    const known = ctx({ cache: { someone: { profile: PASS_PROFILE } } });
    const unknown = ctx();
    const unknownActive = T.scoreOf(cand({ lastPostedAt: daysAgo(2) }), unknown);
    const knownDormant = T.scoreOf(cand({ lastPostedAt: daysAgo(300) }), known);
    assert.ok(unknownActive > knownDormant);
  });

  await test('cached PASS + dormant outranks unknown + dormant', () => {
    const known = ctx({ cache: { someone: { profile: PASS_PROFILE } } });
    const unknown = ctx();
    assert.ok(
      T.scoreOf(cand({ lastPostedAt: daysAgo(300) }), known) >
      T.scoreOf(cand({ lastPostedAt: daysAgo(300) }), unknown)
    );
  });

  await test('a post older than activeWithinDays does not count as active', () => {
    const c = ctx({ cache: { someone: { profile: PASS_PROFILE } } });
    const justInside = T.scoreOf(cand({ lastPostedAt: daysAgo(13) }), c);
    const justOutside = T.scoreOf(cand({ lastPostedAt: daysAgo(15) }), c);
    assert.ok(justInside > justOutside);
  });

  await test('never posted is scored, not excluded', () => {
    const c = ctx({ cache: { someone: { profile: PASS_PROFILE } } });
    assert.ok(T.scoreOf(cand({ lastPostedAt: null }), c) > 0);
  });

  // ---------- buildQueue ----------
  await test('buildQueue drops excluded candidates and sorts by score descending', () => {
    const c = ctx({
      firstDegree: new Set(['friend']),
      cache: { good: { profile: PASS_PROFILE }, bad: { profile: FAIL_PROFILE } },
    });
    const q = T.buildQueue([
      cand({ username: 'friend', linkedinUrl: 'https://www.linkedin.com/in/friend' }),
      cand({ username: 'bad', linkedinUrl: 'https://www.linkedin.com/in/bad' }),
      cand({ username: 'stranger', linkedinUrl: 'https://www.linkedin.com/in/stranger', lastPostedAt: daysAgo(1) }),
      cand({ username: 'good', linkedinUrl: 'https://www.linkedin.com/in/good', lastPostedAt: daysAgo(1) }),
    ], c);
    assert.deepStrictEqual(q.map((x) => x.username), ['good', 'stranger']);
    assert.ok(q[0].score >= q[1].score);
  });

  await test('buildQueue dedupes by username, keeping the higher-scoring entry', () => {
    const c = ctx({ cache: { dup: { profile: PASS_PROFILE } } });
    const q = T.buildQueue([
      cand({ username: 'dup', linkedinUrl: 'https://www.linkedin.com/in/dup', pool: 'views-ksd', lastPostedAt: null }),
      cand({ username: 'dup', linkedinUrl: 'https://www.linkedin.com/in/dup', pool: 'views-active', lastPostedAt: daysAgo(1) }),
    ], c);
    assert.strictEqual(q.length, 1);
    assert.strictEqual(q[0].pool, 'views-active');
  });

  await test('buildQueue annotates each survivor with its score', () => {
    const q = T.buildQueue([cand()], ctx());
    assert.strictEqual(typeof q[0].score, 'number');
  });

  console.log(`\n${passed} passed`);
})();
```

- [ ] **Step 2: Run it and verify it fails**

Run: `PATH="/opt/homebrew/bin:$PATH" node tests/profile-views-targeting.test.js`
Expected: FAIL, `Cannot find module '../profile-views-targeting.js'`

- [ ] **Step 3: Write the implementation**

Create `profile-views-targeting.js`:

```js
/**
 * profile-views-targeting.js — build the daily view queue. Pure.
 *
 * A like needs a POST. A view needs only a PERSON, so the 2,949 cached "dud"
 * profiles and the 2,360 null-URN entries become fully addressable.
 *
 * Posts are a RECENCY signal only, never a discovery mechanism: 194,380 banked
 * posts collapse to 5,071 distinct authors, of whom only 129 are not already in
 * the resolve cache. Someone who posted last week will actually see the view
 * notification; someone dormant since March will not.
 *
 * Departure from PRD section 4: we exclude only KNOWN gate fails and let
 * UNKNOWNS through. st.openPersonPage returns the full profile for free, so a
 * view of an unknown is a zero-cost lookup that improves every later decision
 * for BOTH engines. The only slot we refuse to spend is on someone already
 * proven off-ICP.
 */

const DAY_MS = 864e5;

// Score bands. Gaps are wide enough that the recency bonus can never lift a
// candidate out of its band, so band order is guaranteed.
const BAND_PASS_ACTIVE = 4000;
const BAND_UNKNOWN_ACTIVE = 3000;
const BAND_PASS_DORMANT = 2000;
const BAND_UNKNOWN_DORMANT = 1000;
const RECENCY_MAX = 900;

function cachedProfileOf(cache, username) {
  const e = cache && cache[username];
  if (!e || !e.profile || e.profile.unresolved) return null;
  return e.profile;
}

/**
 * @returns {number|null} higher fires first; null means excluded
 */
function scoreOf(candidate, ctx) {
  const { cfg, state, firstDegree, blocklist, cache, gate, nowMs } = ctx;
  const u = candidate.username;
  if (!u) return null;

  if (firstDegree.has(u)) return null;
  if (blocklist.has(u)) return null;
  if (gate.isCompanyAuthor({ url: candidate.linkedinUrl })) return null;

  // Person cooldown, own value, not shared with reactions.
  const seen = state.viewed && state.viewed[u];
  if (seen && nowMs - Date.parse(seen) < cfg.personCooldownDays * DAY_MS) return null;

  // Known gate FAIL is the only ICP exclusion. Unknown is allowed through.
  const prof = cachedProfileOf(cache, u);
  let known = false;
  if (prof) {
    const verdict = gate.icpVerdict(prof, cfg);
    if (!verdict.pass) return null;
    known = true;
  }

  const active = candidate.lastPostedAt != null &&
    nowMs - candidate.lastPostedAt < cfg.activeWithinDays * DAY_MS;

  const band = known
    ? (active ? BAND_PASS_ACTIVE : BAND_PASS_DORMANT)
    : (active ? BAND_UNKNOWN_ACTIVE : BAND_UNKNOWN_DORMANT);

  // Within a band, more recent posts first. Never posted scores 0 here.
  let recency = 0;
  if (candidate.lastPostedAt != null) {
    const ageDays = Math.max(0, (nowMs - candidate.lastPostedAt) / DAY_MS);
    recency = Math.round(RECENCY_MAX / (1 + ageDays));
  }

  return band + recency;
}

/**
 * @returns {Array} surviving candidates, deduped by username, score-annotated,
 *   highest first.
 */
function buildQueue(candidates, ctx) {
  const best = new Map();
  for (const c of candidates) {
    const score = scoreOf(c, ctx);
    if (score == null) continue;
    const prev = best.get(c.username);
    if (!prev || score > prev.score) best.set(c.username, { ...c, score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
}

module.exports = { scoreOf, buildQueue, cachedProfileOf };
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `PATH="/opt/homebrew/bin:$PATH" node tests/profile-views-targeting.test.js`
Expected: `16 passed`

- [ ] **Step 5: Commit**

```bash
git add profile-views-targeting.js tests/profile-views-targeting.test.js
git commit -m "feat(views): targeting queue, posts as recency signal not discovery

194,380 banked posts collapse to 5,071 authors of whom 129 are new, so
post-first discovery buys nothing for views. Posts rank the queue instead.
Excludes only KNOWN gate fails; unknowns are a free lookup via openPersonPage."
```

---

### Task 4: Limits client (the ramp governor)

**Files:**
- Create: `linkedapi-limits.js`
- Test: `tests/linkedapi-limits.test.js`

**Interfaces:**
- Produces:
  - `parseUsage(json, category)` -> `{ daily: {used, max, enabled}|null, weekly: {...}|null }`
  - `shouldStop(usage)` -> `{ stop: boolean, reason: string|null }`
  - `getUsage(post, accountId)` -> Promise of the parsed payload; `post` is injected as `(path, body) => Promise<{status, json}>`
- Verified live 2026-08-20: `POST /admin/limits.getUsage` with header `linked-api-token` and body `{accountId}` returns `{success, result:{usage:[{category, period, currentUsage, maxValue, isEnabled}]}}`.

- [ ] **Step 1: Write the failing test**

Create `tests/linkedapi-limits.test.js`:

```js
// tests/linkedapi-limits.test.js
// limits.getUsage is FREE and authoritative in a way our own counter is not: a
// manual LinkedIn session, or Prosp, also consumes the same quota and the engine
// would never know. Payload shape captured live 2026-08-20.
const assert = require('assert');
const L = require('../linkedapi-limits.js');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

// Real payload, trimmed to the categories that matter.
const LIVE = {
  success: true,
  result: {
    usage: [
      { category: 'stPersonProfileViews', period: 'daily',   currentUsage: 1, maxValue: 200, isEnabled: true },
      { category: 'stPersonProfileViews', period: 'weekly',  currentUsage: 1, maxValue: 560, isEnabled: true },
      { category: 'stPersonProfileViews', period: 'monthly', currentUsage: 1, maxValue: 2400, isEnabled: false },
      { category: 'stReactions',          period: 'daily',   currentUsage: 81, maxValue: 200, isEnabled: true },
    ],
  },
};

(async () => {
  await test('parseUsage pulls the daily and weekly rows for the category', () => {
    const u = L.parseUsage(LIVE, 'stPersonProfileViews');
    assert.deepStrictEqual(u.daily, { used: 1, max: 200, enabled: true });
    assert.deepStrictEqual(u.weekly, { used: 1, max: 560, enabled: true });
  });

  await test('parseUsage ignores other categories', () => {
    const u = L.parseUsage(LIVE, 'stPersonProfileViews');
    assert.notStrictEqual(u.daily.used, 81);
  });

  await test('parseUsage returns nulls for an unknown category', () => {
    const u = L.parseUsage(LIVE, 'nvMessages');
    assert.strictEqual(u.daily, null);
    assert.strictEqual(u.weekly, null);
  });

  await test('parseUsage survives a malformed payload', () => {
    assert.deepStrictEqual(L.parseUsage({}, 'stPersonProfileViews'), { daily: null, weekly: null });
    assert.deepStrictEqual(L.parseUsage(null, 'stPersonProfileViews'), { daily: null, weekly: null });
  });

  await test('shouldStop is false with headroom', () => {
    assert.deepStrictEqual(L.shouldStop(L.parseUsage(LIVE, 'stPersonProfileViews')), { stop: false, reason: null });
  });

  await test('shouldStop is true when the daily quota is spent', () => {
    const u = { daily: { used: 200, max: 200, enabled: true }, weekly: { used: 300, max: 560, enabled: true } };
    const r = L.shouldStop(u);
    assert.strictEqual(r.stop, true);
    assert.ok(/daily/.test(r.reason));
  });

  await test('shouldStop is true when the WEEKLY quota is spent even if daily has room', () => {
    const u = { daily: { used: 10, max: 200, enabled: true }, weekly: { used: 560, max: 560, enabled: true } };
    const r = L.shouldStop(u);
    assert.strictEqual(r.stop, true);
    assert.ok(/weekly/.test(r.reason));
  });

  await test('a DISABLED period is ignored', () => {
    const u = { daily: { used: 999, max: 200, enabled: false }, weekly: { used: 1, max: 560, enabled: true } };
    assert.strictEqual(L.shouldStop(u).stop, false);
  });

  await test('unknown usage does not stop the run (fail open, the ramp cap still binds)', () => {
    assert.strictEqual(L.shouldStop({ daily: null, weekly: null }).stop, false);
  });

  await test('getUsage posts to the right path with the accountId', async () => {
    const calls = [];
    const post = async (p, b) => { calls.push([p, b]); return { status: 201, json: LIVE }; };
    const u = await L.getUsage(post, 'acc-123', 'stPersonProfileViews');
    assert.deepStrictEqual(calls[0][0], '/admin/limits.getUsage');
    assert.deepStrictEqual(calls[0][1], { accountId: 'acc-123' });
    assert.strictEqual(u.weekly.max, 560);
  });

  await test('getUsage returns nulls rather than throwing on a transport failure', async () => {
    const post = async () => { throw new Error('ECONNRESET'); };
    const u = await L.getUsage(post, 'acc-123', 'stPersonProfileViews');
    assert.deepStrictEqual(u, { daily: null, weekly: null });
  });

  console.log(`\n${passed} passed`);
})();
```

- [ ] **Step 2: Run it and verify it fails**

Run: `PATH="/opt/homebrew/bin:$PATH" node tests/linkedapi-limits.test.js`
Expected: FAIL, `Cannot find module '../linkedapi-limits.js'`

- [ ] **Step 3: Write the implementation**

Create `linkedapi-limits.js`:

```js
/**
 * linkedapi-limits.js — read our account's live rate-limit usage.
 *
 * Free, and authoritative in a way our own counter is not: a manual LinkedIn
 * session or a Prosp campaign consumes the same quota and the engine would
 * never know. Transport is injected so this is unit-testable offline.
 *
 * Verified live 2026-08-20 (accountId in ~/.credentials/api-keys.json under
 * linkedapi_io.accountId):
 *   POST https://api.linkedapi.io/admin/limits.getUsage
 *   headers: linked-api-token, Content-Type: application/json
 *   body:    {"accountId": "..."}
 *   ->       {success, result:{usage:[{category, period, currentUsage, maxValue, isEnabled}]}}
 */

function parseUsage(json, category) {
  const out = { daily: null, weekly: null };
  const rows = json && json.result && Array.isArray(json.result.usage) ? json.result.usage : [];
  for (const r of rows) {
    if (r.category !== category) continue;
    if (r.period !== "daily" && r.period !== "weekly") continue;
    out[r.period] = { used: r.currentUsage, max: r.maxValue, enabled: !!r.isEnabled };
  }
  return out;
}

/**
 * Fail OPEN on unknown usage: the ramp cap and the local rolling budget still
 * bind, so a transport blip must not silently zero the day.
 */
function shouldStop(usage) {
  for (const period of ["daily", "weekly"]) {
    const u = usage && usage[period];
    if (!u || !u.enabled) continue;
    if (u.used >= u.max) return { stop: true, reason: `${period} quota spent (${u.used}/${u.max})` };
  }
  return { stop: false, reason: null };
}

/** @param {(path:string, body:object)=>Promise<{status:number,json:object}>} post */
async function getUsage(post, accountId, category) {
  try {
    const r = await post("/admin/limits.getUsage", { accountId });
    return parseUsage(r && r.json, category);
  } catch {
    return { daily: null, weekly: null };
  }
}

module.exports = { parseUsage, shouldStop, getUsage };
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `PATH="/opt/homebrew/bin:$PATH" node tests/linkedapi-limits.test.js`
Expected: `11 passed`

- [ ] **Step 5: Commit**

```bash
git add linkedapi-limits.js tests/linkedapi-limits.test.js
git commit -m "feat(views): live limits.getUsage client as the ramp governor

Free, and catches quota spent outside this engine (manual sessions, Prosp).
Fails open so a transport blip cannot silently zero the day."
```

---

### Task 5: The orchestrator

**Files:**
- Create: `daily-profile-views.js`
- Modify: none

**Interfaces:**
- Consumes: `loadConfig`/`DEFAULT_CONFIG` (Task 1), `effectiveCap`/`recordFires`/`recordLimitHit` (Task 2), `buildQueue` (Task 3), `getUsage`/`shouldStop` (Task 4), and `reaction-icp-gate.js` read-only.
- Produces: the runnable engine. `--dry-run` fires nothing.

**Sources it reads (all local, zero discovery cost):**
- `data/reaction-resolve-cache.json` -> pool `views-cache` (read only, never written)
- `data/posts-seen.jsonl` -> `lastPostedAt` per author, and pool `views-active`
- `data/pool-ksd.csv`, `data/pool-campaign.csv`, `data/pool-press.csv` -> pools `views-ksd` etc
- `data/first-degree-connections.txt`, `data/reactions-blocklist.txt` -> exclusions

- [ ] **Step 1: Write the engine**

Create `daily-profile-views.js`:

```js
#!/usr/bin/env node
/**
 * daily-profile-views.js — daily LinkedIn profile views via linkedapi.io
 * st.openPersonPage. Runs ALONGSIDE daily-reactions-batch.js and never touches
 * it: stPersonProfileViews and stReactions are separate rate-limit categories.
 *
 * Ramp: 10 +5/day to 80/day. The binding constraint is the WEEKLY 560, not the
 * daily 200, so profile-views-ramp.js enforces a rolling trailing-7-day budget.
 *
 * Renidly/linkdapi is deliberately NOT wired in. st.openPersonPage returns
 * countryCode, followersCount, headline, position, companyName, about and urn
 * for free, so this engine has no reason to spend a credit and is structurally
 * incapable of doing so. See docs/probe-openpersonpage-2026-08-20.md.
 *
 * Every view appends to data/profile-enrichment.jsonl. It must NEVER write to
 * data/reaction-resolve-cache.json: the reactions engine reads that 1.8MB blob
 * whole and writes it whole, so a second writer would silently clobber entries
 * already paid for in credits.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { execFileSync } = require("child_process");

const CFGMOD = require("./profile-views-config.js");
const RAMP = require("./profile-views-ramp.js");
const TARGET = require("./profile-views-targeting.js");
const LIMITS = require("./linkedapi-limits.js");
const GATE = require("./reaction-icp-gate.js");

const ROOT = __dirname;
const DRY = process.argv.includes("--dry-run");
const P = (f) => path.join(ROOT, "data", f);
const CONFIG_PATH = P("profile-views-config.json");
const STATE_PATH = P("profile-views-state.json");
const STOP_PATH = P("STOP-profile-views");
const ENRICH_PATH = P("profile-enrichment.jsonl");
const LEDGER_PATH = P("credit-ledger.jsonl");
const CACHE_PATH = P("reaction-resolve-cache.json");
const POSTS_PATH = P("posts-seen.jsonl");
const FIRSTDEG_PATH = P("first-degree-connections.txt");
const BLOCKLIST_PATH = P("reactions-blocklist.txt");

const todayISO = () => new Date().toISOString().slice(0, 10);
const LOG_PATH = P(`profile-views-${todayISO()}.log`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + "\n"); } catch {}
}
function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}
function saveJson(p, o) { fs.writeFileSync(p, JSON.stringify(o, null, 2)); }

const keys = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".credentials/api-keys.json"), "utf8"));
const LA_HEADERS = {
  "linked-api-token": keys.linkedapi_io.apiKey,
  "identification-token": keys.linkedapi_io.identificationToken,
  "Content-Type": "application/json",
};
const ACCOUNT_ID = keys.linkedapi_io.accountId;

// ---------- WhatsApp (same bridge the reactions engine uses) ----------
function whatsapp(message) {
  try {
    const token = fs.readFileSync("/root/.trendmine-internal-token", "utf8").trim();
    execFileSync("curl", ["-s", "-m", "15", "-X", "POST",
      "-H", `X-Internal-Token: ${token}`, "-H", "Content-Type: application/json",
      "-d", JSON.stringify({ to: "447989746146", message, source: "linkedin-profile-views" }),
      "http://localhost:3848/send-direct"], { encoding: "utf8" });
  } catch (e) { log(`whatsapp failed (non-fatal): ${e.message}`); }
}

// ---------- linkedapi.io transport ----------
const TRANSIENT_RE = /EPIPE|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|socket hang up|timeout/i;
const LIMIT_RE = /limitExceeded|limit for this action|action category has been exceeded/i;
const RESTRICTION_RE = /restrict|challenge|checkpoint|banned|unauthoriz|unauthenticated|invalidToken|accountNotConnected/i;

function laReqOnce(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const r = https.request({ method, hostname: "api.linkedapi.io", path: urlPath, headers: LA_HEADERS, timeout: 30000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString() || "{}") }); }
        catch { resolve({ status: res.statusCode, json: {} }); }
      });
    });
    r.on("error", reject);
    r.on("timeout", () => r.destroy(new Error("ETIMEDOUT request timeout")));
    try { if (body) r.write(JSON.stringify(body)); r.end(); } catch (e) { reject(e); }
  });
}
async function laReq(method, urlPath, body, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try { return await laReqOnce(method, urlPath, body); }
    catch (e) {
      const msg = (e && (e.code || e.message)) || "";
      if (!TRANSIENT_RE.test(msg) || i === tries) throw e;
      log(`laReq ${method} ${urlPath} transient (${msg}), retry ${i}/${tries - 1}`);
      await sleep(2000 * i);
    }
  }
}
const laPost = (p, b) => laReq("POST", p, b);

/** One profile view. Returns {ok, data} or {ok:false, error}. */
async function openPersonPage(personUrl) {
  const start = await laReq("POST", "/workflows", { actionType: "st.openPersonPage", personUrl, basicInfo: true });
  const wfId = start.json && start.json.result && start.json.result.workflowId;
  if (!wfId) return { ok: false, error: JSON.stringify(start.json).slice(0, 300) };
  for (let i = 0; i < 30; i++) {
    await sleep(6000);
    const p = await laReq("GET", `/workflows/${wfId}`);
    const st = p.json && p.json.result && p.json.result.workflowStatus;
    if (st === "completed") {
      const comp = p.json.result.completion;
      if (comp && comp.success === false) return { ok: false, error: `${comp.error && comp.error.type}: ${comp.error && comp.error.message}` };
      return { ok: true, data: (comp && comp.data) || {} };
    }
    if (st === "failed") return { ok: false, error: JSON.stringify(p.json.result).slice(0, 300) };
  }
  return { ok: false, error: "poll timeout" };
}

// ---------- source loading (all local, zero discovery cost) ----------
const usernameOf = (url) => {
  const m = (url || "").match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : null;
};
function readLines(p) {
  try {
    return fs.readFileSync(p, "utf8").split("\n").map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch { return []; }
}
/** authorUsername -> most recent postedAt (epoch ms) */
function lastPostedByAuthor() {
  const out = new Map();
  let raw;
  try { raw = fs.readFileSync(POSTS_PATH, "utf8"); } catch { return out; }
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const u = usernameOf(d.authorUrl);
    if (!u) continue;
    const t = d.postedAt || 0;
    if (t > (out.get(u) || 0)) out.set(u, t);
  }
  return out;
}
function csvUsernames(file) {
  const out = [];
  let raw;
  try { raw = fs.readFileSync(P(file), "utf8"); } catch { return out; }
  const lines = raw.split("\n").filter(Boolean);
  if (!lines.length) return out;
  const head = lines[0].split(",").map((h) => h.replace(/"/g, "").trim().toLowerCase());
  const col = head.findIndex((h) => h.includes("linkedin"));
  if (col < 0) return out;
  for (const line of lines.slice(1)) {
    const cells = line.match(/("([^"]|"")*"|[^,]*)/g) || [];
    const u = usernameOf((cells[col] || "").replace(/^"|"$/g, ""));
    if (u) out.push(u);
  }
  return out;
}

function buildCandidates(cache, posted) {
  const seen = new Set();
  const out = [];
  const add = (u, pool) => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push({
      username: u,
      linkedinUrl: `https://www.linkedin.com/in/${u}`,
      pool,
      lastPostedAt: posted.get(u) || null,
    });
  };
  // Post authors first so they claim the views-active label.
  for (const u of posted.keys()) add(u, "views-active");
  for (const u of Object.keys(cache)) add(u, "views-cache");
  for (const [file, pool] of [["pool-ksd.csv", "views-ksd"], ["pool-campaign.csv", "views-campaign"], ["pool-press.csv", "views-press"]]) {
    for (const u of csvUsernames(file)) add(u, pool);
  }
  return out;
}

// ---------- guards ----------
function singleInstanceGuard() {
  // NOTE: filters own pid and ppid only. A `timeout` wrapper makes the shell a
  // GRANDparent, which false-positives. Do not wrap the cron in `timeout`.
  try {
    const out = execFileSync("pgrep", ["-f", "daily-profile-views.js"], { encoding: "utf8" });
    const pids = out.split("\n").map((s) => s.trim()).filter(Boolean)
      .filter((p) => p !== String(process.pid) && p !== String(process.ppid));
    if (pids.length) { log(`another instance is running (pids ${pids.join(",")}), exiting`); process.exit(0); }
  } catch { /* pgrep exits 1 when nothing matches */ }
}
process.on("unhandledRejection", (e) => {
  log(`unhandledRejection: ${e && e.message}`);
  whatsapp(`profile-views: unhandledRejection ${e && e.message}`);
  process.exit(1);
});
process.on("uncaughtException", (e) => {
  log(`uncaughtException: ${e && e.message}`);
  whatsapp(`profile-views: uncaughtException ${e && e.message}`);
  process.exit(1);
});

// ---------- main ----------
async function main() {
  singleInstanceGuard();
  if (fs.existsSync(STOP_PATH)) { log("STOP file present, exiting"); return; }

  const cfg = CFGMOD.loadConfig(loadJson, CONFIG_PATH);
  const state = loadJson(STATE_PATH, { viewed: {}, history: {}, observedLimit: null, rampFrozen: false });
  if (!state.viewed) state.viewed = {};
  if (!state.history) state.history = {};

  // First run sets the ramp start date, in BOTH the state and the JSON config.
  const today = todayISO();
  if (!cfg.rampStartDate) {
    cfg.rampStartDate = today;
    const raw = loadJson(CONFIG_PATH, {});
    raw.rampStartDate = today;
    saveJson(CONFIG_PATH, raw);
    log(`ramp start date initialised to ${today}`);
  }

  const cap = RAMP.effectiveCap(cfg, state, today);
  const daily = RAMP.dailyCap(cfg, state, today);
  const weekLeft = RAMP.weeklyRemaining(cfg, state, today);
  log(`Daily profile views | day ${RAMP.rampDay(cfg, today)} | daily cap ${daily} | week left ${weekLeft} | firing ${cap}${DRY ? " | DRY-RUN" : ""}`);
  if (state.rampFrozen) log(`ramp FROZEN at observedLimit ${state.observedLimit}, holding at ${daily}`);
  if (cap === 0) { log("nothing to fire today (weekly budget spent), exiting cleanly"); return; }

  // Live quota check before we spend anything.
  const usage0 = await LIMITS.getUsage(laPost, ACCOUNT_ID, "stPersonProfileViews");
  if (usage0.daily) log(`linkedapi usage: daily ${usage0.daily.used}/${usage0.daily.max}, weekly ${usage0.weekly ? usage0.weekly.used + "/" + usage0.weekly.max : "?"}`);
  const stop0 = LIMITS.shouldStop(usage0);
  if (stop0.stop) { log(`linkedapi says ${stop0.reason}, exiting cleanly`); return; }

  const cache = loadJson(CACHE_PATH, {});
  const posted = lastPostedByAuthor();
  const firstDegree = new Set(readLines(FIRSTDEG_PATH));
  const blocklist = new Set(readLines(BLOCKLIST_PATH).map((l) => usernameOf(l) || l.toLowerCase()));
  log(`Sources: cache ${Object.keys(cache).length}, post authors ${posted.size}, 1st-degree ${firstDegree.size}, blocklist ${blocklist.size}`);

  const ctx = { cfg, state, firstDegree, blocklist, cache, gate: GATE, nowMs: Date.now() };
  const queue = TARGET.buildQueue(buildCandidates(cache, posted), ctx);
  const byPool = queue.slice(0, cap).reduce((a, t) => { a[t.pool] = (a[t.pool] || 0) + 1; return a; }, {});
  log(`Queue: ${queue.length} eligible | today's slice by pool: ${JSON.stringify(byPool)}`);
  if (!queue.length) { log("queue empty, exiting cleanly"); return; }

  let fired = 0, consecFail = 0, halted = null;
  const windowEnd = new Date(); windowEnd.setUTCHours(cfg.spreadEndHourUTC, 0, 0, 0);

  for (const target of queue) {
    if (fired >= cap) break;
    if (fs.existsSync(STOP_PATH)) { halted = "STOP file appeared mid-run"; break; }

    if (DRY) {
      log(`  [would VIEW] (${target.pool}) ${target.username} score ${target.score}`);
      fired++;
      continue;
    }

    const res = await openPersonPage(target.linkedinUrl);

    if (res.ok) {
      fired++; consecFail = 0;
      state.viewed[target.username] = new Date().toISOString();
      RAMP.recordFires(state, today, 1);
      const d = res.data || {};
      // Append-only. NEVER write reaction-resolve-cache.json from here.
      try {
        fs.appendFileSync(ENRICH_PATH, JSON.stringify({
          ts: new Date().toISOString(), username: target.username, pool: target.pool,
          urn: d.urn || null, countryCode: d.countryCode || null, followers: d.followersCount || 0,
          headline: d.headline || "", position: d.position || "", companyName: d.companyName || "",
          about: d.about || "", source: "st.openPersonPage",
        }) + "\n");
      } catch (e) { log(`enrichment append failed (non-fatal): ${e.message}`); }
      saveJson(STATE_PATH, state);
      log(`  ✓ [${fired}/${cap}] (${target.pool}) ${d.name || target.username} ${d.countryCode || "?"} ${d.followersCount || 0}f`);
    } else {
      const err = String(res.error || "");
      if (LIMIT_RE.test(err)) {
        // linkedapi's own configured limit. Benign. End the day CLEANLY and
        // NEVER write a STOP file: that would block tomorrow and the watchdog.
        RAMP.recordLimitHit(state, fired);
        saveJson(STATE_PATH, state);
        log(`limitExceeded at ${fired} views. Ramp frozen, holding at ${Math.floor(fired * 0.9)}. Ending the day cleanly.`);
        whatsapp(`profile-views: limitExceeded at ${fired} views. Ramp frozen. This is the number we were looking for.`);
        halted = "limitExceeded";
        break;
      }
      if (RESTRICTION_RE.test(err)) {
        // A genuine LinkedIn restriction. Auto-restarting into this kills the seat.
        fs.writeFileSync(STOP_PATH, `restriction ${new Date().toISOString()}: ${err}\n`);
        log(`RESTRICTION: ${err}. STOP file written.`);
        whatsapp(`profile-views: LinkedIn RESTRICTION, engine stopped. ${err.slice(0, 200)}`);
        halted = "restriction";
        break;
      }
      consecFail++;
      log(`  ✗ (${target.pool}) ${target.username}: ${err.slice(0, 160)}`);
      if (consecFail >= cfg.maxConsecutiveFailures) {
        halted = `${consecFail} consecutive failures`;
        whatsapp(`profile-views: halted after ${consecFail} consecutive failures. Last: ${err.slice(0, 200)}`);
        break;
      }
    }

    // Re-read the live quota periodically: other tools share this budget.
    if (fired > 0 && fired % cfg.usagePollEvery === 0) {
      const u = await LIMITS.getUsage(laPost, ACCOUNT_ID, "stPersonProfileViews");
      const s = LIMITS.shouldStop(u);
      if (s.stop) { log(`linkedapi says ${s.reason}, ending the day cleanly`); halted = s.reason; break; }
    }

    // Spread the remainder across the rest of the window rather than a fixed
    // gap: a fixed range does not fit (80 views over 08:15-20:00 is 529s with
    // zero slack), so any stall would silently truncate the day.
    const remaining = cap - fired;
    if (remaining > 0) {
      const msLeft = windowEnd.getTime() - Date.now();
      const spread = msLeft > 0 ? msLeft / remaining : cfg.throttleMinMs;
      const delay = Math.min(cfg.throttleMaxMs, Math.max(cfg.throttleMinMs, spread));
      await sleep(Math.round(delay * (0.85 + Math.random() * 0.3)));
    }
  }

  saveJson(STATE_PATH, state);
  log(`Done. Fired ${fired}/${cap}${halted ? ` | halted: ${halted}` : ""} | week now ${RAMP.weeklyRemaining(cfg, state, today)} left`);

  // Renidly reconciliation: this engine makes no billable calls, so a
  // workstream:"views" row in the ledger is an ALARM, not noise.
  try {
    const rows = fs.readFileSync(LEDGER_PATH, "utf8").split("\n")
      .filter((l) => l.includes('"workstream":"views"'));
    if (rows.length) {
      log(`ALARM: ${rows.length} views rows in credit-ledger.jsonl. This engine must not bill.`);
      whatsapp(`profile-views: ALARM, ${rows.length} Renidly ledger rows tagged views. This engine should cost zero.`);
    }
  } catch { /* no ledger yet is the expected state */ }
}

if (require.main === module) main();
module.exports = { buildCandidates, usernameOf, lastPostedByAuthor };
```

- [ ] **Step 2: Syntax check**

Run: `PATH="/opt/homebrew/bin:$PATH" node -e "require('./daily-profile-views.js'); console.log('parsed ok')"`
Expected: `parsed ok`

- [ ] **Step 3: Run all four test files and confirm they still pass**

```bash
PATH="/opt/homebrew/bin:$PATH"
for t in profile-views-config profile-views-ramp profile-views-targeting linkedapi-limits; do
  echo "--- $t"; node tests/$t.test.js || exit 1
done
```
Expected: every file reports `N passed` and exit code 0.

- [ ] **Step 4: Dry run locally**

Run: `PATH="/opt/homebrew/bin:$PATH" node daily-profile-views.js --dry-run 2>&1 | head -30`

Expected: a `Daily profile views | day 0 | daily cap 10 ...` line, a `Sources:` line with non-zero counts, a `Queue:` line with a large eligible count, and exactly 10 `[would VIEW]` lines. **Verify the cap in the log is 10, not something else** — per handover §2.1, confirm caps from the run log, never from reading the source.

- [ ] **Step 5: Confirm no linkdapi reference exists anywhere in the new code**

```bash
grep -rniE "linkdapi|renidly|X-linkdapi|profile/overview" \
  daily-profile-views.js profile-views-*.js linkedapi-limits.js \
  | grep -v "^.*: *\*" | grep -v "^.*://" || echo "CLEAN: no linkdapi integration"
```
Expected: `CLEAN: no linkdapi integration` (comments mentioning it by name are fine; there must be no `require`, no URL, no header).

- [ ] **Step 6: Commit**

```bash
git add daily-profile-views.js
git commit -m "feat(views): the daily-profile-views orchestrator

st.openPersonPage via the same POST-then-poll workflow pattern as reactToPost.
Carries over every safety guard from the reactions engine: single-instance
pgrep, STOP file, 3-consecutive-failure halt, unhandled rejection guards.
limitExceeded freezes the ramp and ends the day cleanly without a STOP file;
a genuine LinkedIn restriction writes one and alerts.

Throttle is computed from remaining window over remaining views rather than a
fixed range, so a stall cannot silently truncate the day.

Enrichment appends to profile-enrichment.jsonl and never touches
reaction-resolve-cache.json, which the reactions engine reads and writes whole."
```

---

### Task 6: Deploy and schedule

**Files:**
- Modify: crontab on clawdbot
- Create: `docs/views-engine-runbook.md`

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: a live cron at 08:15 UTC.

- [ ] **Step 1: Confirm the reactions run is not in progress**

```bash
ssh clawdbot 'pgrep -f daily-reactions-batch.js && echo "STILL RUNNING, wait" || echo "clear"'
```
Expected: `clear`. If it is still running, wait. Do not deploy alongside a live run.

- [ ] **Step 2: Copy the engine and its modules to the VPS**

```bash
cd "/Users/kobestarr/Development/One Hour Vibe Coder/outreach-automation"
scp daily-profile-views.js profile-views-config.js profile-views-ramp.js \
    profile-views-targeting.js linkedapi-limits.js clawdbot:/root/linkedin-reactions/
scp data/profile-views-config.json clawdbot:/root/linkedin-reactions/data/
```

- [ ] **Step 3: Verify byte-for-byte parity with the repo**

```bash
for f in daily-profile-views.js profile-views-config.js profile-views-ramp.js profile-views-targeting.js linkedapi-limits.js; do
  echo "$(md5 -q $f)  $f"
done
ssh clawdbot 'cd /root/linkedin-reactions && md5sum daily-profile-views.js profile-views-config.js profile-views-ramp.js profile-views-targeting.js linkedapi-limits.js'
```
Expected: all five checksums match. This is the check that was skipped on 20 Aug and left the VPS ahead of git.

- [ ] **Step 4: Dry run ON THE VPS against real data**

```bash
ssh clawdbot 'cd /root/linkedin-reactions && /usr/bin/node daily-profile-views.js --dry-run 2>&1 | head -30'
```
Expected: `daily cap 10`, a non-empty `Queue:` line, 10 `[would VIEW]` lines. The VPS has the real `posts-seen.jsonl` and cache, so the queue should be in the thousands.

- [ ] **Step 5: Add the cron, 30 minutes after the reactions cron**

```bash
ssh clawdbot 'crontab -l > /tmp/ct && \
  echo "15 8 * * * cd /root/linkedin-reactions && /usr/bin/node daily-profile-views.js >> data/profile-views-cron-\$(date +\%F).log 2>&1" >> /tmp/ct && \
  crontab /tmp/ct && crontab -l | grep profile-views'
```
Expected: the new line echoes back. **Do not wrap the command in `timeout`** — that makes the shell a grandparent process and false-positives the pgrep guard.

- [ ] **Step 6: Write the runbook**

Create `docs/views-engine-runbook.md`:

```markdown
# Runbook: daily-profile-views.js

Cron: `15 8 * * *` on clawdbot, `/root/linkedin-reactions/`.
Reactions runs at 07:45; views is staggered 30 min behind it.

## Daily check
    ssh clawdbot 'tail -5 /root/linkedin-reactions/data/profile-views-$(date +%F).log'

Expect: `Daily profile views | day N | daily cap C | week left W | firing F`,
then `✓ [n/C]` lines.

## Stop it
    ssh clawdbot 'echo manual > /root/linkedin-reactions/data/STOP-profile-views'
Remove the file to resume. This STOP file is NOT shared with the reactions engine.

## Live quota
    limits.getUsage, accountId in ~/.credentials/api-keys.json under linkedapi_io.accountId.
    stPersonProfileViews: daily 200, weekly 560 ENABLED. The weekly binds first.

## Expected credit spend
Zero. The linkdapi client is not wired into this engine. A `workstream:"views"`
row in `data/credit-ledger.jsonl` is an alarm and triggers a WhatsApp message.

## If it reports limitExceeded
That is the number we were ramping to find. The ramp freezes automatically at
10% below it and the day ends cleanly with no STOP file. Nothing to do except
record the number in the spec.

## If it reports RESTRICTION
Stop. A STOP file has been written and a WhatsApp sent. Do NOT clear it without
checking the LinkedIn account in a browser first.
```

- [ ] **Step 7: Commit the deploy**

```bash
git add docs/views-engine-runbook.md
git commit -m "docs(views): runbook, and record the 08:15 UTC cron deploy

Deployed to clawdbot and checksum-verified against the repo. Commit follows
the deploy immediately, per handover section 7."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 probe findings | already committed in `docs/probe-openpersonpage-2026-08-20.md` |
| §3 target universe | Task 5 `buildCandidates` |
| §4 single scored queue, pool labels | Task 3 |
| §4.1 exclusions | Task 3 |
| §4.2 scoring, unknowns allowed | Task 3 |
| §5 ramp, weekly budget | Task 2 |
| §5.1 limit governor, limitExceeded, RESTRICTION | Task 4 + Task 5 |
| §6 zero Renidly | Task 1 (`renidlyCallBudget: 0`), Task 5 Step 5 (grep proof), ledger alarm |
| §7 own state and files | Task 1, Task 5 |
| §8 enrichment JSONL, no cache race | Task 5 |
| §9 safety guards | Task 5 |
| §9.1 combined rate heartbeat | out of scope, spec §14 |
| §10 testing | Tasks 1-4 |
| §11 attribution via pool labels | Task 3 (`pool` preserved through `buildQueue`) |
| §12 deploy | Task 6 |
| §15 reactions gate fix | Task 0, own branch |

**Type consistency:** `state` is `{viewed, history, observedLimit, rampFrozen}` in Tasks 2, 3 and 5. Candidate is `{username, linkedinUrl, pool, lastPostedAt}` in Tasks 3 and 5, gaining `score` only after `buildQueue`. `ctx` carries `{cfg, state, firstDegree, blocklist, cache, gate, nowMs}` in both Task 3's test and Task 5's construction. `parseUsage` output `{daily, weekly}` with `{used, max, enabled}` matches `shouldStop` input in Task 4 and the Task 5 call site.

**Placeholders:** none. Every step carries the code to be written or the exact command to run.
