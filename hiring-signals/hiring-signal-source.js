// hiring-signals/hiring-signal-source.js
//
// Stage 1 of the Signal Engine (docs/hiring-signals-architecture.md): fires linkedapi.io
// job searches per brand, normalises each hit into a SignalRecord (source fields only),
// and dedups (exact jobId within-run + a 21-day company-level cooldown ledger).
//
// io-injected so tests never touch the network:
//   io.runSearch(term, filter) -> raw job array   (REQUIRED for hermetic tests; if absent,
//                                                   searchJobs() does the real fetch+poll)
//   io.fetch                   -> fetch impl for the live path (defaults to global fetch)
//   io.ledgerFile               -> path to the seen-company ledger (defaults to data/hiring-signals-seen.txt)
//   io.now()                    -> current Date (defaults to `new Date()`)
//   io.log                      -> logger (defaults to console.log)
//
// Contract notes (see report for the full list):
//  - linkedapi.io's exact raw-job field names aren't pinned down in the architecture doc, so
//    toSignalRecord() reads a handful of plausible aliases per field (jobId/id, title/roleTitle,
//    companyName/company, etc). If the live shape differs, only this function needs updating.
//  - Fields owned by later stages (gate/resolver/enrich/digest) are seeded with the null/'unknown'
//    defaults documented in the SignalRecord contract, not left undefined.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { normName } = require('../shared/outreach-core/enrichment/decision-maker-resolver');

const LEDGER_FILE = path.join(__dirname, '..', 'data', 'hiring-signals-seen.txt');
const COOLDOWN_DAYS = 21;
const POLL_INTERVAL_MS = 15 * 1000;
const POLL_CAP_MS = 10 * 60 * 1000;

const BASE_FILTER = { location: 'United Kingdom', datePosted: 'pastWeek', experienceLevels: ['associate', 'mid'] };

// Per-brand search config (docs/hiring-signals-architecture.md "Per-brand search config").
const BRAND_CONFIG = {
  kobestarr: ['SEO manager', 'digital marketing manager', 'growth manager', 'head of marketing'],
  stripped: ['podcast producer', 'audio producer', 'content producer'],
  dealflow: ['content marketing manager', 'content manager'],
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- title cleanup ----------
// LinkedIn titles sometimes carry a second line (badges/annotations) and a trailing
// " with verification" suffix (Verified Hiring / Open to Work badges). Keep only the role.
function cleanTitle(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const firstLine = raw.split('\n')[0].trim();
  return firstLine.replace(/\s+with verification\s*$/i, '').trim();
}

// ---------- raw job -> SignalRecord (source fields only) ----------
function toSignalRecord(raw, brand, term) {
  raw = raw || {};
  return {
    // -- from source --
    jobId: raw.jobId || raw.id || raw.job_id || null,
    jobUrl: raw.jobUrl || raw.url || raw.job_url || null,
    brand,
    term,
    roleTitle: cleanTitle(raw.title || raw.roleTitle || raw.jobTitle),
    companyName: raw.companyName || raw.company || raw.company_name || '',
    location: raw.location || null,
    workplaceType: raw.workplaceType || raw.workplace_type || raw.workplace || null,
    salary: raw.salary || null,
    easyApply: !!(raw.easyApply || raw.easy_apply),
    isPromoted: !!(raw.isPromoted || raw.promoted || raw.is_promoted),
    jobDescription: null,
    posterEmail: null,
    posterName: null,
    // -- added by gate (seeded null/'unknown' until stage 2 runs) --
    companyDomain: null,
    companyOneLiner: null,
    businessType: 'unknown',
    sizeBand: 'unknown',
    estimatedHeadcount: null,
    isRealEmployer: null,
    lane: null,
    dropReason: null,
    gateConfidence: null,
    // -- added by resolver --
    dmName: null,
    dmTitle: null,
    dmLinkedIn: null,
    dmConfidence: 0,
    dmSources: [],
    segment: null,
    // -- added by enrich --
    email: null,
    reoonStatus: null,
    emailSource: null,
    contactConfidence: 0,
    linkedinResolved: false,
    // -- added by digest --
    verdict: null,
    why: null,
  };
}

// ---------- linkedapi.io search (async workflow: submit -> poll) ----------
function loadLiveCreds() {
  const creds = require(path.join(os.homedir(), '.credentials/api-keys.json'));
  const c = creds.linkedapi_io;
  if (!c || !c.apiKey || !c.identificationToken) {
    throw new Error('linkedapi_io credentials missing apiKey/identificationToken in ~/.credentials/api-keys.json');
  }
  return c;
}

// searchJobs(term, filter, io) -> raw job array.
// Hermetic tests inject io.runSearch(term, filter) to bypass the network entirely.
async function searchJobs(term, filter, io = {}) {
  if (typeof io.runSearch === 'function') {
    return (await io.runSearch(term, filter)) || [];
  }

  const fetchFn = io.fetch || fetch;
  const { apiKey, identificationToken } = io.creds || loadLiveCreds();
  const headers = {
    'Content-Type': 'application/json',
    'linked-api-token': apiKey,
    'identification-token': identificationToken,
  };

  const submitRes = await fetchFn('https://api.linkedapi.io/workflows', {
    method: 'POST',
    headers,
    body: JSON.stringify({ actionType: 'st.searchJobs', term, limit: filter.limit || 25, filter }),
  });
  const submitJson = await submitRes.json();
  const workflowId = submitJson && submitJson.result && submitJson.result.workflowId;
  if (!workflowId) throw new Error(`searchJobs: no workflowId returned for term "${term}"`);

  const start = Date.now();
  while (Date.now() - start < POLL_CAP_MS) {
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await fetchFn(`https://api.linkedapi.io/workflows/${workflowId}`, { headers });
    const pollJson = await pollRes.json();
    const status = pollJson && pollJson.result && pollJson.result.workflowStatus;
    if (status === 'completed') return (pollJson.result.completion && pollJson.result.completion.data) || [];
    if (status === 'failed' || status === 'error') {
      throw new Error(`searchJobs: workflow ${workflowId} failed for term "${term}"`);
    }
  }
  throw new Error(`searchJobs: workflow ${workflowId} did not complete within 10min for term "${term}"`);
}

// ---------- ledger: company-level 21-day cooldown ----------
// Line format: jobId|normName(companyName)|ISOdate  (append-only, read once at start)
function readSeenLedger(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const [jobId, company, dateStr] = line.split('|');
      const date = new Date(dateStr);
      return { jobId, company, date: isNaN(date.getTime()) ? null : date };
    })
    .filter(e => e.date !== null);
}

function appendSeenLedger(file, entries) {
  if (!entries.length) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = entries.map(e => `${e.jobId}|${e.company}|${e.date.toISOString()}`);
  fs.appendFileSync(file, lines.join('\n') + '\n');
}

function isCompanyOnCooldown(companyKey, seenEntries, now) {
  if (!companyKey) return false;
  const cutoff = now.getTime() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  return seenEntries.some(e => e.company === companyKey && e.date.getTime() >= cutoff);
}

// ---------- sourceAll: run every brand's terms, merge, dedup, return SignalRecord[] ----------
async function sourceAll(io = {}) {
  const now = typeof io.now === 'function' ? io.now() : new Date();
  const log = io.log || console.log;
  const ledgerFile = io.ledgerFile || LEDGER_FILE;
  const seenEntries = readSeenLedger(ledgerFile);

  const results = [];
  const seenJobIds = new Set();
  const newLedgerEntries = [];
  let cooldownSuppressed = 0;

  for (const [brand, terms] of Object.entries(BRAND_CONFIG)) {
    for (const term of terms) {
      let raw;
      try {
        raw = await searchJobs(term, BASE_FILTER, io);
      } catch (e) {
        log(`[hiring-signal-source] searchJobs failed for ${brand}/"${term}": ${e.message}`);
        continue;
      }
      for (const rawJob of raw || []) {
        const record = toSignalRecord(rawJob, brand, term);
        if (!record.jobId) continue; // can't dedup or ledger a jobless record, drop at source
        if (seenJobIds.has(record.jobId)) continue; // exact in-run dedup

        const companyKey = normName(record.companyName);
        if (isCompanyOnCooldown(companyKey, seenEntries, now)) {
          cooldownSuppressed++;
          continue;
        }

        seenJobIds.add(record.jobId);
        results.push(record);
        newLedgerEntries.push({ jobId: record.jobId, company: companyKey, date: now });
      }
    }
  }

  appendSeenLedger(ledgerFile, newLedgerEntries);
  log(`[hiring-signal-source] sourced ${results.length} signal(s), suppressed ${cooldownSuppressed} on company cooldown.`);
  return results;
}

module.exports = {
  BRAND_CONFIG,
  BASE_FILTER,
  cleanTitle,
  toSignalRecord,
  searchJobs,
  sourceAll,
  readSeenLedger,
  appendSeenLedger,
  isCompanyOnCooldown,
  COOLDOWN_DAYS,
  LEDGER_FILE,
};

// ---- CLI (live run: fires every brand's terms for real, writes SignalRecord[] JSON) ----
if (require.main === module) {
  (async () => {
    const outFile = process.argv[2] || null;
    const records = await sourceAll({ log: console.log });
    const json = JSON.stringify(records, null, 2);
    if (outFile) {
      fs.writeFileSync(outFile, json);
      console.log(`Wrote ${records.length} record(s) to ${outFile}`);
    } else {
      console.log(json);
    }
  })().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
}
