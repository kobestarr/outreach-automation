/**
 * reaction-icp-gate.js — ICP gate for daily-reactions-batch.js.
 *
 * Why this exists (2026-07-22): an audit of 42 live reactions found ~6 in 10
 * landing on people who can never buy — company pages (26%), non-UK profiles
 * (India/US/Pakistan/DE/GI/PL), and non-decision-makers. Cause: the `search`
 * pool matches post TEXT, so "UK startup founder" happily returns a video
 * editor in Bhopal who typed "UK" in a caption.
 *
 * Staged by design. Kobi's call: tune the dials together as the ramp climbs
 * 10/day toward 400+, rather than big-bang a filter nobody has calibrated.
 *   Stage 1 (now):  company pages BLOCK. Everything else is shadow-scored —
 *                   logged with reasons, never blocked.
 *   Stage 2+:       promote a signal to blocking by adding its key to
 *                   `gateBlockOn` in data/reactions-daily-config.json
 *                   (e.g. ["country"] once we have seen a few days of data).
 *
 * Pure functions, zero deps — the batch runs standalone on the clawdbot VPS.
 */

// The one blocking rule. A company page cannot view you back, cannot accept a
// connection, and cannot buy. Liking one is spent budget with no return path.
function isCompanyAuthor(author) {
  if (!author) return false;
  if ((author.type || "").toUpperCase() === "COMPANY") return true;
  return /linkedin\.com\/(company|school|showcase)\//i.test(author.url || "");
}

// Decision-maker signals. Deliberately includes PROFESSION NOUNS, not just
// C-suite titles: the title-only version rejected "The accountant for scaling
// UK agencies | FCCA", who is close to an ideal lead. Recall matters more than
// precision here because the verdict is advisory until a dial is promoted.
const DECISION_MAKER_RE = /(founder|co-?founder|ceo\b|owner|managing director|managing partner|proprietor|principal|partner\b|director|head of|chief|cmo|cto|coo|\bmd\b|accountant|architect|solicitor|surveyor|consultant|agency|practice)/i;

// Hard exclusions. Mirrors the standing service boundary: remote/digital only,
// NOT a PR person, no in-person production/event/field work.
const EXCLUDED_ROLE_RE = /(freelance|student|\bintern\b|assistant|coordinator|open to work|public relations|\bpr manager\b|\bpr director\b|health and safety|recruitment consultant|video editor|photographer)/i;

const DEFAULTS = {
  minFollowers: 300,
  // Kobi 2026-07-29: expanded beyond UK. Full-accept = react regardless of post
  // language. English-only = react only if the profile reads English (Kobi serves
  // in English, so a Finnish-operating founder posting in Finnish is off-ICP).
  countriesAllow: ["gb", "no", "au", "nz", "us", "ca"],
  countriesEnglishOnly: ["se", "fi", "dk", "pt"],
  country: null, // legacy single-country; if set, folded into countriesAllow
};

// Lightweight English detector for the English-only countries. Density of common
// English FUNCTION words in the HEADLINE only — NOT the industry (LinkedIn's
// industry taxonomy is always English, so it would false-positive everything).
const EN_FUNCTION_WORDS = /\b(the|and|for|with|your|you|our|we|are|that|this|helping|from|into|about|who|what|how|of|to|in|at)\b/gi;
function isLikelyEnglish(headline) {
  const s = (headline || "").trim();
  if (!s) return false;
  return (s.match(EN_FUNCTION_WORDS) || []).length >= 1;
}

// Country decision: null = pass, string = reject reason.
function countryReason(cc, headline, c) {
  const allow = c.countriesAllow || (c.country ? [c.country] : ["gb"]);
  const enOnly = c.countriesEnglishOnly || [];
  if (allow.includes(cc)) return null;
  if (enOnly.includes(cc)) return isLikelyEnglish(headline) ? null : `country=${cc}(non-en)`;
  return "country=" + (cc || "?");
}

/**
 * Score a candidate. Returns every failed signal so the daily report shows
 * which dial is worth promoting next.
 * @param {{countryCode?:string, followers?:number, headline?:string, industry?:string}} p
 * @param {{minFollowers?:number, countriesAllow?:string[], countriesEnglishOnly?:string[], country?:string}} [cfg]
 */
function icpVerdict(p, cfg) {
  const c = Object.assign({}, DEFAULTS, cfg || {});
  const reasons = [];
  const cc = (p.countryCode || "").toLowerCase();

  const cReason = countryReason(cc, p.headline, c);
  if (cReason) reasons.push(cReason);
  if ((p.followers || 0) < c.minFollowers) reasons.push("followers<" + c.minFollowers);

  const blob = [p.headline, p.industry].filter(Boolean).join(" | ");
  if (EXCLUDED_ROLE_RE.test(blob)) reasons.push("excluded-role");
  else if (!DECISION_MAKER_RE.test(blob)) reasons.push("not-decision-maker");

  return { pass: reasons.length === 0, reasons };
}

// Maps a reason string ("country=in", "followers<300") to its dial key.
const dialOf = (reason) => String(reason).split(/[=<]/)[0];

/**
 * Shadow-mode contract: a verdict blocks ONLY if one of its failed signals is
 * named in cfg.gateBlockOn. Absent config = pure shadow mode (never blocks).
 */
function shouldBlock(verdict, cfg) {
  if (!verdict || verdict.pass) return false;
  const on = (cfg && cfg.gateBlockOn) || [];
  if (!on.length) return false;
  return verdict.reasons.some((r) => on.includes(dialOf(r)));
}

module.exports = { isCompanyAuthor, icpVerdict, shouldBlock, dialOf, isLikelyEnglish, countryReason, DECISION_MAKER_RE, EXCLUDED_ROLE_RE };
