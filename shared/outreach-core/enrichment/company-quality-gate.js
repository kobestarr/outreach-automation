// shared/outreach-core/enrichment/company-quality-gate.js
//
// Signal Engine stage 2: company-quality-gate.js. Contract: docs/hiring-signals-architecture.md.
//
// Every SignalRecord passed in comes back OUT with fields added — never deleted, never dropped from
// the array. A record that fails a hard rule gets lane='drop' + dropReason; a record we're unsure
// about gets lane='review'; a record that survives everything gets a real lane
// ('small-direct'|'mid-augmentation'|'website-pitch') once stage B has had a look at it.
//
// STAGE A — hardRuleDrop(record): pure, synchronous, ZERO I/O. Regex-only. Fully unit-testable without
// any fakes. Corroboration matters more than any single keyword: bare "hire"/"talent"/"resourc" must
// NOT drop a record (kills "Van Hire Ltd"), and "Marketing & Communications Manager" must never be
// mistaken for a PR role.
//
// STAGE B — survivors only, io-injected. Collapses to UNIQUE company (normName-keyed, matches the
// resolver's own company-cooldown key) BEFORE enriching, so a company with five open roles costs one
// domain lookup + one profile call, not five. Hard-capped per run (default 60) — companies past the
// cap are left exactly as stage A left them (lane still null) so the next run picks them up; nothing
// is lost, nothing is guessed.
//
// io adapters (inject fakes in tests; real impls at the bottom, both timeout-guarded):
//   resolveDomain(companyName, location) -> domain string | null
//   companyProfile(domain)               -> { oneLiner, sizeBand, businessType } | null

const { normName } = require('./decision-maker-resolver');

// ---------------------------------------------------------------------------
// Stage A regexes — see docs/hiring-signals-architecture.md "Hard rules (gate stage A)"
// ---------------------------------------------------------------------------

// Corroborated recruiter-agency name match. Deliberately does NOT include bare
// hire/talent/resourc — those have too many legitimate non-recruiter businesses
// ("Van Hire Ltd", "Resourceful Design Ltd", "Talent Studios") to hard-drop on.
const RECRUITER_RE = /recruit|staffing|headhunt|\btalent (solutions|acquisition|partners)\b|search partners|better placed|searchability|digital waffle|forward role|get recruited|\bhays\b|\breed\b|michael page|adecco|randstad/i;

// Bare, uncorroborated recruiter-ish tokens: not confident enough to drop, but worth a human look.
// "hire" is intentionally excluded — it survives untouched (Van Hire Ltd is not a recruiter).
const SOFT_RECRUITER_HINT_RE = /\btalent\b|\bresourc(e|ing)?\b/i;

// Scraped title carries the posting agency after an "@", e.g. "SEO Manager @ Reed" —
// the EMPLOYER (companyName) is still real, so this is a review, not a drop.
const TITLE_RECRUITER_PATTERN_RE = /@\s*[\w&.'-]*\s*\b(recruit|staffing|talent|hays|reed|adecco|randstad|michael page)\b/i;

const GIG_PLATFORM_RE = /alignerr|mercor|invisible tech|meridial|crossing hurdles|remotasks|scale ai|outlier ai/i;

const AGENCY_COMPETITOR_NAME_RE = /vaynermedia|digitas|\bthe dubs\b/i;
const MARKETING_CONTENT_ROLE_RE = /\b(market|seo|sem|ppc|growth|brand|demand gen|comms|communications|digital|content|podcast|producer|editorial|social media|video|audio|creative|studio)\b/i;

// "\bPR\b" requires PR as its own token, so "Marketing & Communications Manager" is untouched.
const PR_ROLE_RE = /\bPR\b|public relations|press officer|media relations/i;

const IN_PERSON_ROLE_RE = /videograph|photograph|camera operator|event (producer|manager|coordinator)|field marketing|retail|ambassador|in-store|barista/i;

// Known mega-corporations: pure name match, no I/O, no dependency on stage B's size read.
// (Ambiguity resolution: the doc's "giant: known-big list AND large size signal" is read here as
// TWO independent triggers, not one AND'd condition needing I/O — see this module's header notes
// and the final report for the full reasoning.)
const KNOWN_GIANTS_RE = /\b(google|alphabet|amazon|microsoft|meta platforms|facebook|apple inc|deloitte|pwc|pricewaterhousecoopers|kpmg|ernst ?& ?young|\bey\b|accenture|ibm|hsbc|barclays|vodafone|\bbt\b group|unilever|nike|adidas|sainsbury|tesco|john lewis|aviva|\baxa\b|nestle|coca-cola|pepsico|procter & gamble|jpmorgan|goldman sachs|shell|bp\b)/i;

function isKnownGiant(name) {
  return KNOWN_GIANTS_RE.test(String(name || ''));
}

// ---------------------------------------------------------------------------
// Stage A: pure classifier. Returns { lane: 'drop'|'review'|null, dropReason: string|null }.
// lane === null means "no hard rule fired, pass to stage B".
// ---------------------------------------------------------------------------
function hardRuleDrop(record) {
  const name = String((record && record.companyName) || '');
  const title = String((record && record.roleTitle) || '');

  if (isKnownGiant(name)) return { lane: 'drop', dropReason: 'giant' };
  if (GIG_PLATFORM_RE.test(name)) return { lane: 'drop', dropReason: 'gig-platform' };

  if (AGENCY_COMPETITOR_NAME_RE.test(name)) return { lane: 'drop', dropReason: 'agency-competitor' };
  if (/\bagency\b/i.test(name) && MARKETING_CONTENT_ROLE_RE.test(title)) {
    return { lane: 'drop', dropReason: 'agency-competitor' };
  }

  if (PR_ROLE_RE.test(title)) return { lane: 'drop', dropReason: 'pr-role' };
  if (IN_PERSON_ROLE_RE.test(title)) return { lane: 'drop', dropReason: 'in-person-role' };

  if (RECRUITER_RE.test(name)) return { lane: 'drop', dropReason: 'recruiter' };
  if (TITLE_RECRUITER_PATTERN_RE.test(title)) return { lane: 'review', dropReason: null };
  if (SOFT_RECRUITER_HINT_RE.test(name)) return { lane: 'review', dropReason: null };

  return { lane: null, dropReason: null };
}

// ---------------------------------------------------------------------------
// Stage B pure helpers (testable without I/O)
// ---------------------------------------------------------------------------
function estimatedHeadcountFor(sizeBand) {
  if (sizeBand === 'small') return 10;
  if (sizeBand === 'mid') return 100;
  if (sizeBand === 'large') return 600;
  return null;
}

// Decide the lane for a survivor once stage B has a businessType/sizeBand read.
// Ambiguity resolution: sizeBand has no 'giant' value in the contract (only
// small/mid/large/unknown), so "giant (large size signal)" is read as
// businessType==='brand' AND sizeBand==='large' — a household-name consumer brand at real scale,
// as opposed to a large-but-ordinary B2B business (which still gets 'mid-augmentation').
function laneFromEnrichment({ businessType = 'unknown', sizeBand = 'unknown', roleTitle = null } = {}) {
  if (businessType === 'agency') return 'drop';   // marketing/creative agency = competitor, can't pitch our services
  if (businessType === 'brand' && sizeBand === 'large') return 'drop';
  if (businessType === 'brand' && IN_PERSON_ROLE_RE.test(String(roleTitle || ''))) return 'review';
  if (sizeBand === 'small') return 'small-direct';
  if (sizeBand === 'mid' || sizeBand === 'large') return 'mid-augmentation';
  return 'review';
}

// ---------------------------------------------------------------------------
// io timeout guard — defends against a hanging injected adapter (fake or real) even though the
// real adapters also carry their own AbortSignal.timeout internally.
// ---------------------------------------------------------------------------
function withTimeout(promiseLike, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([Promise.resolve(promiseLike).finally(() => clearTimeout(timer)), timeout]);
}

const IO_TIMEOUT_MS = 30_000;

function defaultFields() {
  return {
    companyDomain: null,
    companyOneLiner: null,
    businessType: 'unknown',
    sizeBand: 'unknown',
    estimatedHeadcount: null,
    isRealEmployer: true,
    lane: null,
    dropReason: null,
    gateConfidence: 0.4, // name-only baseline until stage B (or a hard rule) says otherwise
  };
}

// Apply stage A to one record. Returns a NEW object (record's own fields preserved + gate fields added).
function applyStageA(record) {
  const fields = defaultFields();
  const { lane, dropReason } = hardRuleDrop(record);
  if (lane === 'drop') {
    fields.lane = 'drop';
    fields.dropReason = dropReason;
    fields.isRealEmployer = false;
    fields.gateConfidence = 0.9; // rule-based, high confidence
  } else if (lane === 'review') {
    fields.lane = 'review';
    fields.gateConfidence = 0.35; // borderline name/title hit, needs a human look
  }
  // lane === null: survivor, fields stay at defaults, goes on to stage B
  return { ...record, ...fields };
}

// Enrich ONE unique company via io. Returns the fields to apply to every record for that company.
async function enrichCompany(companyName, location, io) {
  let domain = null;
  if (typeof io.resolveDomain === 'function') {
    try {
      domain = await withTimeout(io.resolveDomain(companyName, location), IO_TIMEOUT_MS, 'resolveDomain');
    } catch { domain = null; }
  }

  if (!domain) {
    // No domain found: a FEATURE, not a failure — pitch them a website.
    return {
      companyDomain: null, companyOneLiner: null, businessType: 'unknown', sizeBand: 'unknown',
      estimatedHeadcount: null, isRealEmployer: true, lane: 'website-pitch', dropReason: null,
      gateConfidence: 0.4,
    };
  }

  let profile = null;
  if (typeof io.companyProfile === 'function') {
    try {
      profile = await withTimeout(io.companyProfile(domain), IO_TIMEOUT_MS, 'companyProfile');
    } catch { profile = null; }
  }

  if (!profile) {
    // Domain exists but we couldn't read it: keep the domain, flag for a human look.
    return {
      companyDomain: domain, companyOneLiner: null, businessType: 'unknown', sizeBand: 'unknown',
      estimatedHeadcount: null, isRealEmployer: true, lane: 'review', dropReason: null,
      gateConfidence: 0.4,
    };
  }

  const oneLiner = profile.oneLiner || null;
  const businessType = profile.businessType || 'unknown';
  const sizeBand = profile.sizeBand || 'unknown';

  return {
    companyDomain: domain,
    companyOneLiner: oneLiner,
    businessType,
    sizeBand,
    estimatedHeadcount: estimatedHeadcountFor(sizeBand),
    isRealEmployer: true,
    lane: null, // finalised per-record below (depends on that record's roleTitle for brand+in-person)
    dropReason: null,
    gateConfidence: 0.7, // website-derived
  };
}

// Stage B: mutate survivor copies in place with enrichment, collapsed to unique company, capped.
async function applyStageB(survivors, io, maxEnrich) {
  if (!survivors.length) return survivors;

  const groups = new Map(); // normName(companyName) -> { companyName, location, records: [] }
  for (const r of survivors) {
    const key = normName(r.companyName);
    if (!groups.has(key)) groups.set(key, { companyName: r.companyName, location: r.location, records: [] });
    groups.get(key).records.push(r);
  }

  const keys = [...groups.keys()].slice(0, Math.max(0, maxEnrich));

  for (const key of keys) {
    const group = groups.get(key);
    const enrichment = await enrichCompany(group.companyName, group.location, io || {});
    for (const r of group.records) {
      Object.assign(r, enrichment);
      if (r.lane === null) {
        // giant/brand/small/mid decision needs THIS record's roleTitle (per-record, not per-company)
        r.lane = laneFromEnrichment({ businessType: r.businessType, sizeBand: r.sizeBand, roleTitle: r.roleTitle });
        if (r.lane === 'drop') { r.dropReason = 'giant'; r.isRealEmployer = false; }
      }
    }
  }
  // Overflow (keys past maxEnrich): records left exactly as stage A produced them (lane still null) —
  // next run's stage B will pick the company back up via the same normName key.

  return survivors;
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------
// gate(record|records[], io, opts) -> same shape back (array in, array out; single in, single out),
// every record labelled, none dropped from the array.
async function gate(input, io = {}, opts = {}) {
  const isArray = Array.isArray(input);
  const records = isArray ? input : [input];
  const maxEnrich = typeof opts.maxEnrich === 'number' ? opts.maxEnrich : 60;

  const staged = records.map(applyStageA);
  const survivors = staged.filter(r => r.lane === null);
  await applyStageB(survivors, io, maxEnrich);

  return isArray ? staged : staged[0];
}

// ---------------------------------------------------------------------------
// Real io adapters (NOT used in tests — inject fakes there). Both timeout-guarded and null-safe.
// ---------------------------------------------------------------------------

// Heuristic domain resolver: try companyname.com / .co.uk, confirm the page actually loads.
// No search API wired here (keep-it-simple per spec) — returns null rather than guess-and-hope.
async function resolveDomainReal(companyName, _location) {
  const cleaned = String(companyName || '')
    .toLowerCase()
    .replace(/\b(ltd|limited|plc|llp|inc|the|and|&|co|company|group|holdings)\b/g, '')
    .trim();
  const slug = cleaned.replace(/[^a-z0-9]/g, '');
  if (!slug) return null;
  // distinctive name tokens (len>=4) used to sanity-check the fetched page is actually this company
  const tokens = cleaned.split(/[^a-z0-9]+/).filter(t => t.length >= 4);

  for (const tld of ['.com', '.co.uk', '.io', '.co', '.agency', '.studio', '.uk']) {
    const domain = `${slug}${tld}`;
    try {
      const res = await fetch(`https://${domain}`, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(IO_TIMEOUT_MS) });
      if (!res.ok) continue;
      // Content check: page should mention a distinctive name token, else it's likely a wrong/parked
      // domain that merely resolves. If we have no distinctive token, accept a loading page as-is.
      if (!tokens.length) return domain;
      const html = (await res.text().catch(() => '')).toLowerCase();
      if (tokens.some(t => html.includes(t))) return domain;
    } catch {
      // try next candidate
    }
  }
  return null;
}

// Fetch the site + ask Haiku for a one-liner/sizeBand/businessType read. Lazy-loaded client,
// same credential path as llm-owner-extractor.js.
let _client = null;
function getLLMClient() {
  if (_client) return _client;
  const fs = require('fs');
  const path = require('path');
  const credsPath = path.join(require('os').homedir(), '.credentials/api-keys.json');
  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
  const Anthropic = require('@anthropic-ai/sdk');
  _client = new Anthropic({ apiKey: creds.anthropic.apiKey });
  return _client;
}

const PROFILE_PROMPT = `You are reading a company website to triage it for B2B outreach.

Company name: "{COMPANY}"
Website text:
{TEXT}

Return ONLY valid JSON, no other text:
{"oneLiner":"<=15 words describing what this company does","sizeBand":"small|mid|large","businessType":"business|brand|agency"}

sizeBand: "small" ~1-20 people, "mid" ~20-250 people, "large" 250+ people (best-effort from the text).
businessType: "business" = ordinary B2B/local company; "brand" = a household-name consumer brand;
"agency" = a marketing, creative, content, digital, advertising, SEO, PR, design or media agency, studio
or consultancy (a company that SELLS marketing/content/creative services to other companies).`;

async function companyProfileReal(domain) {
  try {
    // crawl4ai renders JS + defeats bot-blocks (returns clean markdown); fall back to simple fetch.
    const { crawlText } = require('./crawl4ai-fetch');
    let text = await crawlText(`https://${domain}`, 60000);
    if (!text) {
      const { fetchWebsiteText } = require('./llm-owner-extractor');
      text = await withTimeout(fetchWebsiteText(`https://${domain}`), IO_TIMEOUT_MS, 'fetchWebsiteText');
    }
    if (!text) return null;

    const client = getLLMClient();
    const prompt = PROFILE_PROMPT.replace('{COMPANY}', domain).replace('{TEXT}', text.slice(0, 4000));
    const response = await withTimeout(
      client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
      IO_TIMEOUT_MS,
      'companyProfile LLM call'
    );

    const raw = response.content[0].text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return {
      oneLiner: parsed.oneLiner || null,
      sizeBand: ['small', 'mid', 'large'].includes(parsed.sizeBand) ? parsed.sizeBand : 'unknown',
      businessType: ['business', 'brand', 'agency'].includes(parsed.businessType) ? parsed.businessType : 'unknown',
    };
  } catch {
    return null;
  }
}

module.exports = {
  gate,
  hardRuleDrop,
  laneFromEnrichment,
  estimatedHeadcountFor,
  isKnownGiant,
  resolveDomainReal,
  companyProfileReal,
};
