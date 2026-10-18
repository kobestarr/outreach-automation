'use strict';
/**
 * Role intake for the contracts lane. Three input shapes become one role object:
 *  - the curated roles CSV (score,title,company,posted_by,day_rate_or_pay,url,why_fit): already contract + remote filtered upstream
 *  - the JobSpy spike CSVs (company_url, company_url_direct, job_url_direct, description, job_type, is_remote, agency ...)
 *  - the Recon hirewire export (title, company_name, company_domain, job_url, salary_raw, ch_company_number, remote_hint)
 * Keeps direct employers, remote, contract-ish, not senior. Recruiters go to their own list. One role per company.
 */

const SENIOR = /\b(head|senior|sr|director|chief|vp|vice president|principal|cmo|coo|cto|ceo|general manager|staff|c-level|team leader)\b/i;
const LEAD = /\blead\b(?!\s*(gen\b|generation|nurtur|scor|capture|qual|routing|magnet))/i;
const CONTRACT = /(\bcontract(or)?\b|day[- ]rate|per day|\/ ?day|\bp\/?d\b|ir35|freelance|fixed[- ]term|\bftc\b|interim|fractional|temporary|\b\d{1,2}[- ](month|week)s?\b.{0,12}(contract|engagement|ftc))/i;
const REMOTE = /(fully[- ]remote|100% ?remote|remote[- ]first|\bremote\b|work from home|\bwfh\b|home[- ]based)/i;
const HYBRID = /(hybrid|\d ?(-\d)? ?days? (a|per|each) ?week (in|at|on)[- ]?(the )?(office|site)|office[- ]based|on[- ]site|onsite)/i;
const AGENCY_NAME = /(recruit|resourc(ing|es)|talent|staffing|personnel|headhunt|executive search|\bhays\b|robert half|randstad|adecco|michael page|page group|harvey nash|experis|computer futures|hamilton barnes|lorien|sthree|parser|pontoon|manpower|morgan (hunt|mckinley)|harnham|robert walters|walters people|jobgether|frazer jones|major players|brook street|gattaca|fruition|digital gurus|sanderson|monroe consulting|venn group|opus recruitment|tenth revolution|\bcpl\b|matchtech|kelly services|capita|career moves|\blhh\b|aquent|hyqoo|gazelle global|cygnus professionals|alignerr|afterquery)/i;
const AGENCY_TEXT = /(on behalf of (our|a|my) client|our client\b|my client\b|recruitment (agency|consultancy|business)|employment (agency|business)|talent partner|your consultant|an employer is seeking|i(?:'|’)m working with|about the client|apply via [a-z]+ today|\bour client is\b|this role is being advertised by)/i;

const truthy = (v) => /^(true|1|yes|y)$/i.test(String(v == null ? '' : v).trim());
const s = (v) => (v == null ? '' : String(v).trim());

function normaliseCompany(name) {
  return s(name).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(ltd|limited|plc|inc|llc|llp|uk|group|the|co|company|b corp|bcorp)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function detectShape(row) {
  if ('posted_by' in row && 'why_fit' in row) return 'curated';
  if ('company_name' in row && ('job_url' in row) && !('company' in row)) return 'recon';
  return 'jobspy';
}

/** Any row shape -> one role object. Unknown evidence stays null so the filter can tell "no" from "not stated". */
function normaliseRow(row) {
  const shape = detectShape(row);
  const company = s(row.company || row.company_name);
  const text = `${s(row.title)} ${s(row.description)} ${s(row.location)} ${s(row.location_note)}`;
  const role = {
    shape, source: s(row.source || row.site) || shape,
    title: s(row.title), company, description: s(row.description),
    location: s(row.location || row.location_note),
    job_url: s(row.url || row.job_url_direct || row.job_url),
    job_url_direct: s(row.job_url_direct),
    company_urls: [s(row.company_url_direct), s(row.company_url)].filter(Boolean),
    domain_override: s(row.domain_override),
    domain_hint: s(row.company_domain), // Recon's is a name-slug guess: verified later, never trusted
    ch_company_number: s(row.ch_company_number),
    employees: s(row.company_num_employees),
    pay: s(row.day_rate_or_pay || row.salary_raw) || (row.min_amount ? `${s(row.currency)}${s(row.min_amount)}${row.max_amount ? '-' + s(row.max_amount) : ''}` : ''),
    why_fit: s(row.why_fit),
    score: s(row.score) === '' ? null : Number(row.score),
    posted_by: s(row.posted_by),
    recruiter_email: s(row.recruiter_email),
    job_type: s(row.job_type || row.contract_type),
    recon_remote_hint: 'remote_hint' in row ? truthy(row.remote_hint) : null,
    report_hint: s(row.rep),
    raw_flags: { agency: 'agency' in row ? truthy(row.agency) : null, is_recruiter: 'is_recruiter' in row ? truthy(row.is_recruiter) : null, is_remote: 'is_remote' in row ? row.is_remote : null },
    eligibility_note: /UK-contractor eligibility unconfirmed/i.test(s(row.location_note) + ' ' + s(row.location)) ? 'UK-contractor eligibility unconfirmed (non-UK role)' : '',
    text,
  };
  return role;
}

function isAgency(role) {
  if (role.posted_by === 'recruitment_agency') return 'posted_by says recruitment agency';
  if (role.posted_by === 'direct_employer') return '';
  if (role.raw_flags.is_recruiter) return 'flagged recruiter by Recon';
  if (role.raw_flags.agency === true) return 'agency flag set';
  if (AGENCY_NAME.test(role.company)) return 'company name looks like an agency';
  if (AGENCY_TEXT.test(role.description)) return 'ad text reads like an agency advert';
  return '';
}

function isSenior(title) {
  return SENIOR.test(title) || LEAD.test(title);
}

function isContract(role) {
  if (role.shape === 'curated') return true; // upstream classifier already enforced it
  return /contract|temporary|freelance|fixed/i.test(role.job_type) || CONTRACT.test(role.text);
}

function isRemote(role) {
  if (role.shape === 'curated') return true;
  const hybrid = HYBRID.test(role.description) && !/no (need|requirement) to|occasional/i.test(role.description);
  if (hybrid && !/fully[- ]remote|100% ?remote/i.test(role.text)) return false;
  if (role.raw_flags.is_remote != null && truthy(role.raw_flags.is_remote)) return true;
  if (role.recon_remote_hint === true) return true;
  return REMOTE.test(role.text);
}

/**
 * rows -> { keep, recruiters, dropped }.  keep is one role per company (best score, then earliest row).
 */
function filterRoles(rows, { minScore = 5 } = {}) {
  const keep = [], recruiters = [], dropped = [];
  for (const row of rows) {
    const role = normaliseRow(row);
    const drop = (reason) => dropped.push({ role, reason });
    if (!role.title || !role.company) { drop('missing title or company'); continue; }
    const ag = isAgency(role);
    if (ag) { recruiters.push({ role, reason: ag }); continue; }
    if (isSenior(role.title)) { drop('senior title'); continue; }
    if (!isContract(role)) { drop('not a contract role'); continue; }
    if (!isRemote(role)) { drop('not remote'); continue; }
    if (role.score != null && Number.isFinite(role.score) && role.score < minScore) { drop(`score ${role.score} below ${minScore}`); continue; }
    keep.push(role);
  }
  const best = new Map();
  for (const role of keep) {
    const k = normaliseCompany(role.company);
    const cur = best.get(k);
    if (!cur) { best.set(k, role); continue; }
    if ((role.score || 0) > (cur.score || 0)) { dropped.push({ role: cur, reason: 'duplicate company' }); best.set(k, role); }
    else dropped.push({ role, reason: 'duplicate company' });
  }
  return { keep: [...best.values()], recruiters, dropped };
}

module.exports = { filterRoles, normaliseRow, normaliseCompany, isSenior, isAgency, detectShape };
