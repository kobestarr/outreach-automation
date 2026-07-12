// shared/outreach-core/enrichment/resolver-adapters.js
//
// The REAL io adapters for decision-maker-resolver.resolve(signal, io). Each adapter matches the
// resolver's calling contract EXACTLY (see decision-maker-resolver.js's "io adapters" comment
// above resolve()) — resolve() calls each with a fixed argument shape and already wraps every
// adapter call in try/catch, so a thrown adapter error is survivable there too. These adapters
// ALSO catch internally and resolve to [] on any failure, so a down route never blocks the other
// three, and a bad seat/API/network hiccup never bubbles up as an unhandled rejection.
//
//   companiesHouse(companyName, companyDomain)  -> [{name, title:'Director', source}]
//   linkedinPeople(companyName, targetTitles)   -> [{name, title, linkedinUrl, source}]
//   websiteTeam(companyDomain, targetTitles)    -> [{name, title, email?, source}]
//   jdReportingLine(jobDescription)             -> [] (v1: searchJobs doesn't return a JD — dormant,
//                                                   see docs/hiring-signals-architecture.md)
//
// All network I/O goes through the global `fetch` (Node 24, no extra deps) so tests can mock it
// hermetically by monkey-patching global.fetch, matching the house style used in
// shared/outreach-core/sheets/sheets-client.js / tests/sheets-client.test.js.

const os = require('os');
const fs = require('fs');
const path = require('path');
const { nameMatchScore } = require('./decision-maker-resolver');
const ownerExtractor = require('./llm-owner-extractor'); // referenced live (not destructured) so tests can monkey-patch extractOwnersFromWebsite

const CREDS_PATH = path.join(os.homedir(), '.credentials', 'api-keys.json');
const ADAPTER_TIMEOUT_MS = 30_000;

function loadCreds() {
  try {
    return JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

async function fetchJson(url, opts = {}, timeoutMs = ADAPTER_TIMEOUT_MS) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  if (!res || !res.ok) return null;
  return res.json();
}

// ---------- companiesHouse ----------
// Companies House's /search/companies is fuzzy (it has matched "Monzo" -> an unrelated dissolved
// shell in the wild). We score every candidate against the searched name with the resolver's own
// nameMatchScore() and drop anything below the floor, PLUS always skip dissolved companies —
// a dissolved match is never a live decision-maker lead regardless of name score.
const CH_BASE = 'https://api.company-information.service.gov.uk';
const CH_NAME_MATCH_MIN = 0.5;

async function companiesHouse(companyName) {
  if (!companyName) return [];
  try {
    const creds = loadCreds();
    const apiKey = creds.companiesHouse && creds.companiesHouse.apiKey;
    if (!apiKey) return [];

    const headers = {
      Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64'),
      Accept: 'application/json',
    };

    const searchUrl = `${CH_BASE}/search/companies?q=${encodeURIComponent(companyName)}&items_per_page=10`;
    const searchResult = await fetchJson(searchUrl, { headers });
    const items = (searchResult && searchResult.items) || [];
    if (!items.length) return [];

    const scored = items
      .map(item => ({ item, score: nameMatchScore(companyName, item.title) }))
      .filter(({ item, score }) => score >= CH_NAME_MATCH_MIN
        && String(item.company_status || '').toLowerCase() !== 'dissolved')
      .sort((a, b) => b.score - a.score);
    if (!scored.length) return [];

    const best = scored[0].item;
    const officersUrl = `${CH_BASE}/company/${best.company_number}/officers`;
    const officersResult = await fetchJson(officersUrl, { headers });
    const officers = (officersResult && officersResult.items) || [];

    return officers
      .filter(o => !o.resigned_on && /director|secretary/i.test(o.officer_role || ''))
      .map(o => ({ name: normaliseCompaniesHouseName(o.name), title: 'Director', source: 'companiesHouse' }));
  } catch {
    return [];
  }
}

// Companies House returns "SURNAME, Forename Middle, Title" (e.g. "BUTLER, Ross, Mr").
// Downstream email-pattern generation needs "Forename Surname", so normalise it.
// Falls back to the raw name if the format is unexpected.
const HONORIFICS = /^(mr|mrs|ms|miss|dr|prof|sir|dame|lord|lady|mx|rev)\.?$/i;
function titleCaseWord(w) { return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w; }
function normaliseCompaniesHouseName(raw) {
  if (!raw || typeof raw !== 'string' || !raw.includes(',')) return raw;
  const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return raw;
  const surname = parts[0];
  // forenames = the first non-honorific segment after the surname
  const forenames = (parts.slice(1).find(p => !HONORIFICS.test(p)) || parts[1] || '')
    .split(/\s+/).filter(w => !HONORIFICS.test(w)).join(' ');
  if (!forenames) return raw;
  const tc = s => s.split(/\s+/).map(titleCaseWord).join(' ');
  return `${tc(forenames)} ${tc(surname)}`.trim();
}

// ---------- linkedinPeople ----------
// linkedapi.io: POST a workflow (st.searchPeople scoped by company name + top target title),
// then poll GET /workflows/{id} until workflowStatus is 'completed' or 'failed'. We chose
// linkedapi.io over linkdapi.com's read API for this route specifically because linkedapi.io is
// a plain fetch-able REST API (see linkedin-react-runner.js) — linkdapi.com sits behind
// Cloudflare and needs a curl+browser-UA workaround (see engagement-hunter.js), which would break
// hermetic `global.fetch` mocking for this module. Any workflow that hasn't completed within our
// 30s adapter budget is treated as unresolved (-> []), not an error — a slow/unconfirmed lookup
// should never block the rest of the resolver cascade.
const LINKEDAPI_BASE = 'https://api.linkedapi.io';
const LINKEDIN_POLL_INTERVAL_MS = 2000;
const LINKEDIN_POLL_BUDGET_MS = 27_000; // stays inside the 30s adapter timeout budget

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function pollWorkflow(workflowId, headers) {
  const deadline = Date.now() + LINKEDIN_POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    const remaining = Math.max(1000, deadline - Date.now());
    const poll = await fetchJson(`${LINKEDAPI_BASE}/workflows/${workflowId}`, { headers }, remaining);
    const result = poll && poll.result;
    const status = result && result.workflowStatus;
    if (status === 'completed') return result;
    if (status === 'failed') return null;
    if (Date.now() + LINKEDIN_POLL_INTERVAL_MS >= deadline) break;
    await sleep(LINKEDIN_POLL_INTERVAL_MS);
  }
  return null; // timed out within budget -> unresolved, not an error
}

async function linkedinPeople(companyName, targetTitles) {
  if (!companyName) return [];
  try {
    const creds = loadCreds();
    const cfg = creds.linkedapi_io || {};
    const apiToken = cfg.apiKey;
    const idToken = cfg.identificationToken;
    if (!apiToken || !idToken) return [];

    const headers = {
      'linked-api-token': apiToken,
      'identification-token': idToken,
      'Content-Type': 'application/json',
    };
    const keywords = [companyName, ...(Array.isArray(targetTitles) ? targetTitles.slice(0, 1) : [])]
      .filter(Boolean).join(' ');

    const start = await fetchJson(`${LINKEDAPI_BASE}/workflows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ actionType: 'st.searchPeople', keywords, limit: 10 }),
    });
    const workflowId = start && (start.workflowId || (start.result && start.result.workflowId));
    if (!workflowId) return [];

    const result = await pollWorkflow(workflowId, headers);
    const people = (result && (result.people || result.items || result.results)) || [];

    return people
      .filter(p => p && p.name)
      .map(p => ({
        name: p.name,
        title: p.headline || p.title || null,
        linkedinUrl: p.profileUrl || p.url || null,
        source: 'linkedinPeople',
      }));
  } catch {
    return [];
  }
}

// ---------- websiteTeam ----------
// Thin wrap of the existing llm-owner-extractor over whatever domain the gate resolved. The
// resolver only ever passes companyDomain + targetTitles (no separate companyName) for this
// route, so companyDomain doubles as the LLM prompt's "business name" — a reasonable fallback
// label when that's the only identifier available at this stage.
async function websiteTeam(companyDomain) {
  if (!companyDomain) return [];
  try {
    const url = /^https?:\/\//i.test(companyDomain) ? companyDomain : `https://${companyDomain}`;
    const result = await ownerExtractor.extractOwnersFromWebsite(companyDomain, url);
    const owners = (result && Array.isArray(result.owners)) ? result.owners : [];
    return owners
      .filter(o => o && o.name)
      .map(o => ({ name: o.name, title: o.title || null, email: o.email || null, source: 'websiteTeam' }));
  } catch {
    return [];
  }
}

// ---------- jdReportingLine ----------
// v1: hiring-signal-source's searchJobs does not return the job description / poster, so
// jobDescription is always null on the SignalRecord (see docs/hiring-signals-architecture.md).
// Kept as an explicit export (not deleted) so the route wires up the moment a JD becomes
// available from an upstream source, with zero changes needed in decision-maker-resolver.js.
async function jdReportingLine(jobDescription) {
  return [];
}

// websiteEmailLookup(signal) -> a website-scraped email for the resolved decision-maker, or null.
// Uses crawl4ai-backed owner extraction (llm-owner-extractor now crawls with crawl4ai first). Matches
// the extracted owner to signal.dmName; falls back to a single clearly-personal owner email. Project
// rule: website-scraped emails are auto-valid (no Reoon spend). Never throws.
const { personMatch } = require('./decision-maker-resolver');
async function websiteEmailLookup(signal) {
  try {
    if (!signal || !signal.companyDomain) return null;
    const url = `https://${signal.companyDomain}`;
    const result = await ownerExtractor.extractOwnersFromWebsite(signal.companyName || signal.companyDomain, url);
    const owners = (result && result.owners) || [];
    // 1. owner whose name matches the resolved decision-maker, with an email
    if (signal.dmName) {
      const hit = owners.find(o => o.email && personMatch(o.name || '', signal.dmName) >= 0.6);
      if (hit && hit.email) return hit.email;
    }
    // 2. else a single owner-with-email (a named person, not a generic inbox)
    const withEmail = owners.filter(o => o.email && /@/.test(o.email));
    if (withEmail.length === 1) return withEmail[0].email;
    return null;
  } catch {
    return null;
  }
}

module.exports = {
  companiesHouse,
  linkedinPeople,
  websiteTeam,
  jdReportingLine,
  websiteEmailLookup,
  CH_NAME_MATCH_MIN,
};
