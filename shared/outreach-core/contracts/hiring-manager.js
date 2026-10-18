'use strict';
/**
 * Most likely hiring manager for a role, in order:
 *  (a) named in the ad ("reporting to Jane Smith, Head of Growth", "hiring manager: ...")   -> high
 *  (b) the company's team / about / leadership page: the person whose function the role reports into;
 *      for small firms the founder or CEO                                                     -> high (matches the ad's own title hint) | medium | low
 *  (c) Companies House: longest-serving active human director, UK companies only             -> low
 * Returns { name, first, last, title, source, confidence, evidence } or null. Pure except for the injected deps.
 */

const TITLE_RE = /\b(ceo|cmo|coo|cto|cfo|cro|founder|co-?founder|owner|managing director|director|head of|head,|vp|vice president|president|chief|manager|partner|principal|chairman|chair|lead)\b/i;
const TITLE_WORDS = new Set(['head', 'chief', 'director', 'manager', 'ceo', 'cmo', 'coo', 'cto', 'cfo', 'founder', 'cofounder', 'owner', 'vp', 'vice', 'president', 'senior', 'lead', 'marketing', 'growth', 'our', 'the', 'team', 'meet', 'about', 'contact', 'read', 'more', 'learn', 'view', 'join', 'us', 'we', 'hiring', 'recruiter', 'recruitment', 'hr', 'people', 'talent', 'operations', 'digital', 'sales', 'product', 'finance', 'technology', 'engineering', 'design', 'brand', 'content', 'partner', 'managing', 'executive', 'officer', 'general', 'business', 'customer', 'success', 'company', 'careers', 'jobs', 'privacy', 'cookie', 'policy', 'terms', 'news', 'blog', 'case', 'studies', 'services', 'solutions', 'home', 'login', 'sign', 'get', 'started', 'book', 'demo', 'free', 'trial', 'london', 'manchester', 'united', 'kingdom', 'new', 'york', 'all', 'rights', 'reserved', 'staff', 'leadership', 'board', 'advisors', 'investors', 'mission', 'values', 'story', 'history', 'who', 'what', 'how', 'why', 'our', 'your', 'their', 'is', 'are', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'with', 'by', 'from']);
const NAME_PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'da', 'di', 'del', 'la', 'le', 'bin', 'al', 'mc', 'mac']);
const JUNIOR = /\b(intern|assistant|junior|associate|apprentice|graduate|trainee|coordinator|executive assistant|pa to)\b/i;

const clean = (t) => String(t || '').replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ').replace(/&#8217;|&rsquo;/g, "'").replace(/&#8211;|&ndash;|&#8212;|&mdash;/g, '-').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

function isName(str) {
  const s = clean(str).replace(/[,.]+$/, '').replace(/\s*\((he|she|they)[^)]*\)/i, '');
  if (!s || s.length > 40) return false;
  const parts = s.split(' ');
  if (parts.length < 2 || parts.length > 4) return false;
  let caps = 0;
  for (const p of parts) {
    if (NAME_PARTICLES.has(p.toLowerCase())) continue;
    if (!/^[A-Z][a-zA-Z'’-]{1,19}$/.test(p) && !/^[A-Z]\.$/.test(p)) return false;
    if (TITLE_WORDS.has(p.toLowerCase())) return false;
    caps++;
  }
  return caps >= 2;
}

function isTitle(str) {
  const s = clean(str);
  return s.length >= 2 && s.length <= 80 && TITLE_RE.test(s) && !/[.!?]\s+[A-Z]/.test(s);
}

function splitName(full) {
  const parts = clean(full).split(' ').filter(Boolean);
  const first = parts[0];
  const last = parts.slice(1).join(' ');
  return { first, last };
}

// ---------- (a) named in the ad ----------

const LEAD_PHRASE = /(reporting (?:directly )?(?:in)?to|reports? (?:directly )?(?:in)?to|you(?:'|’)ll report to|hiring manager(?: is)?|line manager(?: is)?|working (?:directly )?(?:with|for|alongside|under))\s*[:\-]?\s*/gi;

function parseAdManager(description) {
  const text = String(description || '').replace(/\*+/g, ' ').replace(/\s+/g, ' ');
  let titleHint = '';
  LEAD_PHRASE.lastIndex = 0;
  let m;
  while ((m = LEAD_PHRASE.exec(text))) {
    const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 140).replace(/^(?:the|our|a|an)\s+/i, '');
    const nm = rest.match(/^([A-Z][a-zA-Z'’-]+(?:\s+(?:van|von|de|der|da|di|del|la|le|bin|al|Mc|Mac))?(?:\s+[A-Z][a-zA-Z'’-]+){1,2})(?=[\s,(\-–|.;]|$)/);
    if (nm && isName(nm[1])) {
      const after = rest.slice(nm[0].length).replace(/^\s*[,(\-–|]\s*|^\s+(?:who is\s+|is\s+|our\s+|the\s+)/i, '');
      const tm = after.match(/^([A-Za-z&' /,-]{3,70}?)(?:\)|\.|;|\n|,\s+(?:and|who|to|so)\b|\s+(?:and|to|who|in|at)\s|$)/);
      const title = tm && isTitle(tm[1]) ? clean(tm[1]) : '';
      return { name: nm[1], title, evidence: clean(m[0] + rest.slice(0, 90)).slice(0, 160), titleHint: title };
    }
    const th = rest.match(/^((?:Head|Director|VP|Vice President|Chief|Manager|Lead)\b[A-Za-z&' /-]{0,40}|[A-Z][A-Za-z&' -]{2,30}\s(?:Director|Manager|Lead|Head))/);
    if (th && !titleHint) titleHint = clean(th[1]).replace(/\s+(and|to|who|in|at|on|for)$/i, '');
  }
  return titleHint ? { name: '', title: '', titleHint, evidence: `ad says it reports to: ${titleHint}` } : null;
}

// ---------- (b) team page ----------

function personsFromJsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(walk);
        if (/person/i.test(String(n['@type'])) && n.name && n.jobTitle && isName(n.name)) out.push({ name: clean(n.name), title: clean(n.jobTitle) });
        Object.values(n).forEach(walk);
      };
      walk(JSON.parse(m[1]));
    } catch (e) { /* bad json-ld */ }
  }
  return out;
}

function extractPeople(html) {
  if (!html) return [];
  const people = [...personsFromJsonLd(html)];
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const chunks = body.split(/<[^>]+>/).map(clean).filter((c) => c && c.length <= 120);
  const add = (name, title) => { if (isName(name) && isTitle(title)) people.push({ name: clean(name).replace(/[,.]+$/, ''), title: clean(title) }); };
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const inline = c.match(/^(.{4,40}?)\s*(?:,|\||–|-|—|:)\s+(.{3,80})$/);
    if (inline && isName(inline[1]) && isTitle(inline[2])) { add(inline[1], inline[2]); continue; }
    if (isName(c)) {
      if (chunks[i + 1] && isTitle(chunks[i + 1])) add(c, chunks[i + 1]);
      else if (chunks[i + 2] && isTitle(chunks[i + 2]) && chunks[i + 1].length < 25 && !isName(chunks[i + 1])) add(c, chunks[i + 2]);
    } else if (isTitle(c) && i > 0 && isName(chunks[i - 1]) && !(chunks[i + 1] && false)) {
      add(chunks[i - 1], c);
    }
  }
  const seen = new Set();
  return people.filter((p) => { const k = p.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

const MARKETING_RE = '(marketing|growth|digital|brand|demand|acquisition|performance|content|communications|seo|crm|lifecycle|customer)';
function roleFamily(title) {
  const t = String(title || '').toLowerCase();
  if (/(automation|operations|\bops\b|revops|\bai\b|workflow|process|power platform|data|analytic|systems|engineer|developer|technical)/.test(t)) return 'ops';
  return 'marketing';
}

function titleScore(personTitle, family, hint) {
  const t = clean(personTitle).toLowerCase();
  if (!t || JUNIOR.test(t)) return 0;
  let s = 0;
  if (family === 'marketing') {
    if (new RegExp(`head of ${MARKETING_RE}`).test(t)) s = 100;
    else if (new RegExp(`(${MARKETING_RE}) director|director of ${MARKETING_RE}`).test(t)) s = 95;
    else if (new RegExp(`(vp|vice president).{0,20}${MARKETING_RE}`).test(t)) s = 92;
    else if (/\bcmo\b|chief marketing|chief growth|chief revenue|\bcro\b/.test(t)) s = 88;
    else if (new RegExp(`${MARKETING_RE} (manager|lead)`).test(t) && !/\bassociate\b/.test(t)) s = 60;
  } else {
    if (/head of (operations|revops|revenue operations|automation|ai|data|technology|engineering|it|product|systems)/.test(t)) s = 100;
    else if (/(operations|technology|engineering|data|product) director|director of (operations|technology|engineering|data|product)/.test(t)) s = 95;
    else if (/\bcoo\b|chief operating|\bcto\b|chief technology|chief product|chief data|chief ai/.test(t)) s = 90;
    else if (/(vp|vice president).{0,20}(operations|engineering|technology|data|product)/.test(t)) s = 92;
    else if (/(operations|engineering|data|product|technology|it) manager/.test(t)) s = 60;
    else if (new RegExp(`head of ${MARKETING_RE}`).test(t)) s = 50;
  }
  if (s && hint) {
    const hw = String(hint).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !['head', 'chief', 'director', 'manager', 'senior', 'officer'].includes(w));
    if (hw.length && hw.some((w) => t.includes(w)) && /(head|director|vp|vice|chief|manager)/.test(String(hint).toLowerCase())) s += 20;
  }
  return s;
}

const TOP_RE = /\b(founder|co-?founder|owner|ceo|chief executive|managing director|\bmd\b|proprietor)\b/i;

function employeesLow(employees) {
  const m = String(employees || '').replace(/,/g, '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

/**
 * people: [{name,title}], role, adHint (title hint string), opts.employees
 * -> { name,title,source,confidence,evidence } | null
 */
function pickFromPeople(people, role, { adHint = '', employees = '' } = {}) {
  const family = roleFamily(role.title);
  const scored = people.map((p) => ({ ...p, score: titleScore(p.title, family, adHint) })).filter((p) => p.score > 0).sort((a, b) => b.score - a.score);
  const low = employeesLow(employees);
  const small = low != null ? low < 20 : people.length <= 12;
  const top = people.find((p) => TOP_RE.test(p.title) && !JUNIOR.test(p.title));
  const best = scored[0];
  if (best && !(small && low != null && low <= 10 && top)) {
    const matchedHint = adHint && best.score > 100;
    return { name: best.name, title: best.title, source: 'team_page', confidence: matchedHint || best.score >= 100 ? (matchedHint ? 'high' : 'medium') : 'medium', evidence: `team page lists ${best.name} as ${best.title}` };
  }
  if (top) {
    return { name: top.name, title: top.title, source: 'team_page_founder', confidence: small ? 'medium' : 'low', evidence: `${small ? 'small firm' : 'no ' + family + ' lead found'}: ${top.name} is ${top.title}` };
  }
  return null;
}

const PROBE_PATHS = ['/team', '/about', '/about-us', '/our-team', '/leadership', '/people', '/company', '/meet-the-team', '/about/team', '/who-we-are'];

function navLinks(html, base) {
  const out = [];
  let host;
  try { host = new URL(base).hostname; } catch (e) { return out; }
  for (const m of String(html || '').matchAll(/<a\s+[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = clean(m[2].replace(/<[^>]+>/g, ' ')).toLowerCase();
    const href = m[1].trim();
    if (!/(team|about|leadership|people|who we are|our story|meet|management|founder|company)/.test(text + ' ' + href.toLowerCase())) continue;
    if (/(blog|news|careers|jobs|press|privacy|cookie|terms)/.test(href.toLowerCase())) continue;
    try { const u = new URL(href, base); if (u.hostname.replace(/^www\./, '') === host.replace(/^www\./, '')) out.push(u.href.split('#')[0]); } catch (e) { /* skip */ }
  }
  return [...new Set(out)];
}

async function peopleFromSite(domain, { fetchHtml, maxPages = 5 }) {
  const base = 'https://' + domain;
  let home = '';
  let homeUrl = base;
  for (const u of [base, 'https://www.' + domain]) { try { home = await fetchHtml(u); homeUrl = u; break; } catch (e) { /* next */ } }
  const urls = [...navLinks(home, homeUrl), ...PROBE_PATHS.map((p) => homeUrl + p)];
  const people = [...extractPeople(home)];
  const tried = new Set([homeUrl]);
  let pages = 0;
  for (const u of urls) {
    if (pages >= maxPages) break;
    const key = u.replace(/\/$/, '');
    if (tried.has(key)) continue;
    tried.add(key);
    try { const html = await fetchHtml(u); pages++; people.push(...extractPeople(html)); } catch (e) { /* page missing */ }
    if (people.some((p) => titleScore(p.title, 'marketing', '') >= 88) && people.length >= 4 && pages >= 2) break;
  }
  const seen = new Set();
  return people.filter((p) => { const k = p.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------- (c) Companies House ----------

const normCo = (n) => String(n || '').toLowerCase().replace(/&/g, 'and').replace(/\b(ltd|limited|plc|llp|uk|the|group|inc)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

async function chOwner(role, { ch }) {
  if (!ch) return null;
  let number = role.ch_company_number;
  let matched = number ? 'Recon company number' : '';
  if (!number && ch.searchCompany) {
    const hits = (await ch.searchCompany(role.company)) || [];
    const hit = hits.find((h) => normCo(h.title) === normCo(role.company) && /active/i.test(h.company_status || 'active'));
    if (!hit) return null;
    number = hit.company_number; matched = `Companies House name match ${hit.title}`;
  }
  const owner = await ch.lookupOwner(number);
  if (!owner || owner.none || owner.error) return null;
  return { name: owner.full, title: owner.role === 'director' ? 'Director (Companies House)' : 'Member (Companies House)', source: 'companies_house', confidence: 'low', other_directors: owner.other_directors, evidence: `${matched}; longest-serving active director` };
}

/**
 * role, domain, deps { fetchHtml, ch } -> manager | null.  Large firms found only through Companies House are not a hiring manager: callers see other_directors.
 */
async function findHiringManager(role, domain, deps = {}) {
  const ad = parseAdManager(role.description);
  if (ad && ad.name) {
    const { first, last } = splitName(ad.name);
    return { name: ad.name, first, last, title: ad.title, source: 'ad', confidence: 'high', evidence: ad.evidence };
  }
  const adHint = (ad && ad.titleHint) || role.report_hint || '';
  let people = [];
  if (domain && deps.fetchHtml) {
    try { people = await peopleFromSite(domain, { fetchHtml: deps.fetchHtml }); } catch (e) { people = []; }
    const pick = pickFromPeople(people, role, { adHint: ad && ad.titleHint, employees: role.employees });
    if (pick) { const { first, last } = splitName(pick.name); return { ...pick, first, last, people_seen: people.length }; }
  }
  const ch = await chOwner(role, deps).catch(() => null);
  if (ch) { const { first, last } = splitName(ch.name); return { ...ch, first, last, people_seen: people.length }; }
  void adHint;
  return null;
}

module.exports = { findHiringManager, parseAdManager, extractPeople, pickFromPeople, titleScore, isName, isTitle, roleFamily, navLinks, chOwner, splitName };
