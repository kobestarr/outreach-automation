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
