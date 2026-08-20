/**
 * profile-views-targeting.js — build the daily view queue. Pure.
 *
 * A like needs a POST. A view needs only a PERSON, so the cached "dud" profiles
 * (no post in 45d) and the null-URN entries become fully addressable.
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

// Score bands. Gaps are wider than RECENCY_MAX so the recency bonus can never
// lift a candidate out of its band. tests/profile-views-targeting.test.js pins this.
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
    if (!verdict.pass && gate.shouldBlock(verdict, cfg)) return null;
    known = verdict.pass;
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
