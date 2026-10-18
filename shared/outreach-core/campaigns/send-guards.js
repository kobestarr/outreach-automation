// shared/outreach-core/campaigns/send-guards.js
// The last gates before an address reaches a sheet: where the ledgers live (pinned), do-not-contact,
// firm-level dedupe (one firm, one touch) and the company ledger. Pure functions plus tiny file readers.
const fs = require('fs'), path = require('path'), os = require('os');
const { isFreemailDomain } = require('../enrichment/owner-email');

// The live ledgers sit in the MAIN checkout (git-ignored). A worktree has its own stale copy of data/, so every
// ledger, do-not-contact and load file resolves from here instead of __dirname.
const DEFAULT_DATA_DIR = path.join(os.homedir(), 'Development/One Hour Vibe Coder/outreach-automation/data');
const ROUTE_RANK = { main: 0, inbox: 1, probable: 2 };
// Hosts that carry many unrelated firms: never a firm identity.
const PLATFORM_DOMAINS = ['facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'wixsite.com', 'wix.com',
  'squarespace.com', 'godaddysites.com', 'business.site', 'google.com', 'sites.google.com', 'linktr.ee', 'yell.com', 'checkatrade.com', 'trustpilot.com',
  'mybuilder.com', 'ratedpeople.com', 'bark.com', 'weebly.com', 'wordpress.com', 'blogspot.com', 'webs.com', 'jimdosite.com', 'carrd.co', 'ueniweb.com'];

function isWorktreeDir(repoDir) {
  try { return fs.statSync(path.join(repoDir, '.git')).isFile(); } catch { return false; }
}

function resolveDataDir({ env = process.env, repoDir = __dirname, dryRun = false, isWorktree = isWorktreeDir } = {}) {
  if (env.OA_DATA_DIR) return path.resolve(env.OA_DATA_DIR);
  if (!dryRun && isWorktree(repoDir)) {
    throw new Error(`Refusing a live run from a git worktree (${repoDir}): its data/ folder is a stale copy, so ledgers and the do-not-contact list would be wrong. ` +
      `Set OA_DATA_DIR to the data folder you mean (the live one is ${DEFAULT_DATA_DIR}) and run again.`);
  }
  return DEFAULT_DATA_DIR;
}

const lc = s => String(s == null ? '' : s).trim().toLowerCase();

function domainOf(v) {
  return lc(v).replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^[^@/]*@/, '').replace(/^www\./, '').split(/[/?#:]/)[0].replace(/\.$/, '');
}
const isPlatform = d => PLATFORM_DOMAINS.some(p => d === p || d.endsWith('.' + p));
/** A domain that identifies one firm: blank for free mail and for platforms that host many firms. */
function firmDomain(v) {
  const d = domainOf(v);
  return !d || isFreemailDomain(d) || isPlatform(d) ? '' : d;
}

// ---- do-not-contact: "email<TAB>reason", "@domain" or a bare domain; # comments ----
function readDoNotContact(file) {
  const emails = new Set(), domains = new Set();
  if (!fs.existsSync(file)) return { emails, domains };
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const token = lc(line.split(/\t/)[0].split(/\s+/)[0]);
    if (!token) continue;
    if (token.startsWith('@')) domains.add(token.slice(1));
    else if (token.includes('@')) emails.add(token);
    else domains.add(token);
  }
  return { emails, domains };
}

const inDomains = (set, d) => !!d && [...set].some(x => d === x || d.endsWith('.' + x));
/** Reason string if this lead's email, email domain or website domain is on the list, else null. */
function isDoNotContact(dnc, { email, website } = {}) {
  const e = lc(email);
  if (e && dnc.emails.has(e)) return 'do_not_contact_email';
  if (inDomains(dnc.domains, domainOf(e)) || inDomains(dnc.domains, domainOf(website))) return 'do_not_contact_domain';
  return null;
}

// ---- company ledger: company_number<TAB>domain, append-only ----
function readCompanyLedger(file) {
  const numbers = new Set(), domains = new Set();
  if (!fs.existsSync(file)) return { numbers, domains };
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [n, d] = line.split('\t');
    if (n && n.trim()) numbers.add(n.trim());
    if (d && d.trim()) domains.add(lc(d));
  }
  return { numbers, domains };
}

function appendCompanyLedger(file, entries) {
  const have = readCompanyLedger(file);
  const lines = [];
  for (const e of entries) {
    const n = String(e.company_number || '').trim(), d = lc(e.domain);
    if (!n && !d) continue;
    if ((!n || have.numbers.has(n)) && (!d || have.domains.has(d))) continue;
    lines.push(`${n}\t${d}`);
    if (n) have.numbers.add(n);
    if (d) have.domains.add(d);
  }
  if (!lines.length) return 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, lines.join('\n') + '\n');
  return lines.length;
}

/** Firm domains of every address already loaded (mailead-loaded-*.txt) or sent (sent-ledger.txt). Freemail excluded. */
function loadedDomains(dataDir) {
  const out = new Set();
  if (!fs.existsSync(dataDir)) return out;
  for (const f of fs.readdirSync(dataDir)) {
    if (!(/^mailead-loaded-.*\.txt$/.test(f) || f === 'sent-ledger.txt')) continue;
    for (const line of fs.readFileSync(path.join(dataDir, f), 'utf8').split(/\r?\n/)) {
      const d = firmDomain(line.trim().split(/\s+/)[0]);
      if (d && line.includes('@')) out.add(d);
    }
  }
  return out;
}

/** Writes the loaded domains into the company ledger (idempotent). Returns how many lines were added. */
function seedCompanyLedger(dataDir) {
  return appendCompanyLedger(path.join(dataDir, 'company-ledger.txt'), [...loadedDomains(dataDir)].map(domain => ({ company_number: '', domain })));
}

/** Everything that counts as "this firm was already touched": the ledger plus domains of loaded emails. */
function firmContext(dataDir) {
  const l = readCompanyLedger(path.join(dataDir, 'company-ledger.txt'));
  for (const d of loadedDomains(dataDir)) l.domains.add(d);
  return { companyNumbers: l.numbers, domains: l.domains };
}

function firmSeen(ctx, lead) {
  const n = String((lead.ref && lead.ref.company_number) || '').trim();
  if (n && ctx.companyNumbers.has(n)) return 'firm_already_loaded_company_number';
  const d = firmDomain(lead.website);
  if (d && ctx.domains.has(d)) return 'firm_already_loaded_domain';
  return null;
}

/** One touch per firm within a file: same website domain or same company number. Best route wins, then file order. */
function dedupeFirms(items) {
  const order = items.map((it, i) => ({ it, i })).sort((a, b) => (ROUTE_RANK[a.it.route] - ROUTE_RANK[b.it.route]) || (a.i - b.i));
  const seenNum = new Set(), seenDom = new Set();
  const keep = new Set(), dropped = [];
  for (const { it, i } of order) {
    const n = String((it.lead.ref && it.lead.ref.company_number) || '').trim();
    const d = firmDomain(it.lead.website);
    if ((n && seenNum.has(n)) || (d && seenDom.has(d))) { dropped.push({ email: it.lead.email, reason: 'firm_dupe_in_file' }); continue; }
    if (n) seenNum.add(n);
    if (d) seenDom.add(d);
    keep.add(i);
  }
  return { kept: items.filter((_, i) => keep.has(i)), dropped };
}

module.exports = { DEFAULT_DATA_DIR, resolveDataDir, isWorktreeDir, readDoNotContact, isDoNotContact, domainOf, firmDomain,
  readCompanyLedger, appendCompanyLedger, loadedDomains, seedCompanyLedger, firmContext, firmSeen, dedupeFirms, PLATFORM_DOMAINS };
