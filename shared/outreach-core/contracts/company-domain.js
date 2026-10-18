'use strict';
/**
 * Resolve an employer's OWN website domain. Never a job board or ATS.
 * Order: domains the ad itself gives (company URL fields, apply URL on a company careers host, description links)
 * trusted as-is; then candidates that must be VERIFIED by fetching the homepage and finding the company name in
 * the page title / site name: Recon's slug guess, the name-slug guess (.com .co.uk .io ...), then an injected search.
 */

const BLOCKED_SUFFIXES = [
  'linkedin.com', 'indeed.com', 'indeed.co.uk', 'glassdoor.com', 'glassdoor.co.uk', 'reed.co.uk', 'totaljobs.com', 'cv-library.co.uk',
  'monster.com', 'monster.co.uk', 'ziprecruiter.com', 'jooble.org', 'adzuna.co.uk', 'jobsite.co.uk', 'cwjobs.co.uk', 'jobgether.com',
  'greenhouse.io', 'lever.co', 'workable.com', 'ashbyhq.com', 'smartrecruiters.com', 'myworkdayjobs.com', 'workday.com', 'icims.com',
  'bamboohr.com', 'recruitee.com', 'teamtailor.com', 'personio.de', 'personio.com', 'jobvite.com', 'taleo.net', 'oraclecloud.com',
  'successfactors.com', 'successfactors.eu', 'breezy.hr', 'join.com', 'pinpointhq.com', 'hirehive.com', 'applytojob.com', 'jazz.co',
  'jazzhr.com', 'dover.com', 'wellfound.com', 'angel.co', 'welcometothejungle.com', 'otta.com', 'workatastartup.com', 'ycombinator.com',
  'eightfold.ai', 'cornerstoneondemand.com', 'csod.com', 'peoplehr.net', 'hrmdirect.com', 'apply.workable.com', 'gohire.io', 'tal.net',
  'trac.jobs', 'jobs.ac.uk', 'civilservicejobs.service.gov.uk', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'youtube.com',
  'google.com', 'bit.ly', 'tinyurl.com', 'notion.site', 'docs.google.com', 'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'yahoo.co.uk',
  'wikipedia.org', 'crunchbase.com', 'zoominfo.com', 'companieshouse.gov.uk', 'find-and-update.company-information.service.gov.uk',
];
const FREE_MAIL = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'live.com', 'aol.com', 'proton.me', 'protonmail.com']);
const TWO_PART_TLDS = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'com.au', 'co.nz', 'co.za', 'com.br']);
const CAREERS_HOST = /^(careers?|jobs?|work|join|apply|recruitment|talent|hiring|vacancies|people)\./i;

function hostOf(u) {
  const raw = String(u || '').trim();
  if (!raw) return '';
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; }
}

function registrable(host) {
  const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  return TWO_PART_TLDS.has(last2) ? parts.slice(-3).join('.') : last2;
}

function isBlocked(domainOrUrl) {
  const host = hostOf(domainOrUrl) || String(domainOrUrl || '').toLowerCase();
  if (!host || !host.includes('.')) return true;
  return BLOCKED_SUFFIXES.some((b) => host === b || host.endsWith('.' + b));
}

function companyTokens(name) {
  const stop = new Set(['ltd', 'limited', 'plc', 'inc', 'llc', 'llp', 'uk', 'group', 'the', 'co', 'company', 'and', 'of', 'b', 'corp', 'bcorp', 'international', 'global', 'holdings']);
  return String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[®™©]/g, '').split(/[^a-z0-9]+/).filter((t) => t && !stop.has(t));
}

function slugCandidates(name) {
  const t = companyTokens(name);
  if (!t.length) return [];
  const joined = t.join('');
  const tlds = ['com', 'co.uk', 'io', 'ai', 'co', 'org', 'net'];
  const bases = [...new Set([joined, t[0].length >= 4 ? t[0] : ''].filter(Boolean))];
  const out = [];
  for (const b of bases) for (const tld of tlds) out.push(`${b}.${tld}`);
  return out;
}

/** Does this homepage HTML belong to the company? Name must be in <title>, og:site_name or a copyright line. */
function pageMatchesCompany(html, name) {
  const tokens = companyTokens(name);
  if (!tokens.length || !html) return false;
  const pick = (re) => (html.match(re) || [])[1] || '';
  const head = [pick(/<title[^>]*>([^<]*)</i), pick(/property=["']og:site_name["'][^>]*content=["']([^"']*)/i), pick(/content=["']([^"']*)["'][^>]*property=["']og:site_name["']/i),
    ...(html.match(/(?:&copy;|©|copyright)[^<]{0,80}/gi) || [])].join(' ').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
  const hay = ' ' + head.replace(/\s+/g, ' ') + ' ';
  const joined = tokens.join('');
  if (hay.replace(/ /g, '').includes(joined)) return true;
  const need = tokens.length === 1 ? tokens : tokens.filter((t) => t.length >= 3);
  return need.length > 0 && need.every((t) => hay.includes(' ' + t) );
}

function adDomains(role) {
  const out = [];
  for (const u of role.company_urls || []) {
    if (isBlocked(u)) continue;
    out.push({ domain: registrable(hostOf(u)), source: 'ad_company_url' });
  }
  for (const u of [role.job_url_direct, role.job_url]) {
    const h = hostOf(u);
    if (h && CAREERS_HOST.test(h) && !isBlocked(h)) out.push({ domain: registrable(h), source: 'ad_apply_url' });
  }
  const desc = String(role.description || '');
  const generic = /^(info|hello|hi|contact|enquiries|careers|jobs|recruitment|hr|talent|admin|support|apply|team)$/i;
  for (const m of desc.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
    const d = registrable(m[1].toLowerCase());
    if (!FREE_MAIL.has(d) && !isBlocked(d)) out.push({ domain: d, source: 'ad_email_domain', weak: true });
  }
  for (const m of desc.matchAll(/https?:\/\/[^\s)"'<>]+/g)) {
    if (!isBlocked(m[0])) out.push({ domain: registrable(hostOf(m[0])), source: 'ad_link', weak: true });
  }
  void generic;
  return out;
}

/**
 * deps: fetchHtml(url) -> html (throws on failure), search(query) -> [url] (optional).
 * Returns { domain, source, verified } or { domain: '', reason }.
 */
async function resolveDomain(role, { fetchHtml, search } = {}) {
  const seen = new Set();
  const verify = async (domain) => {
    if (!fetchHtml || isBlocked(domain)) return false;
    for (const u of ['https://' + domain, 'https://www.' + domain]) {
      try { return pageMatchesCompany(await fetchHtml(u), role.company); } catch (e) { /* try next */ }
    }
    return false;
  };

  const ad = adDomains(role);
  const strong = ad.find((c) => !c.weak);
  if (strong) return { domain: strong.domain, source: strong.source, verified: false };

  const candidates = [];
  for (const c of ad) candidates.push({ ...c });
  if (role.domain_hint && !isBlocked(role.domain_hint)) candidates.push({ domain: registrable(hostOf(role.domain_hint)), source: 'recon_hint' });
  for (const d of slugCandidates(role.company)) candidates.push({ domain: d, source: 'name_guess' });

  for (const c of candidates) {
    if (!c.domain || seen.has(c.domain) || isBlocked(c.domain)) continue;
    seen.add(c.domain);
    if (await verify(c.domain)) return { domain: c.domain, source: c.source, verified: true };
  }
  if (search) {
    let urls = [];
    try { urls = await search(`${role.company} official website`); } catch (e) { urls = []; }
    for (const u of urls || []) {
      const d = registrable(hostOf(u));
      if (!d || seen.has(d) || isBlocked(d)) continue;
      seen.add(d);
      if (await verify(d)) return { domain: d, source: 'search', verified: true };
    }
  }
  return { domain: '', reason: 'no verifiable company website found' };
}

module.exports = { resolveDomain, isBlocked, registrable, hostOf, pageMatchesCompany, slugCandidates, companyTokens, adDomains };
