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
