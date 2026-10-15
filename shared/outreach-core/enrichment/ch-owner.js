/**
 * Owner name from Companies House: the longest-serving ACTIVE human director (or LLP member).
 *
 * Replaces getAllOwnersByRegistrationNumber for outreach greetings, which had two bugs that would show in
 * front of a prospect: it kept resigned directors (role === director OR not resigned), and it parsed
 * Companies House "SURNAME, Forenames" as "First Last", so it would have written "Hi WOOD,".
 */
const https = require('https');

const HUMAN_ROLES = new Set(['director', 'llp-member', 'llp-designated-member', 'member']);
const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'professor', 'sir', 'dame', 'lord', 'lady', 'rev', 'reverend', 'capt', 'captain']);

function titleCase(word) {
  return word.toLowerCase().split(/([-'])/).map(part => {
    if (part === '-' || part === "'") return part;
    if (!part) return part;
    if (/^mc[a-z]/.test(part)) return 'Mc' + part[2].toUpperCase() + part.slice(3);
    return part[0].toUpperCase() + part.slice(1);
  }).join('');
}

function parseChName(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let surname, forenames;
  if (raw.includes(',')) {
    [surname, forenames] = raw.split(/,(.*)/s).map(s => (s || '').trim());
  } else {
    const parts = raw.trim().split(/\s+/);
    forenames = parts.slice(0, -1).join(' ');
    surname = parts.slice(-1)[0];
  }
  const fore = (forenames || '').split(/\s+/).filter(w => w && !HONORIFICS.has(w.toLowerCase().replace(/\.$/, '')));
  if (!fore.length || !surname) return null;
  const first = titleCase(fore[0]);
  const last = surname.split(/\s+/).map(titleCase).join(' ');
  return { first, last, full: `${first} ${last}` };
}

function pickOwner(officers) {
  const active = (officers || []).filter(o => !o.resigned_on && HUMAN_ROLES.has(o.officer_role));
  if (!active.length) return null;
  active.sort((a, b) => String(a.appointed_on || '9999').localeCompare(String(b.appointed_on || '9999')));
  for (const o of active) {
    const n = parseChName(o.name);
    if (n) return { ...n, role: o.officer_role, appointed_on: o.appointed_on || '', other_directors: active.length - 1 };
  }
  return null;
}

const pad = n => { const s = String(n || '').trim().toUpperCase(); return /^\d+$/.test(s) ? s.padStart(8, '0') : s; };

async function lookupOwner(companyNumber, { fetchJson = chFetchJson } = {}) {
  try {
    const res = await fetchJson(`/company/${pad(companyNumber)}/officers?register_view=false&items_per_page=100`);
    return pickOwner(res && res.items) || { none: true };
  } catch (e) {
    return { error: e.message };
  }
}

function chFetchJson(path) {
  const creds = require(process.env.HOME + '/.credentials/api-keys.json').companiesHouse;
  const apiKey = typeof creds === 'string' ? creds : creds.apiKey;
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.company-information.service.gov.uk', path, method: 'GET',
      headers: { Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64'), Accept: 'application/json' } }, res => {
      let d = ''; res.on('data', c => { d += c; });
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode === 429) return reject(new Error('rate-limited'));
        if (res.statusCode >= 400) return reject(new Error('http ' + res.statusCode));
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('bad json')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

module.exports = { parseChName, pickOwner, lookupOwner, chFetchJson };
