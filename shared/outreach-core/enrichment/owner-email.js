/**
 * Best email to reach the OWNER of a small business.
 *
 * Inputs: emails the website scraper found, the website, and the owner from Companies House (ch-owner.js).
 * Order of preference (rule is recorded so every choice can be audited):
 *   owner-match           owner's address on the firm's own domain (incl. nicknames: Tony = Anthony)
 *   owner-freemail        owner's address on gmail/hotmail/etc. (normal for trades)
 *   owner-guess-verified  owner pattern guessed at the firm's domain AND Reoon says "safe"
 *   role                  info@/enquiries@/sales@ on the own domain (small firm: usually reaches the owner)
 *   staff                 someone else's address on the own domain
 *   freemail              a free mailbox that is not obviously the owner's
 * Never: third-party/agency/junk domains. Catch-all domains never confirm a guess (they accept anything).
 */
const NICK_GROUPS = [
  ['anthony', 'tony', 'ant'], ['stephen', 'steven', 'steve'], ['david', 'dave'], ['michael', 'mike', 'mick'],
  ['robert', 'rob', 'bob', 'bobby', 'robbie'], ['william', 'will', 'bill', 'billy'], ['james', 'jim', 'jamie', 'jimmy'],
  ['richard', 'rich', 'rick', 'richie'], ['thomas', 'tom', 'tommy'], ['christopher', 'chris'], ['matthew', 'matt'],
  ['andrew', 'andy', 'drew'], ['daniel', 'dan', 'danny'], ['joseph', 'joe'], ['edward', 'ed', 'eddie', 'ted'],
  ['peter', 'pete'], ['nicholas', 'nick'], ['benjamin', 'ben'], ['samuel', 'sam'], ['alexander', 'alex'],
  ['jonathan', 'jon', 'jonny'], ['john', 'jon', 'jack', 'johnny'], ['kenneth', 'ken', 'kenny'], ['gareth', 'gaz'],
  ['gary', 'gaz'], ['patrick', 'pat', 'paddy'], ['philip', 'phil'], ['timothy', 'tim'], ['gregory', 'greg'],
  ['raymond', 'ray'], ['ronald', 'ron'], ['donald', 'don'], ['douglas', 'doug'], ['francis', 'frank'],
  ['frederick', 'fred'], ['jeffrey', 'jeff', 'geoff'], ['geoffrey', 'geoff', 'jeff'], ['stuart', 'stu'],
  ['nathan', 'nate', 'nat'], ['elizabeth', 'liz', 'beth', 'lizzie'], ['katherine', 'kate', 'kath', 'katie'],
  ['catherine', 'cath', 'cathy', 'kate', 'katie'], ['margaret', 'maggie'], ['rebecca', 'becky', 'becca'],
  ['deborah', 'debbie', 'deb'], ['susan', 'sue', 'susie'], ['jennifer', 'jen', 'jenny'], ['victoria', 'vicky', 'tori'],
  ['samantha', 'sam'], ['alexandra', 'alex'], ['christine', 'chris'], ['patricia', 'pat', 'trish'],
  ['nicola', 'nicky', 'nikki'], ['jacqueline', 'jackie'], ['amanda', 'mandy'], ['kimberley', 'kim'],
  ['joanne', 'jo'], ['josephine', 'jo'], ['leonard', 'len', 'lenny'], ['terence', 'terry'], ['lawrence', 'laurie', 'larry'],
];
const FREEMAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|btinternet|btopenworld|sky|aol|virginmedia|talktalk|ntlworld|blueyonder|protonmail|proton|gmx|mail|zoho)\./i;
const JUNK_DOMAIN = /(^|\.)(sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|wix\.com|godaddy\.com|example\.(com|org|net)|domain\.com|email\.com|yourdomain\.com|yoursite\.com|mysite\.com|test\.com|squarespace\.com|wordpress\.(com|org)|schema\.org|google\.com|gstatic\.com|cloudflare\.com|sentry\.com|w3\.org)$/i;
const JUNK_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|abuse|webmaster|privacy|gdpr|dpo|unsubscribe)$/i;
const ROLE_LOCAL = /^(info|enquiries|enquiry|sales|office|hello|contact|mail|admin|accounts|bookings|booking|quotes|quote|team|reception|service|services|support|general|estimates)$/i;

// Stricter than FREEMAIL: a free-mail provider is "<name>.<tld>", so mail.acme.co.uk is a company, not a free mailbox.
const FREE_TLD = /^(com|co\.uk|org\.uk|net|org|uk|co|me|fr|de|es|it|ie|ca|com\.au|co\.nz|in)$/;
const isFreemailDomain = d => { const x = lc(d); return FREEMAIL.test(x) && FREE_TLD.test(x.slice(x.indexOf('.') + 1)); };
const lc = s => String(s || '').toLowerCase().trim();
const siteDomain = w => lc(w).replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0];
const rootLabel = d => (d.split('.')[0] || '').replace(/-/g, '');

function nameVariants(first) {
  const f = lc(first); const set = new Set([f]);
  for (const g of NICK_GROUPS) if (g.includes(f)) g.forEach(n => set.add(n));
  return [...set];
}

function isOwnerLocal(local, owner) {
  if (!owner || !owner.first) return false;
  const last = lc(owner.last).replace(/[^a-z]/g, '');
  const parts = local.split(/[._-]+/).filter(Boolean);
  for (const f of nameVariants(owner.first)) {
    const cands = [f, `${f}.${last}`, `${f}${last}`, `${f[0]}${last}`, `${f[0]}.${last}`, `${f}${last[0] || ''}`, `${f}_${last}`, `${f}-${last}`];
    if (cands.includes(local)) return true;
    if (parts.length >= 2 && parts[0] === f && last && parts[1] === last) return true;
  }
  return !!last && last.length >= 4 && local === last;
}

function ownerGuesses(owner, domain) {
  if (!owner || !owner.first || !domain) return [];
  const f = lc(owner.first).replace(/[^a-z]/g, ''), l = lc(owner.last).replace(/[^a-z]/g, '');
  if (!f) return [];
  return [...new Set([`${f}@`, l && `${f}.${l}@`, l && `${f[0]}${l}@`, l && `${f}${l}@`, l && `${f[0]}.${l}@`].filter(Boolean))].map(p => p + domain);
}

function pickBestEmail({ emails = [], website = '', owner = null }) {
  const domain = siteDomain(website);
  const root = rootLabel(domain);
  const ranked = [];
  for (const raw of [...new Set(emails.map(lc))]) {
    const [local, edom] = raw.split('@');
    if (!local || !edom || JUNK_DOMAIN.test(edom) || JUNK_LOCAL.test(local)) continue;
    const own = !!domain && (edom === domain || edom.endsWith('.' + domain) || (root && rootLabel(edom) === root));
    const free = FREEMAIL.test(edom);
    const isOwner = isOwnerLocal(local, owner);
    let rule = null, score = 0;
    if (own && isOwner) { rule = 'owner-match'; score = 6; }
    else if (free && (isOwner || (owner && owner.last && local.includes(lc(owner.last))))) { rule = 'owner-freemail'; score = 5; }
    else if (own && ROLE_LOCAL.test(local)) { rule = 'role'; score = 4; }
    else if (own) { rule = 'staff'; score = 3; }
    else if (free) { rule = 'freemail'; score = 2; }
    if (rule) ranked.push({ email: raw, rule, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0] || { email: null, rule: 'none' };
  const guesses = ['owner-match', 'owner-freemail'].includes(best.rule) ? [] : ownerGuesses(owner, domain);
  return { email: best.email, rule: best.rule, guesses, alternatives: ranked.slice(1).map(r => r.email) };
}

async function resolveOwnerEmail(input, { verify = null, maxGuesses = 3 } = {}) {
  const pick = pickBestEmail(input);
  if (!verify || !pick.guesses.length) return pick;
  const tries = pick.guesses.slice(0, maxGuesses);
  const results = await verify(tries);
  const byEmail = Object.fromEntries((results || []).map(r => [lc(r.email), r]));
  const hit = tries.find(e => byEmail[e] && byEmail[e].status === 'safe');
  return hit ? { ...pick, email: hit, rule: 'owner-guess-verified', fallback: pick.email } : pick;
}

// ---- Status-driven choice between the scraped pick and the email finder's answer ----
// Precedence: scraped owner, finder personal, scraped role, finder generic, scraped staff, Icypeas probable, nothing.
// Chosen by finder STATUS, never by "email is non-empty": left_company carries a (disabled) address and is never used.
const SCRAPED_STATUS = { 'owner-match': 'scraped_owner', 'owner-freemail': 'scraped_owner', role: 'scraped_role', staff: 'scraped_staff' };
const CATCH_ALL_FOUND = new Set(['catch_all_found', 'icypeas_found']);

function chooseOwnerEmail({ pick, finderResult }) {
  const p = pick && pick.email ? pick : { email: null, rule: (pick && pick.rule) || 'none' };
  const f = finderResult || null;
  const fStatus = f ? lc(f.status) : '';
  const fEmail = f ? lc(f.email) : '';
  const fConf = f ? lc(f.confidence) : '';
  const suggested = f ? lc(f.suggested_email) : '';

  const scrapedStatus = p.email ? SCRAPED_STATUS[p.rule] : undefined; // freemail (non-owner) and 'none' are dropped
  const personal = !!fEmail && (fStatus === 'found' || fStatus === 'found_flagged' || (CATCH_ALL_FOUND.has(fStatus) && fConf === 'high'));
  const generic = !!fEmail && fStatus === 'found_generic';
  const probable = !!fEmail && CATCH_ALL_FOUND.has(fStatus) && fConf === 'low';

  const scraped = () => ({ email: p.email, email_rule: p.rule, email_source: 'scraped', email_status: scrapedStatus, email_confidence: '', email_suggested: suggested });
  const found = rule => ({ email: fEmail, email_rule: rule, email_source: 'finder', email_status: fStatus, email_confidence: fConf, email_suggested: suggested });

  // Suppressed at this firm: the row goes, whatever else we scraped there.
  if (fStatus === 'suppressed') return { email: '', email_rule: 'suppressed', email_source: 'finder', email_status: 'suppressed', email_confidence: '', email_suggested: '' };
  if (scrapedStatus === 'scraped_owner') return scraped();
  if (personal) return found('finder-found');
  if (scrapedStatus === 'scraped_role') return scraped();
  if (generic) return found('finder-generic');
  if (scrapedStatus === 'scraped_staff') return scraped();
  if (probable) return found('finder-found');
  return { email: '', email_rule: p.rule || 'none', email_source: '', email_status: fStatus || 'not_found', email_confidence: fConf, email_suggested: suggested };
}

function decodeObfuscated(html) {
  if (!html) return [];
  const found = new Set();
  const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
  // Cloudflare email protection: first byte is the XOR key
  for (const m of html.matchAll(/(?:data-cfemail="|email-protection#)([0-9a-f]{4,})/gi)) {
    const hex = m[1]; const key = parseInt(hex.slice(0, 2), 16); let out = '';
    for (let i = 2; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    if (EMAIL.test(out)) found.add(out.toLowerCase());
    EMAIL.lastIndex = 0;
  }
  let text = html.replace(/&#0*64;|&#x0*40;|&commat;/gi, '@');
  text = text.replace(/mailto:([^"'>\s]+)/gi, (_, v) => { try { return 'mailto:' + decodeURIComponent(v); } catch (e) { return 'mailto:' + v; } });
  text = text.replace(/\s*[[({]\s*at\s*[\])}]\s*/gi, '@').replace(/\s*[[({]\s*dot\s*[\])}]\s*/gi, '.');
  for (const m of text.matchAll(EMAIL)) found.add(m[0].toLowerCase().replace(/\.$/, ''));
  return [...found];
}

module.exports = { pickBestEmail, resolveOwnerEmail, chooseOwnerEmail, isFreemailDomain, decodeObfuscated, ownerGuesses, nameVariants };
