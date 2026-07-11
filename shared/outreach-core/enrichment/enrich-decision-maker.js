// shared/outreach-core/enrichment/enrich-decision-maker.js
//
// Stage 4 of the Signal Engine (docs/hiring-signals-architecture.md). Takes a SignalRecord that
// already carries resolver fields (dmName, dmTitle, dmLinkedIn, dmConfidence, dmSources) plus
// companyDomain, and ADDS (accreting merge, per the canonical-record rule — every existing field
// on the record is preserved):
//
//   email, reoonStatus, emailSource ('website'|'pattern'|null), contactConfidence (0..1),
//   linkedinResolved (bool)
//
// Email cascade:
//   (a) a website-scraped email for this exact person, if the caller can supply one via
//       io.websiteEmailLookup — project rule: website-scraped emails are auto-valid, no Reoon
//       spend needed. emailSource='website', reoonStatus='website-valid'.
//   (b) else generate patterns from dmName + companyDomain (first@, first.last@, flast@,
//       firstlast@) and Reoon-verify ONE AT A TIME, short-circuiting on the FIRST 'safe' result
//       so we never spend a credit past the first hit. Anything that isn't 'safe' (catch_all,
//       unknown, invalid, disposable, ...) is discarded — email stays null. emailSource='pattern'
//       only if a safe email was actually found; otherwise emailSource stays null even though the
//       pattern route was attempted (reoonStatus still records the last status seen, for
//       diagnostics/overflow triage).
//   Budget guard: before touching Reoon, checks io.quotaRemaining() against how many patterns
//   THIS record would need. If the daily quota can't cover them, we don't spend anything on a
//   partial attempt — we mark the record `overflow: true` / reoonStatus='quota-low-overflow' so a
//   later run (next day's quota) can pick it up, rather than silently losing it.
//
// LinkedIn: linkedinResolved is true ONLY if dmLinkedIn is present AND it was actually sourced via
// a real people-search route (dmSources includes 'linkedinPeople' — the only route in
// resolver-adapters.js that ever populates a linkedinUrl). Anything else (no dmSources hit, or a
// URL that shows up without that provenance) is treated as unconfirmed/guessed and is REJECTED —
// dmLinkedIn is nulled out and linkedinResolved=false. We never accept a bare constructed
// "linkedin.com/in/first-last" guess on faith; the same-looking slug is only trustworthy once a
// real search route independently confirmed it.
//
// io-injected (verifyEmails, quotaRemaining, optional websiteEmailLookup) so tests are hermetic —
// defaults fall back to the real reoon-verifier for production use.

const reoon = require('../email-verification/reoon-verifier');
const { isValidEmail } = require('../validation/data-quality');

const REOON_MODE = 'power';

// ---------- name -> email-pattern generation ----------
function firstLastOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: null, last: null };
  const clean = s => s.toLowerCase().replace(/[^a-z-]/g, '');
  const first = clean(parts[0]) || null;
  const last = parts.length > 1 ? (clean(parts[parts.length - 1]) || null) : null;
  return { first, last };
}

function cleanDomain(domain) {
  return String(domain || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '');
}

// Order matters: first@, first.last@, flast@, firstlast@ (per project pattern convention).
function generatePatterns(dmName, companyDomain) {
  const { first, last } = firstLastOf(dmName);
  const domain = cleanDomain(companyDomain);
  if (!first || !domain) return [];
  const patterns = [`${first}@${domain}`];
  if (last) {
    patterns.push(`${first}.${last}@${domain}`);
    patterns.push(`${first[0]}${last}@${domain}`);
    patterns.push(`${first}${last}@${domain}`);
  }
  return [...new Set(patterns)];
}

// ---------- LinkedIn provenance guard ----------
// Only the linkedinPeople adapter (resolver-adapters.js) ever attaches a linkedinUrl to a
// candidate — companiesHouse/websiteTeam/jdReportingLine don't. So "confirmed" == "came through
// that route". Anything else on dmLinkedIn without that provenance is untrusted by definition,
// however plausible the slug looks.
function isLinkedinConfirmed(signal) {
  return Array.isArray(signal.dmSources) && signal.dmSources.includes('linkedinPeople');
}

// ---------- contactConfidence ----------
// Blends how confident the resolver is in the PERSON (dmConfidence) with how reachable we've
// proven them to be (the "channel"): a website-scraped or Reoon-safe email is the strongest
// channel; a confirmed LinkedIn with no email is weaker but still worth something; nothing found
// is zero regardless of person confidence (confidence in a person we can't reach isn't contact
// confidence).
function computeContactConfidence(dmConfidence, hasEmail, emailSource, linkedinResolved) {
  const dmConf = typeof dmConfidence === 'number' ? dmConfidence : 0;
  let channel = 0;
  if (hasEmail && emailSource === 'website') channel = 1.0;
  else if (hasEmail && emailSource === 'pattern') channel = 0.85;
  else if (linkedinResolved) channel = 0.5;
  return Math.round(dmConf * channel * 100) / 100;
}

/**
 * @param {Object} signal - SignalRecord with dmName/dmTitle/dmLinkedIn/dmConfidence/dmSources + companyDomain
 * @param {Object} io - { verifyEmails(emails, mode) -> [{email,status,score,isSafeToSend}],
 *                        quotaRemaining() -> number, websiteEmailLookup(signal) -> Promise<string|null> (optional) }
 * @returns {Promise<Object>} the SAME record with email/reoonStatus/emailSource/contactConfidence/linkedinResolved added
 */
async function enrichDecisionMaker(signal, io = {}) {
  const verifyEmails = io.verifyEmails || reoon.verifyEmails;
  const quotaRemaining = io.quotaRemaining || reoon.getQuotaRemaining;
  const websiteEmailLookup = io.websiteEmailLookup || (async () => null);

  const out = { ...signal };

  let email = null;
  let emailSource = null;
  let reoonStatus = null;
  let overflow = undefined;

  // (a) website-scraped email for this person, auto-valid per project rule.
  let websiteEmail = null;
  try {
    websiteEmail = await websiteEmailLookup(signal);
  } catch {
    websiteEmail = null;
  }
  if (websiteEmail && isValidEmail(websiteEmail)) {
    email = websiteEmail;
    emailSource = 'website';
    reoonStatus = 'website-valid';
  } else {
    // (b) pattern cascade + Reoon short-circuit-on-first-safe.
    const patterns = generatePatterns(signal.dmName, signal.companyDomain);
    if (patterns.length) {
      const remaining = quotaRemaining();
      if (typeof remaining === 'number' && remaining < patterns.length) {
        reoonStatus = 'quota-low-overflow';
        overflow = true;
      } else {
        for (const pattern of patterns) {
          const results = await verifyEmails([pattern], REOON_MODE);
          const result = (results && results[0]) || null;
          reoonStatus = (result && result.status) || reoonStatus;
          if (result && result.status === 'safe') {
            email = pattern;
            emailSource = 'pattern';
            break;
          }
        }
      }
    }
  }

  // LinkedIn: never accept a guessed/constructed URL. Only keep it if it came from an actual
  // people-search route (linkedinPeople) that independently confirmed the person.
  const linkedinConfirmed = !!signal.dmLinkedIn && isLinkedinConfirmed(signal);
  const dmLinkedIn = linkedinConfirmed ? signal.dmLinkedIn : null;
  const linkedinResolved = linkedinConfirmed;

  out.email = email;
  out.reoonStatus = reoonStatus;
  out.emailSource = emailSource;
  out.dmLinkedIn = dmLinkedIn;
  out.linkedinResolved = linkedinResolved;
  out.contactConfidence = computeContactConfidence(signal.dmConfidence, !!email, emailSource, linkedinResolved);
  if (overflow) out.overflow = true;

  return out;
}

module.exports = {
  enrichDecisionMaker,
  generatePatterns,
  isLinkedinConfirmed,
  computeContactConfidence,
};
