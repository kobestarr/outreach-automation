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
 *
 * Our account, same date: stPersonProfileViews daily 200, weekly 560 ENABLED.
 * The WEEKLY binds first (560/7 = 80/day), which is why shouldStop checks both.
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

/** Tightest enabled headroom across the periods. Infinity when unknown. */
function remaining(usage) {
  let least = Infinity;
  for (const period of ["daily", "weekly"]) {
    const u = usage && usage[period];
    if (!u || !u.enabled) continue;
    least = Math.min(least, Math.max(0, u.max - u.used));
  }
  return least;
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

module.exports = { parseUsage, shouldStop, remaining, getUsage };
