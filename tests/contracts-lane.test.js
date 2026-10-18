const { test } = require('node:test');
const assert = require('node:assert');
const RF = require('../shared/outreach-core/contracts/role-filter');
const CD = require('../shared/outreach-core/contracts/company-domain');
const HM = require('../shared/outreach-core/contracts/hiring-manager');
const P = require('../shared/outreach-core/contracts/pipeline');

const curated = (o) => ({ score: '8', title: 'HubSpot Administrator', company: 'Acme Widgets', posted_by: 'direct_employer', recruiter_name: '', recruiter_email: '', day_rate_or_pay: '£400/day', ir35: '', location_note: 'UK | fully remote stated', date_posted: '2026-10-15', source: 'linkedin', url: 'https://www.linkedin.com/jobs/view/1', why_fit: 'fit', ...o });

// ---------- role filter ----------
test('agency rows are routed to the recruiter list, not kept', () => {
  const r = RF.filterRoles([curated({}), curated({ company: 'Yoru Marketing', posted_by: 'recruitment_agency' }), curated({ company: 'Hays', posted_by: '' })]);
  assert.deepStrictEqual(r.keep.map((x) => x.company), ['Acme Widgets']);
  assert.strictEqual(r.recruiters.length, 2);
});
test('senior titles and low scores are dropped, score 5 kept and non-UK flagged', () => {
  const r = RF.filterRoles([
    curated({ title: 'Head of Growth', company: 'A' }), curated({ title: 'Lead Marketing Manager', company: 'B' }),
    curated({ title: 'Lead Generation Specialist', company: 'C' }), curated({ score: '4', company: 'D' }),
    curated({ score: '5', company: 'E', location_note: 'Romania | fully remote stated | NON-UK location, UK-contractor eligibility unconfirmed (Europe search)' }),
  ]);
  assert.deepStrictEqual(r.keep.map((x) => x.company).sort(), ['C', 'E']);
  assert.match(r.keep.find((x) => x.company === 'E').eligibility_note, /unconfirmed/);
});
test('dedupes by company keeping the best score', () => {
  const r = RF.filterRoles([curated({ score: '6', title: 'X Specialist' }), curated({ score: '9', title: 'Y Specialist', company: 'ACME Widgets Ltd' })]);
  assert.strictEqual(r.keep.length, 1);
  assert.strictEqual(r.keep[0].title, 'Y Specialist');
});
test('jobspy rows must show contract and remote evidence', () => {
  const base = { title: 'PPC Specialist', company: 'Zed', job_type: 'contract', is_remote: 'True', description: 'Great role', agency: 'False' };
  const r = RF.filterRoles([base, { ...base, company: 'Perm', job_type: 'fulltime' }, { ...base, company: 'Hyb', description: 'Hybrid, 3 days a week in the office' }, { ...base, company: 'Ag', agency: 'True' }]);
  assert.deepStrictEqual(r.keep.map((x) => x.company), ['Zed']);
  assert.strictEqual(r.recruiters.length, 1);
});

// ---------- company domain ----------
test('job board and ATS domains are rejected', () => {
  for (const d of ['linkedin.com', 'uk.linkedin.com', 'boards.greenhouse.io', 'jobs.lever.co', 'apply.workable.com', 'x.myworkdayjobs.com', 'jobs.ashbyhq.com', 'uk.indeed.com']) assert.ok(CD.isBlocked(d), d);
  assert.ok(!CD.isBlocked('acme.co.uk'));
});
test('ad company URL wins but a LinkedIn company URL is ignored; ATS apply URL ignored; careers host maps to the company', async () => {
  const a = await CD.resolveDomain({ company: 'Acme', company_urls: ['https://uk.linkedin.com/company/acme', 'https://www.acme.co.uk/about'] });
  assert.deepStrictEqual([a.domain, a.source], ['acme.co.uk', 'ad_company_url']);
  const b = await CD.resolveDomain({ company: 'Cazoo', company_urls: [], job_url_direct: 'https://careers.cazoo.co.uk/jobs/1' });
  assert.strictEqual(b.domain, 'cazoo.co.uk');
  const c = await CD.resolveDomain({ company: 'Nope', company_urls: [], job_url_direct: 'https://boards.greenhouse.io/nope/jobs/1' });
  assert.strictEqual(c.domain, '');
});
test('guessed domains are verified against the page; a wrong site is refused', async () => {
  const pages = { 'https://swappie.com': '<title>Swappie | Refurbished iPhones</title>', 'https://global.com': '<title>Totally Different Plc</title>' };
  const fetchHtml = async (u) => { if (pages[u]) return pages[u]; throw new Error('404'); };
  const ok = await CD.resolveDomain({ company: 'Swappie', company_urls: [] }, { fetchHtml });
  assert.deepStrictEqual([ok.domain, ok.verified], ['swappie.com', true]);
  const bad = await CD.resolveDomain({ company: 'Global', company_urls: [] }, { fetchHtml });
  assert.strictEqual(bad.domain, '');
});
test('Recon slug guess is verified, not trusted; search is the last resort', async () => {
  const fetchHtml = async (u) => { if (u === 'https://realco.io') return '<title>RealCo - home</title>'; throw new Error('x'); };
  const r = await CD.resolveDomain({ company: 'RealCo', company_urls: [], domain_hint: 'realcoltd.com' }, { fetchHtml, search: async () => ['https://uk.linkedin.com/company/realco', 'https://realco.io/'] });
  assert.deepStrictEqual([r.domain, r.source], ['realco.io', 'name_guess']);
  const s = await CD.resolveDomain({ company: 'Zork Labs', company_urls: [] }, { fetchHtml: async (u) => { if (u === 'https://zorklabs-site.net') return '<title>Zork Labs</title>'; throw new Error('x'); }, search: async () => ['https://zorklabs-site.net/'] });
  assert.deepStrictEqual([s.domain, s.source], ['zorklabs-site.net', 'search']);
});

// ---------- hiring manager ----------
test('manager named in the ad with a title', () => {
  const m = HM.parseAdManager('You will be reporting to Jane Smith, Head of Growth, and work closely with the team.');
  assert.deepStrictEqual([m.name, m.title], ['Jane Smith', 'Head of Growth']);
  assert.strictEqual(HM.parseAdManager('Hiring manager: Tom O\'Neill (VP Marketing)').name, "Tom O'Neill");
});
test('ad that only names a function gives a hint, not a person; stopwords are never names', () => {
  const m = HM.parseAdManager('Reporting to the Marketing Director you will own email.');
  assert.strictEqual(m.name, '');
  assert.match(m.titleHint, /Marketing Director/);
  assert.strictEqual(HM.parseAdManager('Reporting to Head of Growth in London').name, '');
});
const TEAM = `<html><body><h2>Meet the team</h2>
<div><h3>Alex Fox</h3><p>CEO &amp; Founder</p></div>
<div><h3>Priya Nair</h3><p>Head of Marketing</p></div>
<div><h3>Bob Jones</h3><p>Finance Director</p></div>
<div><h3>Chen Wu</h3><p>Marketing Manager (Intern)</p></div></body></html>`;
test('team page: picks the marketing owner for a marketing role, not CEO, finance or juniors', () => {
  const people = HM.extractPeople(TEAM);
  assert.strictEqual(people.length, 3); // the '(Intern)' line is not a clean title
  const pick = HM.pickFromPeople(people, { title: 'PPC Specialist' }, {});
  assert.deepStrictEqual([pick.name, pick.source, pick.confidence], ['Priya Nair', 'team_page', 'medium']);
  const ops = HM.pickFromPeople([{ name: 'Sam Ops', title: 'Head of Operations' }, ...people], { title: 'Automation Engineer' }, {});
  assert.strictEqual(ops.name, 'Sam Ops');
});
test('founder fallback for a small firm with no function owner', () => {
  const people = HM.extractPeople('<div><b>Alex Fox</b><span>Founder and CEO</span></div><div><b>Dee Smith</b><span>Developer</span></div>');
  const pick = HM.pickFromPeople(people, { title: 'SEO Specialist' }, { employees: '1-10' });
  assert.deepStrictEqual([pick.name, pick.source, pick.confidence], ['Alex Fox', 'team_page_founder', 'medium']);
  const big = HM.pickFromPeople(people, { title: 'SEO Specialist' }, { employees: '500' });
  assert.strictEqual(big.confidence, 'low');
});
test('ad hint matching raises team-page confidence to high', () => {
  const people = [{ name: 'Priya Nair', title: 'Head of Growth' }, { name: 'Lee Gray', title: 'Head of Marketing' }];
  const pick = HM.pickFromPeople(people, { title: 'CRM Specialist' }, { adHint: 'Head of Growth' });
  assert.deepStrictEqual([pick.name, pick.confidence], ['Priya Nair', 'high']);
});
test('findHiringManager: ad name first, then team page, then Companies House', async () => {
  const fetchHtml = async (u) => { if (/\/team$/.test(u)) return TEAM; throw new Error('404'); };
  const a = await HM.findHiringManager({ title: 'PPC', description: 'Reports to Sam Lee, Marketing Director.' }, 'x.com', { fetchHtml });
  assert.deepStrictEqual([a.source, a.confidence, a.first, a.last], ['ad', 'high', 'Sam', 'Lee']);
  const b = await HM.findHiringManager({ title: 'PPC', description: '' }, 'x.com', { fetchHtml });
  assert.strictEqual(b.name, 'Priya Nair');
  const ch = { searchCompany: async () => [{ title: 'TINY WIDGETS LTD', company_number: '123', company_status: 'active' }], lookupOwner: async () => ({ full: 'Dave Wood', role: 'director', other_directors: 1 }) };
  const c = await HM.findHiringManager({ title: 'PPC', company: 'Tiny Widgets', description: '' }, 'tiny.co.uk', { fetchHtml: async () => { throw new Error('down'); }, ch });
  assert.deepStrictEqual([c.name, c.source, c.confidence], ['Dave Wood', 'companies_house', 'low']);
  const none = await HM.findHiringManager({ title: 'PPC', company: 'Other', description: '' }, 'o.com', { fetchHtml: async () => { throw new Error('down'); }, ch: { searchCompany: async () => [], lookupOwner: async () => null } });
  assert.strictEqual(none, null);
});

// ---------- pipeline ----------
const fs = require('fs'), os = require('os'), path = require('path');
function dataDir(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-'));
  for (const [k, v] of Object.entries(files || {})) fs.writeFileSync(path.join(d, k), v);
  return d;
}
const mkDeps = (finder) => ({
  fetchHtml: async (u) => { if (/\/team$/.test(u)) return TEAM; if (/^https:\/\/(www\.)?acme\.co\.uk\/?$/.test(u)) return '<title>Acme Widgets</title>'; throw new Error('404'); },
  openFinder: async () => finder,
});
const roles = () => [curated({ company: 'Acme Widgets' })];

test('end to end: found goes to send, found_generic is held, finder rows carry the real manager name', async () => {
  let seen;
  const finder = { findMany: async (rows) => { seen = rows; return { results: [{ email: 'priya@acme.co.uk', status: 'found', confidence: 'high' }], summary: { reoon_used: 1 } }; }, close() {} };
  const rows = [{ ...curated({ company: 'Acme Widgets' }), company_url_direct: 'https://acme.co.uk' }];
  const r = await P.run({ rows, deps: mkDeps(finder), dataDir: dataDir() });
  assert.strictEqual(r.send.length, 1);
  assert.deepStrictEqual([seen[0].first_name, seen[0].last_name, seen[0].website], ['Priya', 'Nair', 'acme.co.uk']);
  const csv = P.toCsv(P.SEND_COLUMNS, r.send.map(P.sendRow));
  assert.match(csv, /priya@acme.co.uk/);
  const g = { findMany: async () => ({ results: [{ email: 'info@acme.co.uk', status: 'found_generic' }], summary: {} }), close() {} };
  const r2 = await P.run({ rows, deps: mkDeps(g), dataDir: dataDir() });
  assert.strictEqual(r2.send.length, 0);
  assert.match(r2.held[0].reason, /generic inbox/);
});
test('do-not-contact and sent-ledger exclusions apply to the found email and to a DNC domain', async () => {
  const finder = { findMany: async () => ({ results: [{ email: 'priya@acme.co.uk', status: 'found', confidence: 'high' }], summary: {} }), close() {} };
  const rows = [{ ...curated({ company: 'Acme Widgets' }), company_url_direct: 'https://acme.co.uk' }];
  for (const files of [{ 'do-not-contact.txt': '# c\npriya@acme.co.uk\tasked to be removed\n' }, { 'sent-ledger.txt': 'PRIYA@acme.co.uk\n' }]) {
    const r = await P.run({ rows, deps: mkDeps(finder), dataDir: dataDir(files) });
    assert.strictEqual(r.send.length, 0);
    assert.match(r.held[0].reason, /already contacted|do-not-contact/);
  }
  let calls = 0;
  const f2 = { findMany: async () => { calls++; return { results: [], summary: {} }; }, close() {} };
  const r = await P.run({ rows, deps: mkDeps(f2), dataDir: dataDir({ 'do-not-contact.txt': 'acme.co.uk\tdomain opt-out\n' }) });
  assert.strictEqual(calls, 0);
  assert.match(r.held[0].reason, /do-not-contact/);
});
test('dry run never opens the finder', async () => {
  const deps = mkDeps(null);
  deps.openFinder = async () => { throw new Error('finder must not be opened in a dry run'); };
  const rows = [{ ...curated({ company: 'Acme Widgets' }), company_url_direct: 'https://acme.co.uk' }];
  const r = await P.run({ rows, deps, dataDir: dataDir(), dryRun: true });
  assert.strictEqual(r.plan.email_lookups, 1);
  assert.strictEqual(r.send.length, 0);
});
test('credits are hard capped at 150 and Companies House directors of large firms are held', async () => {
  let cap;
  const finder = { findMany: async () => ({ results: [], summary: {} }), close() {} };
  const deps = mkDeps(finder);
  deps.openFinder = async ({ maxCredits }) => { cap = maxCredits; return finder; };
  const rows = [{ ...curated({ company: 'Acme Widgets' }), company_url_direct: 'https://acme.co.uk' }];
  await P.run({ rows, deps, dataDir: dataDir(), maxCredits: 9999 });
  assert.strictEqual(cap, 150);
  const d2 = { fetchHtml: async (u) => { if (/tiny/.test(u) && !/\/team|about/.test(u)) return '<title>Big Corp</title>'; throw new Error('x'); },
    ch: { searchCompany: async () => [{ title: 'BIG CORP LTD', company_number: '1', company_status: 'active' }], lookupOwner: async () => ({ full: 'Old Man', role: 'director', other_directors: 11 }) }, openFinder: async () => finder };
  const r = await P.run({ rows: [{ ...curated({ company: 'Big Corp' }), company_url_direct: 'https://tiny.co.uk' }], deps: d2, dataDir: dataDir(), dryRun: true });
  assert.strictEqual(r.candidates.length, 0);
  assert.match(r.held[0].reason, /larger company/);
});

test('a site that matches only the company name but describes a different business is held', async () => {
  const ad = 'Jolly Technologies is a Silicon Valley software company. Our products are enterprise multi-tenant cloud SaaS platforms for label printing and visitor management used worldwide. ' + 'x'.repeat(400);
  const html = '<title>Jolly Technologies</title><meta name="description" content="Building literacy products on the foundation of Jolly Phonics, teaching children to read"><h1>Jolly Phonics</h1>';
  assert.strictEqual(CD.corroborates(html, { company: 'Jolly Technologies Inc', description: ad }), false);
  const r = await P.run({ rows: [{ ...curated({ company: 'Jolly Technologies Inc', title: 'Growth Marketing Specialist' }), description: ad }], deps: { fetchHtml: async (u) => { if (u === 'https://jollytechnologies.com') return html; throw new Error('x'); }, openFinder: async () => { throw new Error('no'); } }, dataDir: dataDir(), dryRun: true });
  assert.strictEqual(r.candidates.length, 0);
  assert.match(r.held[0].reason, /same business/);
  assert.strictEqual(CD.corroborates(html, { company: 'Jolly Technologies Inc', description: 'short' }), null);
});

test('car listings, testimonials and homepage quotes are never taken as the hiring manager', () => {
  assert.strictEqual(HM.isTitle('(1 Owner/Full service history)'), false);
  assert.strictEqual(HM.isTitle('Director of growth, Lusha'), false);
  assert.strictEqual(HM.isTitle('Co-Founder & CEO'), true);
  assert.strictEqual(HM.isTitle('Chief Executive Officer, Co-Founder'), true);
});
test('Companies House director of a company that files full accounts is skipped', async () => {
  const ch = { searchCompany: async () => [{ title: 'COLT LTD', company_number: '1', company_status: 'active' }], accountsType: async () => 'full', lookupOwner: async () => ({ full: 'A B', role: 'director', other_directors: 1 }) };
  assert.strictEqual(await HM.chOwner({ company: 'Colt', title: 'x' }, { ch }), null);
});

test('web-search evidence: high/medium reach the finder, low is held, evidence url is carried to the send row', async () => {
  const finder = { findMany: async () => ({ results: [{ email: 'jane@acme.co.uk', status: 'found', confidence: 'high' }], summary: {} }), close() {} };
  const row = { ...curated({ company: 'Acme Widgets' }), company_url_direct: 'https://acme.co.uk' };
  const mk = (confidence) => ({ ...mkDeps(finder), evidence: () => ({ name: 'Jane Doe', title: 'CEO', confidence, evidence_url: 'https://example.com/x', snippet: 's' }) });
  const ok = await P.run({ rows: [row], deps: mk('high'), dataDir: dataDir() });
  assert.strictEqual(ok.send.length, 1);
  assert.strictEqual(P.sendRow(ok.send[0]).evidence_url, 'https://example.com/x');
  assert.strictEqual(P.sendRow(ok.send[0]).hm_source, 'web_search');
  const low = await P.run({ rows: [row], deps: mk('low'), dataDir: dataDir() });
  assert.strictEqual(low.send.length, 0);
  assert.match(low.held[0].reason, /low-confidence/);
});
test('a human-verified domain skips guessing and is trusted; Recon-style rows without a score get a computed fit score', async () => {
  const r = await CD.resolveDomain({ company: 'Cazoo', company_urls: [], domain_override: 'cazoo.co.uk', domain_evidence_url: 'https://x' });
  assert.deepStrictEqual([r.domain, r.source, r.verified], ['cazoo.co.uk', 'web_search_verified', true]);
  const f = RF.filterRoles([{ title: 'PPC Specialist', company_name: 'Zed', job_url: 'u', contract_type: 'Contract', remote_hint: 'true', description: 'Google Ads, PPC, paid media, fully remote' }, { title: 'Store Assistant', company_name: 'Shop', job_url: 'u2', contract_type: 'Contract', remote_hint: 'true', description: 'remote' }]);
  assert.deepStrictEqual(f.keep.map((x) => x.company), ['Zed']);
  assert.ok(f.keep[0].score >= 5);
});
test('Synthires and ad-text agencies are routed to the recruiter list', () => {
  const r = RF.filterRoles([curated({ company: 'Synthires', posted_by: 'direct_employer' }), curated({ company: 'Zork', posted_by: '', description: 'An employer is seeking a thing. Apply via Haystack today!' })]);
  assert.strictEqual(r.recruiters.length, 2);
});
