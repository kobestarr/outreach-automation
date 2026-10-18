'use strict';
/**
 * Contracts lane orchestration. Everything external is injected so tests run offline:
 *   deps.fetchHtml(url), deps.search(query), deps.ch { searchCompany, lookupOwner },
 *   deps.openFinder() -> { findMany(rows), close() }   (never called in a dry run)
 */
const fs = require('fs');
const path = require('path');
const { filterRoles } = require('./role-filter');
const { resolveDomain } = require('./company-domain');
const { findHiringManager } = require('./hiring-manager');

const SEND_COLUMNS = ['first_name', 'last_name', 'email', 'company_name', 'role_title', 'role_url', 'hiring_manager_title', 'hm_source', 'hm_confidence', 'email_status', 'day_rate_or_pay', 'why_fit', 'eligibility_note'];
const HELD_COLUMNS = ['company_name', 'role_title', 'role_url', 'reason', 'first_name', 'last_name', 'hiring_manager_title', 'hm_source', 'hm_confidence', 'domain', 'email_status', 'suggested_email', 'held_email', 'day_rate_or_pay'];
const MAX_CREDITS_CEILING = 150;
const CH_SMALL_FIRM_MAX_OTHER_DIRECTORS = 5;
const HIGH_CONFIDENCE_FINDS = new Set(['catch_all_found', 'icypeas_found']);

/** do-not-contact.txt (email<TAB>reason, # comments, or a bare domain) and sent-ledger.txt (one email per line). */
function loadExclusions(dataDir, { read = (f) => fs.readFileSync(f, 'utf8'), exists = fs.existsSync } = {}) {
  const emails = new Set(), domains = new Set();
  const take = (file, dncStyle) => {
    const f = path.join(dataDir, file);
    if (!exists(f)) return;
    for (const line of read(f).split(/\r?\n/)) {
      const v = line.split('\t')[0].trim().toLowerCase();
      if (!v || v.startsWith('#')) continue;
      if (v.includes('@')) emails.add(v);
      else if (dncStyle && v.includes('.')) domains.add(v.replace(/^www\./, ''));
    }
  };
  take('do-not-contact.txt', true);
  take('sent-ledger.txt', false);
  return { emails, domains };
}

const excluded = (ex, email, domain) => {
  const e = String(email || '').toLowerCase();
  const d = (e.split('@')[1] || String(domain || '')).toLowerCase();
  return ex.emails.has(e) || (d && ex.domains.has(d));
};

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

function whyFit(role) {
  if (role.why_fit) return role.why_fit;
  const skills = ['marketing automation', 'ai automation', 'hubspot', 'gohighlevel', 'zapier', 'n8n', 'make', 'ppc', 'paid media', 'seo', 'crm', 'podcast', 'content', 'growth', 'email']
    .filter((k) => new RegExp('\\b' + k.replace(/ /g, '\\s+') + '\\b', 'i').test(role.text)).slice(0, 4);
  return skills.length ? `Skills in ad: ${skills.join(', ')}` : 'Contract role in Kobi\'s lane';
}

async function run({ rows, deps, dataDir, dryRun = false, maxCredits = MAX_CREDITS_CEILING, minScore = 5, concurrency = 3, log = () => {}, descriptions = null }) {
  const cap = Math.min(Math.max(0, Math.floor(maxCredits)), MAX_CREDITS_CEILING);
  const ex = loadExclusions(dataDir, deps.fsFns);
  if (descriptions) for (const r of rows) if (!r.description) { const d = descriptions(r); if (d) r.description = d; }
  const { keep, recruiters, dropped } = filterRoles(rows, { minScore });
  const held = [], candidates = [];

  await mapLimit(keep, concurrency, async (role) => {
    const dom = await resolveDomain(role, { fetchHtml: deps.fetchHtml, search: deps.search }).catch(() => ({ domain: '', reason: 'domain lookup failed' }));
    if (!dom.domain) { held.push({ role, reason: `no company domain: ${dom.reason}` }); return; }
    if (excluded(ex, '', dom.domain)) { held.push({ role, domain: dom.domain, reason: 'domain in do-not-contact' }); return; }
    const hm = await findHiringManager(role, dom.domain, { fetchHtml: deps.fetchHtml, ch: deps.ch }).catch(() => null);
    if (!hm) { held.push({ role, domain: dom.domain, reason: 'no hiring manager found' }); return; }
    if (!hm.first || !hm.last) { held.push({ role, domain: dom.domain, hm, reason: 'manager name incomplete' }); return; }
    if (hm.source === 'companies_house' && (hm.other_directors || 0) > CH_SMALL_FIRM_MAX_OTHER_DIRECTORS) {
      held.push({ role, domain: dom.domain, hm, reason: 'Companies House director of a larger company, not a hiring manager' }); return;
    }
    candidates.push({ role, domain: dom.domain, domain_source: dom.source, hm });
    log(`${role.company}: ${hm.name} (${hm.source}/${hm.confidence}) @ ${dom.domain}`);
  });

  const plan = {
    roles_in: rows.length, direct_employers: keep.length, recruiters: recruiters.length, dropped: dropped.length,
    with_manager: candidates.length, held_before_email: held.length, email_lookups: candidates.length, max_credits: cap,
  };
  const send = [];
  let finderSummary = null;

  if (!dryRun && candidates.length) {
    const finder = await deps.openFinder({ maxCredits: cap });
    try {
      const frows = candidates.map((c) => ({ first_name: c.hm.first, last_name: c.hm.last, website: c.domain, company_name: c.role.company }));
      const { results, summary } = await finder.findMany(frows);
      finderSummary = summary;
      candidates.forEach((c, i) => {
        const r = results[i] || {};
        const base = { role: c.role, domain: c.domain, hm: c.hm, email_status: r.status, suggested_email: r.suggested_email || '' };
        const sendable = r.email && (r.status === 'found' || r.status === 'found_flagged' || (HIGH_CONFIDENCE_FINDS.has(r.status) && r.confidence === 'high'));
        if (sendable) {
          if (excluded(ex, r.email, c.domain)) { held.push({ ...base, reason: 'email already contacted or in do-not-contact' }); return; }
          send.push({ ...base, email: r.email });
        } else if (r.status === 'found_generic') held.push({ ...base, held_email: r.email, reason: 'generic inbox only, we do not send hiring-manager notes to info@' });
        else held.push({ ...base, reason: `email not confirmed (${r.status || 'no result'}${r.note ? ': ' + r.note : ''})` });
      });
    } finally { if (finder.close) finder.close(); }
  }
  plan.send = send.length;
  plan.held = held.length;
  return { send, held, recruiters, dropped, candidates, plan, finderSummary, dryRun };
}

const csvCell = (v) => { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const toCsv = (cols, rows) => [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';

function sendRow(x) {
  return { first_name: x.hm.first, last_name: x.hm.last, email: x.email, company_name: x.role.company, role_title: x.role.title, role_url: x.role.job_url,
    hiring_manager_title: x.hm.title, hm_source: x.hm.source, hm_confidence: x.hm.confidence, email_status: x.email_status, day_rate_or_pay: x.role.pay, why_fit: whyFit(x.role), eligibility_note: x.role.eligibility_note };
}
function heldRow(x) {
  return { company_name: x.role.company, role_title: x.role.title, role_url: x.role.job_url, reason: x.reason, first_name: x.hm ? x.hm.first : '', last_name: x.hm ? x.hm.last : '',
    hiring_manager_title: x.hm ? x.hm.title : '', hm_source: x.hm ? x.hm.source : '', hm_confidence: x.hm ? x.hm.confidence : '', domain: x.domain || '',
    email_status: x.email_status || '', suggested_email: x.suggested_email || '', held_email: x.held_email || '', day_rate_or_pay: x.role.pay };
}
function recruiterRow(x) {
  return { company_name: x.role.company, role_title: x.role.title, role_url: x.role.job_url, reason: x.reason, first_name: '', last_name: '', hiring_manager_title: '', hm_source: '', hm_confidence: '', domain: '', email_status: '', suggested_email: '', held_email: x.role.recruiter_email, day_rate_or_pay: x.role.pay };
}

module.exports = { run, loadExclusions, toCsv, sendRow, heldRow, recruiterRow, whyFit, SEND_COLUMNS, HELD_COLUMNS, MAX_CREDITS_CEILING };
