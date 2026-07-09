// shared/outreach-core/enrichment/decision-maker-resolver.js
//
// Resolve the RIGHT decision-maker for a hiring-signal lead — without defaulting to CEO.
//
// The insight: the posted role tells you where the budget sits.
//   - Leadership hire (Head of / Director / Chief) => that seat is EMPTY => founder owns it now (hottest).
//   - IC hire (Manager / Executive / Coordinator) => a departmental head already exists => target the head.
// Company headcount then disambiguates: a small company has no head, so the founder is always the target.
//
// classify() is pure logic (fully tested, no I/O). resolve() runs an ordered route cascade of
// injected async adapters (Companies House, LinkedIn people, website team, JD reporting-line) and
// triangulates: two independent sources agreeing on a person = high confidence.
//
// Design notes:
//  - Companies House search is fuzzy (it matched "Monzo" -> a dissolved shell), so the CH adapter
//    MUST score name similarity and drop weak matches. nameMatchScore() is the guard.
//  - The person who POSTED the job is often an external recruiter — never a target. isExternalRecruiter().

// ---------- role seniority ----------
// 'head' | 'exec' => leadership hire => founder target. 'mid' | 'junior' => IC hire => head target.
const SENIORITY_RULES = [
  { re: /\b(chief|cmo|cfo|cto|coo|ceo|vp|vice[- ]president)\b/i, level: 'exec' },
  { re: /\b(head of|director|vp of|global head|group head)\b/i, level: 'head' },
  { re: /\b(lead|principal|manager|senior)\b/i, level: 'mid' },
  { re: /\b(executive|coordinator|assistant|junior|graduate|associate|intern|apprentice|officer|specialist|analyst)\b/i, level: 'junior' },
];
function roleSeniority(title) {
  if (!title || typeof title !== 'string') return 'unknown';
  for (const { re, level } of SENIORITY_RULES) if (re.test(title)) return level;
  return 'mid'; // unlabelled role: assume mid IC, safest (looks for a head, falls back to founder)
}
const isLeadershipHire = level => level === 'head' || level === 'exec';

// ---------- role function ----------
// function key => { detect, headTitles (ordered, best-first) }
const FUNCTIONS = [
  { key: 'content', detect: /\b(content|podcast|producer|editorial|social media|video|audio|creative|studio)\b/i,
    headTitles: ['Head of Content', 'Content Director', 'Head of Podcasts', 'Head of Studio', 'Creative Director'] },
  { key: 'marketing', detect: /\b(market|seo|sem|ppc|growth|brand|demand gen|comms|communications|digital)\b/i,
    headTitles: ['Head of Marketing', 'Marketing Director', 'CMO', 'VP Marketing', 'Marketing Manager', 'Head of Growth'] },
  { key: 'finance', detect: /\b(financ|accounting|accountant|controller|fp&a|treasury|bookkeep)\b/i,
    headTitles: ['CFO', 'Finance Director', 'Head of Finance', 'Financial Controller'] },
  { key: 'sales', detect: /\b(sales|business development|bdm|account executive|account manager|revenue)\b/i,
    headTitles: ['Head of Sales', 'Sales Director', 'CRO', 'VP Sales', 'Commercial Director'] },
  { key: 'tech', detect: /\b(engineer|developer|software|devops|data|infrastructure|platform|qa)\b/i,
    headTitles: ['CTO', 'Head of Engineering', 'Engineering Director', 'VP Engineering', 'Tech Lead'] },
  { key: 'product', detect: /\b(product manager|product owner|product designer|head of product)\b/i,
    headTitles: ['Head of Product', 'CPO', 'VP Product', 'Product Director'] },
  { key: 'ops', detect: /\b(operations|logistics|supply chain|office manager|facilities)\b/i,
    headTitles: ['COO', 'Head of Operations', 'Operations Director', 'Operations Manager'] },
];
function roleFunction(title) {
  if (!title || typeof title !== 'string') return 'other';
  for (const f of FUNCTIONS) if (f.detect.test(title)) return f.key;
  return 'other';
}

// Founder-tier titles: the target whenever the founder owns the gap (small co, or leadership hire).
const FOUNDER_TITLES = ['Founder', 'Co-Founder', 'CEO', 'Chief Executive', 'Managing Director', 'Owner', 'Director', 'Partner'];
function headTitlesFor(fnKey) {
  const f = FUNCTIONS.find(x => x.key === fnKey);
  return f ? f.headTitles : [];
}

// ---------- external-recruiter guard ----------
const RECRUITER_HINTS = /(recruit|talent|staffing|hiring|resourcing|headhunt|search partners|people team|hr@|careers@|jobs@)/i;
function domainOf(email) {
  const m = String(email || '').toLowerCase().match(/@([^@\s]+)$/);
  return m ? m[1].replace(/^www\./, '') : null;
}
function isExternalRecruiter(posterEmail, companyDomain) {
  if (!posterEmail) return false;
  const pd = domainOf(posterEmail);
  const cd = String(companyDomain || '').toLowerCase().replace(/^www\./, '');
  if (pd && cd && pd !== cd) return true;             // different domain than the company = external
  if (RECRUITER_HINTS.test(posterEmail)) return true; // careers@/hr@ etc even on-domain: not a buyer
  return false;
}

// ---------- fuzzy name matching (for CH search results + cross-source agreement) ----------
function normName(s) {
  return String(s || '').toLowerCase().replace(/\b(ltd|limited|plc|llp|inc|the|and|&|co|company|group|holdings)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
// token Jaccard, 0..1
function nameMatchScore(a, b) {
  const ta = new Set(normName(a).split(' ').filter(Boolean));
  const tb = new Set(normName(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  return inter / new Set([...ta, ...tb]).size;
}
// person-name match: "BOYLE, Michael John" vs "Michael Boyle" -> compare token sets
function personMatch(a, b) {
  const na = normName(String(a).replace(/,/g, ' '));
  const nb = normName(String(b).replace(/,/g, ' '));
  const ta = new Set(na.split(' ').filter(Boolean));
  const tb = new Set(nb.split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size); // subset-friendly: middle names shouldn't punish
}

// ---------- classify: the decision tree ----------
const SMALL_MAX = 20;    // <= this => no functional head exists => founder target
const LARGE_MIN = 250;   // > this => out of scope for KSD/Stripped services (Dealflow-only)

function classify(signal) {
  const { companyHeadcount = null, roleTitle = '', posterEmail = null, companyDomain = null, brand = null } = signal;
  const seniority = signal.roleSeniority || roleSeniority(roleTitle);
  const fn = roleFunction(roleTitle);
  const flags = {};

  if (isExternalRecruiter(posterEmail, companyDomain)) flags.posterIsRecruiter = true;

  const hc = typeof companyHeadcount === 'number' ? companyHeadcount : null;
  if (hc !== null && hc > LARGE_MIN) flags.tooLarge = true;

  // Dealflow: funded-company senior hire => founder is the buyer regardless of function.
  const dealflowFounderTarget = brand === 'dealflow';

  let segment, targetKind, targetTitles;

  if (dealflowFounderTarget || (hc !== null && hc <= SMALL_MAX)) {
    segment = dealflowFounderTarget ? 'dealflow-founder' : 'small-founder';
    targetKind = 'founder';
    targetTitles = FOUNDER_TITLES;
  } else if (isLeadershipHire(seniority)) {
    // leadership hire => that seat is empty => founder owns it now (hottest moment)
    segment = 'leadership-hire';
    targetKind = 'founder';
    targetTitles = FOUNDER_TITLES;
    flags.hotVacancy = true;
  } else if (hc === null) {
    // unknown size + IC hire: best effort — look for the head, fall back to founder
    segment = 'unknown-size-ic';
    targetKind = 'head-or-founder';
    targetTitles = [...headTitlesFor(fn), ...FOUNDER_TITLES];
  } else {
    // mid-size + IC hire => a departmental head exists => target them, NOT the CEO
    segment = 'mid-ic-hire';
    targetKind = 'head';
    targetTitles = headTitlesFor(fn).length ? headTitlesFor(fn) : FOUNDER_TITLES;
  }

  // Route cascade order depends on target kind.
  // Founder target: Companies House (legal director) leads for small UK cos; JD reporting-line; website; LinkedIn.
  // Head target: JD reporting-line (often names the manager) and LinkedIn people lead; website corroborates.
  const routes = targetKind === 'head'
    ? ['jdReportingLine', 'linkedinPeople', 'websiteTeam', 'companiesHouse']
    : ['companiesHouse', 'jdReportingLine', 'linkedinPeople', 'websiteTeam'];

  return { segment, targetKind, targetFunction: fn, seniority, targetTitles, routes, flags };
}

// ---------- resolve: run the route cascade + triangulate ----------
// io adapters (all optional, async, return array of {name, title, email?, linkedinUrl?, source, matchScore?}):
//   companiesHouse(companyName, companyDomain)
//   linkedinPeople(companyName, targetTitles)
//   websiteTeam(companyDomain, targetTitles)
//   jdReportingLine(jobDescription)
const SOURCE_CONFIDENCE = { companiesHouse: 0.75, linkedinPeople: 0.7, jdReportingLine: 0.65, websiteTeam: 0.6 };

function titleMatchesTarget(title, targetTitles) {
  if (!title) return false;
  const t = title.toLowerCase();
  return targetTitles.some(tt => t.includes(tt.toLowerCase()) || tt.toLowerCase().includes(t));
}

async function resolve(signal, io = {}) {
  const plan = classify(signal);
  const candidates = [];

  for (const route of plan.routes) {
    const adapter = io[route];
    if (typeof adapter !== 'function') continue;
    let found = [];
    try {
      if (route === 'companiesHouse') found = await adapter(signal.companyName, signal.companyDomain);
      else if (route === 'linkedinPeople') found = await adapter(signal.companyName, plan.targetTitles);
      else if (route === 'websiteTeam') found = await adapter(signal.companyDomain, plan.targetTitles);
      else if (route === 'jdReportingLine') found = await adapter(signal.jobDescription);
    } catch { found = []; }
    for (const c of (found || [])) {
      if (!c || !c.name) continue;
      // recruiter poster never becomes a target
      if (plan.flags.posterIsRecruiter && signal.posterName && personMatch(c.name, signal.posterName) >= 0.8) continue;
      candidates.push({ ...c, source: c.source || route, baseConfidence: SOURCE_CONFIDENCE[route] || 0.5 });
    }
  }

  if (!candidates.length) {
    return { person: null, confidence: 0, segment: plan.segment, targetKind: plan.targetKind, flags: plan.flags, candidates: [], plan };
  }

  // Cluster by person (fuzzy) to find cross-source agreement.
  const clusters = [];
  for (const c of candidates) {
    const hit = clusters.find(cl => personMatch(cl.name, c.name) >= 0.6);
    if (hit) { hit.members.push(c); hit.sources.add(c.source); }
    else clusters.push({ name: c.name, members: [c], sources: new Set([c.source]) });
  }

  // Score each cluster: best base confidence + agreement bonus + title-match bonus.
  for (const cl of clusters) {
    const best = cl.members.reduce((a, b) => (b.baseConfidence > a.baseConfidence ? b : a));
    cl.best = best;
    let score = best.baseConfidence;
    if (cl.sources.size >= 2) score = Math.min(0.95, score + 0.2); // two independent sources agree
    const anyTitle = cl.members.map(m => m.title).find(Boolean);
    if (titleMatchesTarget(anyTitle, plan.targetTitles)) score = Math.min(0.97, score + 0.1);
    else if (anyTitle) score = Math.max(0.2, score - 0.15); // title in wrong function => downgrade
    cl.score = score;
    cl.email = cl.members.map(m => m.email).find(Boolean) || null;
    cl.title = anyTitle || null;
    cl.linkedinUrl = cl.members.map(m => m.linkedinUrl).find(Boolean) || null;
  }

  clusters.sort((a, b) => b.score - a.score);
  const winner = clusters[0];
  return {
    person: { name: winner.best.name, title: winner.title, email: winner.email, linkedinUrl: winner.linkedinUrl },
    confidence: Math.round(winner.score * 100) / 100,
    sources: [...winner.sources],
    segment: plan.segment,
    targetKind: plan.targetKind,
    flags: plan.flags,
    candidates: clusters.map(c => ({ name: c.best.name, title: c.title, email: c.email, sources: [...c.sources], score: Math.round(c.score * 100) / 100 })),
    plan,
  };
}

module.exports = {
  roleSeniority, roleFunction, isLeadershipHire, classify, resolve,
  isExternalRecruiter, nameMatchScore, personMatch, headTitlesFor, FOUNDER_TITLES,
};
