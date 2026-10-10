/**
 * Company size gate: drop UK micro-entities (and dormant / dead companies) via Companies House.
 *
 * Why micro-entity: a company may only file micro-entity accounts if it meets 2 of
 * turnover <= £1m, balance sheet <= £500k, <= 10 employees (thresholds from 6 April 2025,
 * gov.uk "Life of a company: accounts", checked 2026-10-10). UK small companies do not publish
 * turnover until 2028, so the accounts type is the free proxy for "under £1m".
 * Known blind spot: a £1m+ firm with a small balance sheet and <= 10 staff can still file
 * micro accounts and gets dropped. Accepted trade-off (Kobi, 2026-10-10).
 *
 * Safety rule: only a CONFIDENT match can drop a lead. No match, ambiguous match, or an API
 * error always keeps the lead. Field: accounts.last_accounts.type (api-enumerations account_type).
 */
const https = require('https');

const DROP_TYPES = { 'micro-entity': 'micro', dormant: 'dormant' };
const LARGER_TYPES = new Set(['full', 'medium', 'group', 'audited-abridged', 'audit-exemption-subsidiary', 'filing-exemption-subsidiary']);
const DEAD_STATUSES = new Set(['dissolved', 'liquidation', 'administration', 'receivership', 'converted-closed', 'insolvency-proceedings', 'closed']);

function classifyProfile(profile) {
  if (!profile) return { size: 'unknown', drop: false, reason: null };
  const status = profile.company_status || '';
  if (DEAD_STATUSES.has(status)) return { size: 'dead', drop: true, reason: 'status-' + status };
  const type = profile.accounts && profile.accounts.last_accounts && profile.accounts.last_accounts.type;
  if (!type || type === 'null' || type === 'no-accounts-type-available' || type === 'initial') {
    return { size: 'no-accounts', drop: false, reason: null };
  }
  if (DROP_TYPES[type]) return { size: DROP_TYPES[type], drop: true, reason: type };
  if (LARGER_TYPES.has(type)) return { size: 'larger', drop: false, reason: null, accountsType: type };
  return { size: 'small', drop: false, reason: null, accountsType: type };
}

const SUFFIXES = /\b(limited|ltd|plc|llp|lp|cic|company limited by guarantee|uk|group holdings|holdings)\b/g;

function normaliseName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/^\s*the\s+/, ' ')
    .replace(SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// One active company whose normalised name equals the target, or null. Never "first result".
function pickMatch(items, name) {
  const target = normaliseName(name);
  if (!target) return null;
  const hits = (items || []).filter(i => i.company_status === 'active' && normaliseName(i.title) === target);
  return hits.length === 1 ? hits[0] : null;
}

function padNumber(n) {
  const s = String(n || '').trim().toUpperCase();
  return /^\d+$/.test(s) ? s.padStart(8, '0') : s;
}

async function checkCompany({ name, companyNumber }, { fetchJson = chFetchJson, cache = null } = {}) {
  const key = companyNumber ? 'n:' + padNumber(companyNumber) : 'q:' + normaliseName(name);
  if (cache && cache[key]) return cache[key];
  let result;
  try {
    let number = companyNumber ? padNumber(companyNumber) : null;
    let matchedName = null;
    if (!number) {
      const search = await fetchJson(`/search/companies?q=${encodeURIComponent(name)}&items_per_page=20`);
      const m = pickMatch(search && search.items, name);
      if (!m) {
        result = { size: 'unmatched', drop: false, reason: null };
        if (cache) cache[key] = result;
        return result;
      }
      number = m.company_number;
      matchedName = m.title;
    }
    const profile = await fetchJson(`/company/${number}`);
    result = { ...classifyProfile(profile), companyNumber: number, matchedName: matchedName || (profile && profile.company_name) || null };
  } catch (e) {
    return { size: 'error', drop: false, reason: null, error: e.message };
  }
  if (cache) cache[key] = result;
  return result;
}

const UK = /^(uk|gb|united kingdom|great britain|england|scotland|wales|northern ireland)$/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Gate a batch. Only UK rows hit Companies House; everything else passes through as 'not-uk'.
// pauseMs keeps us well under the Companies House limit (600 requests per 5 minutes, up to 2 per lead).
async function gateLeads(leads, { check = checkCompany, cache = null, pauseMs = 1100, nameKey = 'name', countryKey = 'country', assumeUk = false } = {}) {
  const kept = [], dropped = [];
  for (const lead of leads) {
    if (!assumeUk && !UK.test(String(lead[countryKey] || '').trim())) { kept.push({ ...lead, chSize: 'not-uk', chReason: '' }); continue; }
    const r = await check({ name: lead[nameKey], companyNumber: lead.companyNumber }, { cache });
    const out = { ...lead, chSize: r.size, chReason: r.reason || '', chNumber: r.companyNumber || '' };
    (r.drop ? dropped : kept).push(out);
    if (pauseMs) await sleep(pauseMs);
  }
  return { kept, dropped };
}

function chFetchJson(path) {
  const { getCredential } = require('../credentials-loader');
  const apiKey = getCredential('companiesHouse', 'apiKey');
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.company-information.service.gov.uk', path, method: 'GET',
      headers: { Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64'), Accept: 'application/json' },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode >= 400) return reject(new Error(`Companies House ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Companies House bad JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Companies House timeout')); });
    req.end();
  });
}

module.exports = { classifyProfile, normaliseName, pickMatch, checkCompany, gateLeads, chFetchJson };
