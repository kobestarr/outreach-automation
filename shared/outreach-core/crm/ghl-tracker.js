/**
 * ghl-tracker.js: the GHL tracking layer for cold-email replies.
 *
 * Architecture rule: Mailead sends, GHL tracks (single record, never sends), Buzz notifies.
 * One pipeline "Cold Email" per brand sub-account (Kobestarr, Stripped Media, Dealflow Media).
 *
 * API sources (HighLevel API v2 docs, read 18 Oct 2026):
 *   Base https://services.leadconnectorhq.com ; header Version 2021-07-28 (docs label it "v3").
 *   Get pipelines   GET  /opportunities/pipelines?locationId=
 *     https://marketplace.gohighlevel.com/docs/ghl/opportunities/get-pipelines
 *   Create pipeline POST /opportunities/pipelines {name, stages} (CAN be created by API; scopes not listed on the page;
 *     docs type `stages` as string[] but the example uses {name, position, showInFunnel} objects with position from 1)
 *     https://marketplace.gohighlevel.com/docs/ghl/opportunities/create-pipeline
 *   Upsert contact  POST /contacts/upsert (tags OVERWRITE existing tags, so tags are added separately)
 *     https://marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact
 *   Add tags        POST /contacts/:id/tags {tags}
 *     https://marketplace.gohighlevel.com/docs/ghl/contacts/add-tags
 *   Find by email   GET  /contacts/search/duplicate?locationId=&email=
 *     https://marketplace.gohighlevel.com/docs/ghl/contacts/get-duplicate-contact
 *   Search opps     GET  /opportunities/search?locationId&pipelineId&contactId&status(open|won|lost|abandoned|all)&limit
 *     https://marketplace.gohighlevel.com/docs/ghl/opportunities/search-opportunity
 *   Create opp      POST /opportunities/ {pipelineId, locationId, name, status, contactId, pipelineStageId}
 *     https://marketplace.gohighlevel.com/docs/ghl/opportunities/create-opportunity
 *   Update opp      PUT  /opportunities/:id {pipelineStageId, status}
 *     https://marketplace.gohighlevel.com/docs/ghl/opportunities/update-opportunity
 *   Notes           POST|GET /contacts/:id/notes
 *     https://marketplace.gohighlevel.com/docs/ghl/contacts/create-note
 *   Location        GET /locations/:id (identity guard)
 *   Rate limits: 100 requests per 10 s and 200,000 per day per app per resource
 *     https://marketplace.gohighlevel.com/docs/other/rate-limits   (429 handling is not documented: we back off)
 *
 * Transport (Kobi's preference, 18 Oct 2026): the LeadGen Jay GHL CLI (gohighlevel-cli/ghlp <profile>) is used for every
 * operation it covers, via an injected exec. Raw fetch is used ONLY for the gaps (CLI_GAPS):
 *   CLI : list pipelines, create opp, update opp, get opp, add tags, locations get
 *   fetch: create pipeline, contact upsert, find contact by email, get contact, notes read/write, deal search
 *          (the CLI cannot filter by contact or take status=all)
 *
 * Safety rules (round 2): identity guard before any call, POST retried only on 429 (5xx/timeouts re-read first),
 * shared throttle under 100 req / 10 s, per brand+email lock (in-process queue + file lock), tokens redacted everywhere.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');

const BASE_URL = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
const PIPELINE_NAME = 'Cold Email';
const STAGES = ['Replied', 'Interested', 'Call booked', 'Proposal sent', 'Won', 'Not now', 'Lost'];
const BRANDS = ['kobestarr', 'stripped', 'dealflow'];
const DEFAULT_LOCATIONS = { kobestarr: 'r0zUXIn2l7A8zjR3nPmD', stripped: 'HZxQ2NMNDVGkqkpOeXru', dealflow: 'DOVRoZsKe13gs64zmpF5' };
const BRAND_NAME_RE = { kobestarr: /kobestarr/i, stripped: /stripped/i, dealflow: /deal\s*flow/i };
const BRAND_DOMAINS = {
  kobestarr: ['kobestarrdigital.com', 'kobestarr.digital', 'trykobestarrdigital.com'],
  stripped: ['strippedmedia.co.uk', 'strippedmedia.org', 'gostripped.media'],
  dealflow: ['dealflowmedia.co', 'dealflowmedia.pro', 'dealflowmedia.group'],
};
const LABEL_STAGE = { warm: 'Interested', maybe: 'Replied', referral: 'Replied', no: 'Lost', left_company: 'Lost', unread: 'Replied' };
const KNOWN_LABELS = [...Object.keys(LABEL_STAGE), 'auto'];
const TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 4;
const NOTE_MAX = 1500;
const CACHE_TTL_MS = 10 * 60 * 1000;
const THROTTLE_MAX = 90; // GHL burst limit is 100 per 10 s per app per resource
const THROTTLE_WINDOW_MS = 10000;
// Cold Email order. Not now is a parking stage (rank 0, revivable). Lost/Won are terminal.
const RANK = { Replied: 0, 'Not now': 0, Interested: 1, 'Call booked': 2, 'Proposal sent': 3, Won: 4, Lost: 5 };
const AUTO_LOST_FROM = ['Replied', 'Interested', 'Not now'];
const CLI_GAPS = ['POST /opportunities/pipelines', 'POST /contacts/upsert', 'GET /contacts/search/duplicate', 'GET /contacts/:id',
  'GET|POST /contacts/:id/notes', 'GET /opportunities/search'];

/** Brand for a sending mailbox, or null when the domain is not one of ours. Never guesses. */
function brandForMailbox(addr) {
  const m = String(addr || '').toLowerCase().match(/@([a-z0-9.-]+)/);
  const domain = m ? m[1].replace(/[>\s].*$/, '') : '';
  if (!domain) return null;
  for (const [brand, list] of Object.entries(BRAND_DOMAINS)) {
    if (list.some((d) => domain === d || domain.endsWith('.' + d))) return brand;
  }
  return null;
}

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function readEnvFile(p) {
  const o = {};
  try { for (const l of fs.readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch { /* no env file */ }
  return o;
}
const stripBearer = (t) => String(t || '').replace(/^Bearer\s+/i, '').trim();

/**
 * Vault ghl.<brand> first, then ~/.claude.json mcpServers.ghl-<brand>, then the CLI's .env.<brand>.
 * Token and location always come from the SAME source (a source without a location uses the known default, and the
 * identity guard then proves it). Returns { brand: {token, locationId, source} }.
 */
function loadGhlCreds({ vaultPath, claudeJsonPath, cliDir } = {}) {
  const vault = readJson(vaultPath || path.join(os.homedir(), '.credentials', 'api-keys.json')) || {};
  const claude = readJson(claudeJsonPath || path.join(os.homedir(), '.claude.json')) || {};
  const out = {};
  for (const brand of BRANDS) {
    const v = vault.ghl && vault.ghl[brand];
    const vObj = typeof v === 'string' ? { token: v } : (v || {});
    const h = (claude.mcpServers && claude.mcpServers['ghl-' + brand] && claude.mcpServers['ghl-' + brand].headers) || {};
    const env = cliDir ? readEnvFile(path.join(cliDir, '.env.' + brand)) : {};
    const sources = [
      ['vault', stripBearer(vObj.token || vObj.private_integration_token || vObj.pit), vObj.location_id || vObj.locationId],
      ['mcp', stripBearer(h.Authorization || h.authorization), h.locationId],
      ['cli-env', stripBearer(env.GHL_API_KEY), env.GHL_LOCATION_ID],
    ];
    const hit = sources.find((x) => x[1]);
    if (hit) out[brand] = { token: hit[1], locationId: hit[2] || DEFAULT_LOCATIONS[brand], source: hit[0] };
  }
  return out;
}

function trimText(t, n) {
  const s = String(t || '').trim();
  return s.length > n ? s.slice(0, n) + ' [trimmed]' : s;
}

/** Sliding-window limiter shared by every request in the process (all brands). */
function createThrottle({ max = THROTTLE_MAX, windowMs = THROTTLE_WINDOW_MS, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const stamps = [];
  return async function acquire() {
    for (;;) {
      const t = now();
      while (stamps.length && t - stamps[0] >= windowMs) stamps.shift();
      if (stamps.length < max) { stamps.push(t); return; }
      await sleep(Math.max(1, stamps[0] + windowMs - t));
    }
  };
}
const sharedThrottle = createThrottle();

/** HTTP status from a CLI failure message ("API Error (429): ...", "429 Client Error", "HTTP 503"). Not any number. */
function statusFromCliError(msg) {
  const m = String(msg).match(/\bAPI Error \((\d{3})\)/i) || String(msg).match(/\b(\d{3})\s+(?:Client|Server)\s+Error\b/i)
    || String(msg).match(/\b(?:HTTP(?:\/[\d.]+)?|status(?:\s*code)?|Error)\s*[:=]?\s*(\d{3})\b/i);
  return m ? Number(m[1]) : undefined;
}

/** Real CLI transport (ghlp), or undefined when the CLI is not installed. */
function makeDefaultCli(cliDir = process.env.GHL_CLI_DIR || path.join(os.homedir(), 'Development', 'One Hour Vibe Coder', 'gohighlevel-cli')) {
  const ghlp = path.join(cliDir, 'ghlp');
  if (!fs.existsSync(ghlp)) return undefined;
  return { exec: promisify(require('child_process').execFile), ghlp, dir: cliDir };
}

function createGhlTracker({
  fetch = global.fetch, creds, log = () => {}, dryRun = false, sleep, baseUrl = BASE_URL, version = API_VERSION, cli,
  throttle = sharedThrottle, now = Date.now, lockDir, lockTimeoutMs = 30000,
} = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const credMap = creds || loadGhlCreds();
  const pipeCache = {};
  const verified = {};
  const queues = new Map();

  function redact(str) {
    let s = String(str).replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer [token]').replace(/\bpit-[\w-]+/g, '[token]');
    for (const c of Object.values(credMap)) if (c && c.token && c.token.length >= 4) s = s.split(c.token).join('[token]');
    return s;
  }
  function credsFor(brand, { needToken = !cli } = {}) {
    const c = credMap[brand];
    if (cli && !needToken) return { token: c && c.token, locationId: (c && c.locationId) || DEFAULT_LOCATIONS[brand] };
    if (!c || !c.token) throw new Error(`No GHL credentials for brand "${brand}" (vault ghl.${brand}, ~/.claude.json ghl-${brand} or the CLI .env.${brand})`);
    return { token: c.token, locationId: c.locationId || DEFAULT_LOCATIONS[brand] };
  }

  // ---- transport: one attempt, CLI first, fetch for gaps --------------------------------------------------------
  function cliArgs(method, p, body = {}) {
    let m;
    if (method === 'GET' && p === '/opportunities/pipelines') return ['opportunities', 'pipelines'];
    if (method === 'GET' && (m = p.match(/^\/opportunities\/([^/]+)$/)) && !['search', 'pipelines'].includes(m[1])) return ['opportunities', 'get', m[1]];
    if (method === 'POST' && p === '/opportunities/') {
      return ['opportunities', 'create', '--pipeline-id', body.pipelineId, '--stage-id', body.pipelineStageId, '--name', body.name,
        '--contact-id', body.contactId, '--status', body.status || 'open'];
    }
    if (method === 'PUT' && (m = p.match(/^\/opportunities\/([^/]+)$/)) && m[1] !== 'pipelines') {
      const a = ['opportunities', 'update', m[1]];
      if (body.pipelineStageId) a.push('--stage-id', body.pipelineStageId);
      if (body.status) a.push('--status', body.status);
      return a;
    }
    if (method === 'POST' && (m = p.match(/^\/contacts\/([^/]+)\/tags$/))) return ['contacts', 'add-tag', m[1], ...body.tags];
    if (method === 'GET' && p.startsWith('/locations/')) return ['locations', 'get'];
    return null;
  }
  const parseJsonOut = (out) => { const at = String(out).indexOf('{'); if (at < 0) return {}; return JSON.parse(String(out).slice(at)); };

  async function attempt(brand, method, p, query, body, forceFetch = false) {
    const args = cli && !forceFetch && cliArgs(method, p, body);
    if (args) {
      try {
        const r = await cli.exec(cli.ghlp, [brand, '--json', ...args], { timeout: TIMEOUT_MS });
        try { return { ok: true, json: parseJsonOut(r && r.stdout) }; } catch { return { ok: false, message: 'unreadable CLI output' }; }
      } catch (e) {
        const msg = redact((e && (e.stderr || e.message)) || e);
        if (e && (e.killed || e.code === 'ETIMEDOUT')) return { ok: false, timeout: true, message: 'timed out' };
        return { ok: false, status: statusFromCliError(msg), message: msg.slice(0, 200), via: 'CLI ' };
      }
    }
    const { token } = credsFor(brand, { needToken: true });
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(baseUrl + p + qs, {
        method, signal: ctrl.signal,
        headers: { Authorization: `Bearer ${token}`, Version: version, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      return e && e.name === 'AbortError' ? { ok: false, timeout: true, message: 'timed out' } : { ok: false, network: true, message: redact(`network error: ${e && e.message}`) };
    } finally { clearTimeout(timer); }
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (res.ok) return { ok: true, json: json || {} };
    const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
    return { ok: false, status: res.status, retryAfterMs: ra > 0 ? ra * 1000 : undefined,
      message: redact(String((json && (json.message || json.error)) || text).slice(0, 200)) };
  }

  /**
   * Retry policy. 429: retry any method (Retry-After honoured). 5xx / timeout / network: GET retries; a write first
   * calls `reread()` (did it land?) and only retries when the re-read says it did not. Other 4xx: fail at once.
   */
  async function request(brand, method, p, { query, body, reread, forceFetch } = {}) {
    let last;
    for (let n = 1; n <= MAX_ATTEMPTS; n++) {
      await throttle();
      const r = await attempt(brand, method, p, query, body, forceFetch);
      if (r.ok) return r.json;
      const label = `GHL ${r.via || ''}${method} ${p}`;
      last = new Error(r.timeout ? `${label} timed out after ${TIMEOUT_MS / 1000}s` : `${label} failed${r.status ? ' with ' + r.status : ''}: ${r.message}`);
      last.status = r.status;
      const backoff = r.retryAfterMs || 500 * 2 ** (n - 1);
      if (r.status === 429) { if (n < MAX_ATTEMPTS) { log(`${label} 429, waiting ${backoff} ms`); await wait(backoff); continue; } throw last; }
      const transient = r.timeout || r.network || r.status >= 500;
      if (!transient || n === MAX_ATTEMPTS) throw last;
      if (method !== 'GET') {
        if (!reread) throw last;
        let seen; try { seen = await reread(); } catch { seen = undefined; }
        if (seen !== undefined && seen !== null) return seen;
      }
      await wait(backoff);
    }
    throw last;
  }

  // ---- identity guard -------------------------------------------------------------------------------------------
  async function verifyBrand(brand) {
    if (verified[brand]) return verified[brand];
    const { locationId, token } = credsFor(brand, { needToken: false });
    const readLoc = async (j) => { const l = (j && j.location) || j || {}; return { id: l.id || l._id, name: l.name || l.businessName || '' }; };
    const seen = [];
    if (token) seen.push(['API', await readLoc(await request(brand, 'GET', `/locations/${locationId}`, { forceFetch: true }).catch((e) => { throw new Error(`Identity check failed for ${brand}: ${e.message}`); }))]);
    if (cli) seen.push(['CLI', await readLoc(await request(brand, 'GET', `/locations/${locationId}`).catch((e) => { throw new Error(`Identity check failed for ${brand}: ${e.message}`); }))]);
    if (!seen.length) throw new Error(`Identity check failed for ${brand}: no way to read the location`);
    for (const [via, l] of seen) {
      if (l.id !== locationId) throw new Error(`Identity check failed for ${brand}: ${via} returned location ${l.id}, expected ${locationId}. Refusing all writes for ${brand}.`);
      if (!BRAND_NAME_RE[brand].test(l.name)) throw new Error(`Identity check failed for ${brand}: ${via} location is named "${l.name}". Refusing all writes for ${brand}.`);
    }
    return (verified[brand] = { locationId, name: seen[0][1].name });
  }

  // ---- pipelines ------------------------------------------------------------------------------------------------
  async function listPipelines(brand) {
    const { locationId } = credsFor(brand, { needToken: false });
    return (await request(brand, 'GET', '/opportunities/pipelines', { query: { locationId } })).pipelines || [];
  }
  function findNamed(list, name, brand) {
    const hits = list.filter((p) => String(p.name).toLowerCase() === name.toLowerCase());
    if (hits.length > 1) throw new Error(`Two pipelines named "${name}" in the ${brand} sub-account. Delete or rename one in GHL, nothing was changed.`);
    return hits[0];
  }
  function checkPipeline(p) {
    const names = (p.stages || []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((s) => s.name);
    if (names.join('|') === STAGES.join('|')) return { ok: true };
    const missing = STAGES.filter((s) => !names.includes(s));
    const extra = names.filter((s) => !STAGES.includes(s));
    const parts = [];
    if (missing.length) parts.push(`missing stages: ${missing.join(', ')}`);
    if (extra.length) parts.push(`unexpected stages: ${extra.join(', ')}`);
    if (!missing.length && !extra.length) parts.push(`stage order is ${names.join(' > ')}`);
    return { ok: false, detail: parts.join('; ') };
  }
  async function getPipeline(brand, name = PIPELINE_NAME) {
    const key = brand + ':' + name.toLowerCase();
    const c = pipeCache[key];
    if (c && now() - c.at < CACHE_TTL_MS) return c.value;
    const p = findNamed(await listPipelines(brand), name, brand);
    if (!p) throw new Error(`No "${name}" pipeline in the ${brand} sub-account. Run: node ghl-setup.js --apply`);
    const stages = (p.stages || []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const value = { id: p.id, name: p.name, byName: {}, byId: {}, pos: {}, names: stages.map((s) => s.name) };
    stages.forEach((s, i) => { value.byName[s.name.toLowerCase()] = s.id; value.byId[s.id] = s.name; value.pos[s.name] = i; });
    pipeCache[key] = { at: now(), value };
    return value;
  }
  function stageId(pl, name) {
    const id = pl.byName[String(name).toLowerCase()];
    if (!id) throw new Error(`Stage "${name}" not found in the ${pl.name} pipeline (stages: ${pl.names.join(', ')})`);
    return id;
  }
  const rankOf = (pl, stage) => (pl.name === PIPELINE_NAME ? (RANK[stage] ?? 0) : (pl.pos[stage] ?? 0));
  function canMove(pl, cur, tgt) {
    if (cur === tgt || cur === 'Won' || cur === 'Lost') return false;
    if (pl.name === PIPELINE_NAME && (tgt === 'Lost' || tgt === 'Not now')) return true;
    return rankOf(pl, tgt) > rankOf(pl, cur);
  }

  // ---- deals ----------------------------------------------------------------------------------------------------
  const score = (o, pl) => (o.status === 'won' ? 100 : o.status === 'open' ? 10 + rankOf(pl, pl.byId[o.pipelineStageId]) : o.status === 'lost' ? 1 : 0);
  async function findDeals(brand, pl, contactId) {
    const { locationId } = credsFor(brand, { needToken: false });
    const r = await request(brand, 'GET', '/opportunities/search', { query: { locationId, pipelineId: pl.id, contactId, status: 'all', limit: '100' } });
    const mine = (r.opportunities || []).filter((o) => o.pipelineId === pl.id && (o.contactId === contactId || (o.contact && o.contact.id === contactId)));
    return mine.sort((a, b) => score(b, pl) - score(a, pl));
  }
  async function setStage(brand, pl, opp, stage, status) {
    const body = { pipelineStageId: stageId(pl, stage), status };
    await request(brand, 'PUT', `/opportunities/${opp.id}`, { body, reread: async () => {
      const o = (await request(brand, 'GET', `/opportunities/${opp.id}`)).opportunity;
      return o && o.pipelineStageId === body.pipelineStageId && o.status === status ? { opportunity: o } : undefined;
    } });
  }
  async function createDeal(brand, pl, contactId, name, stage, status) {
    const { locationId } = credsFor(brand, { needToken: false });
    const body = { pipelineId: pl.id, locationId, name, status, contactId, pipelineStageId: stageId(pl, stage) };
    const r = await request(brand, 'POST', '/opportunities/', { body, reread: async () => {
      const d = (await findDeals(brand, pl, contactId))[0];
      return d ? { opportunity: d } : undefined;
    } });
    return r.opportunity || r;
  }

  // ---- locking: in-process queue + file lock (VPS and Mac runs cannot race) ------------------------------------
  const lockPath = (key) => path.join(lockDir || path.join(os.homedir(), '.config', 'outreach-alerts', 'ghl-locks'), crypto.createHash('sha1').update(key).digest('hex') + '.lock');
  async function acquireFile(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const start = Date.now();
    for (;;) {
      try { const fd = fs.openSync(file, 'wx'); fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}`); fs.closeSync(fd); return; } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        try { if (Date.now() - fs.statSync(file).mtimeMs > 60000) { fs.unlinkSync(file); continue; } } catch { continue; }
        if (Date.now() - start > lockTimeoutMs) throw new Error(`Could not get the GHL lock for this contact within ${lockTimeoutMs / 1000}s (another run is working on it)`);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }
  async function withLock(key, fn) {
    const prev = queues.get(key) || Promise.resolve();
    let release; const mine = new Promise((r) => { release = r; });
    const tail = prev.then(() => mine);
    queues.set(key, tail);
    const done = () => { release(); tail.then(() => { if (queues.get(key) === tail) queues.delete(key); }); };
    await prev;
    const file = lockPath(key);
    try { await acquireFile(file); } catch (e) { done(); throw e; }
    try { return await fn(); } finally { try { fs.unlinkSync(file); } catch { /* gone */ } done(); }
  }

  const cleanEmail = (e) => String(e || '').trim().toLowerCase();
  const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
  async function upsertContact(brand, locationId, email, firstName, company) {
    const find = async () => { const r = await request(brand, 'GET', '/contacts/search/duplicate', { query: { locationId, email } }); const c = r.contact || (r.contacts && r.contacts[0]); return c ? { contact: c } : undefined; };
    const up = await request(brand, 'POST', '/contacts/upsert', { body: {
      locationId, email, ...(firstName ? { firstName } : {}), ...(company ? { companyName: company } : {}), source: 'cold-email',
    }, reread: find });
    const id = up.contact && (up.contact.id || up.contact._id);
    if (!id) throw new Error('GHL upsert returned no contact id');
    return id;
  }
  async function addTags(brand, contactId, tags) {
    await request(brand, 'POST', `/contacts/${contactId}/tags`, { body: { tags }, reread: async () => {
      const c = (await request(brand, 'GET', `/contacts/${contactId}`)).contact || {};
      return tags.every((t) => (c.tags || []).includes(t)) ? { tags: c.tags } : undefined;
    } });
  }
  async function addNote(brand, contactId, text, marker) {
    await request(brand, 'POST', `/contacts/${contactId}/notes`, { body: { body: text }, reread: async () => {
      const n = (await request(brand, 'GET', `/contacts/${contactId}/notes`)).notes || [];
      return n.some((x) => String(x.body || '').includes(marker)) ? { note: true } : undefined;
    } });
  }

  async function trackReply(e) {
    e = e || {};
    const label = String(e.label || '').trim().toLowerCase();
    if (label === 'auto') return { action: 'skipped', skipped: 'auto', reason: 'auto replies are not tracked' };
    const email = cleanEmail(e.email);
    if (!validEmail(email)) throw new Error('trackReply needs a valid email');
    let brand;
    if (e.brand) { brand = String(e.brand).toLowerCase(); if (!BRANDS.includes(brand)) return { skipped: 'unknown_brand', reason: `unknown brand "${e.brand}"` }; }
    else brand = brandForMailbox(e.mailbox);
    if (!brand) return { skipped: 'unknown_brand', reason: `mailbox "${e.mailbox || ''}" is not one of our sending domains` };
    const known = KNOWN_LABELS.includes(label);
    const target = LABEL_STAGE[label] || null;
    const tags = ['cold-email', ...(e.campaign ? [`campaign:${e.campaign}`] : []), `brand:${brand}`];
    if (dryRun) return { dryRun: true, brand, stage: target, tags, email };

    return withLock(`${brand}:${email}`, async () => {
      await verifyBrand(brand);
      const { locationId } = credsFor(brand, { needToken: false });
      const contactId = await upsertContact(brand, locationId, email, e.firstName, e.company);

      const ref = crypto.createHash('sha1').update([email, e.date, label, e.text].join('|')).digest('hex').slice(0, 10);
      const marker = `[ref:${ref}]`;
      const notes = (await request(brand, 'GET', `/contacts/${contactId}/notes`)).notes || [];
      if (notes.some((n) => String(n.body || '').includes(marker))) {
        return { brand, contactId, stage: target, created: false, moved: false, noteAdded: false, duplicate: true };
      }
      await addTags(brand, contactId, tags);

      const res = { brand, contactId, stage: target, created: false, moved: false, reopened: false, noteAdded: false };
      const lines = [`Cold email reply (${label || 'no label'})`, `Date: ${e.date || new Date().toISOString().slice(0, 10)}`];
      if (e.campaign) lines.push(`Campaign: ${e.campaign}`);
      if (e.mailbox) lines.push(`Mailbox: ${e.mailbox}`);
      if (!known) lines.push(`Unrecognised label "${label}": note only, no stage change`);

      if (target) {
        const pl = await getPipeline(brand);
        const name = `${e.company || e.firstName || email} - Cold Email`;
        let deals = await findDeals(brand, pl, contactId);
        let deal = deals[0];
        if (!deal) {
          deal = await createDeal(brand, pl, contactId, name, target, target === 'Lost' ? 'lost' : 'open');
          res.created = true;
          deals = await findDeals(brand, pl, contactId); // race check: keep the most advanced
          if (deals.length > 1) { deal = deals[0]; res.duplicateDeals = deals.length - 1; res.created = false; }
        } else {
          const cur = pl.byId[deal.pipelineStageId];
          if (deal.status === 'won') { res.stage = 'Won'; lines.push('Deal already Won: note only'); }
          else if (deal.status === 'lost' || deal.status === 'abandoned') {
            res.stage = cur;
            if (label === 'warm') { await setStage(brand, pl, deal, 'Interested', 'open'); res.stage = 'Interested'; res.reopened = true; res.moved = true; lines.push('Deal was Lost: reopened at Interested'); }
            else lines.push('Deal is Lost: note only');
          } else if (target === 'Lost') {
            if (AUTO_LOST_FROM.includes(cur)) { await setStage(brand, pl, deal, 'Lost', 'lost'); res.stage = 'Lost'; res.moved = true; }
            else { res.stage = cur; res.needsReview = true; lines.push(`NEEDS REVIEW: they said no but the deal is at ${cur}. Not moved to Lost automatically.`); }
          } else if (canMove(pl, cur, target)) { await setStage(brand, pl, deal, target, 'open'); res.moved = true; }
          else res.stage = cur;
        }
        res.opportunityId = deal.id;
        if (res.stage === 'Lost' && label === 'no') lines.push('Lost reason: not interested (replied no)');
        if (res.stage === 'Lost' && label === 'left_company') lines.push('Lost reason: contact has left the company');
      }
      if (label === 'referral') lines.push(`Referral: ${e.referral || 'named in the reply, see text'}`);
      if (res.needsReview) await addTags(brand, contactId, ['needs-review']);
      lines.push('', label === 'unread' ? 'Reply in Mailead Unibox, text not captured' : trimText(e.text, NOTE_MAX), '', marker);
      await addNote(brand, contactId, lines.join('\n'), marker);
      res.noteAdded = true;
      return res;
    });
  }

  /** Move a deal. `pipeline` defaults to Cold Email; forward only unless allowBackwards; reopening a closed deal needs allowBackwards. */
  async function moveStage(email, brand, stageName, { pipeline = PIPELINE_NAME, allowBackwards = false } = {}) {
    if (!BRANDS.includes(brand)) throw new Error(`Unknown brand "${brand}"`);
    const addr = cleanEmail(email);
    if (dryRun) return { dryRun: true, brand, stage: stageName, pipeline };
    return withLock(`${brand}:${addr}`, async () => {
      await verifyBrand(brand);
      const pl = await getPipeline(brand, pipeline);
      const canonical = pl.names.find((s) => s.toLowerCase() === String(stageName).toLowerCase());
      if (!canonical) throw new Error(`Unknown stage "${stageName}" in ${pipeline}. Stages: ${pl.names.join(', ')}`);
      const { locationId } = credsFor(brand, { needToken: false });
      const r = await request(brand, 'GET', '/contacts/search/duplicate', { query: { locationId, email: addr } });
      const c = r.contact || (r.contacts && r.contacts[0]);
      if (!c) return { moved: false, reason: 'no contact with that email' };
      const deals = await findDeals(brand, pl, c.id);
      const opp = deals[0];
      if (!opp) return { moved: false, reason: `no ${pipeline} deal for that contact` };
      const cur = pl.byId[opp.pipelineStageId];
      const closed = opp.status === 'won' || opp.status === 'lost';
      const ok = allowBackwards ? (cur !== canonical || closed) : (!closed && canMove(pl, cur, canonical));
      if (!ok) return { moved: false, reason: closed ? `deal is ${opp.status}` : `deal is at ${cur}`, stage: cur, opportunityId: opp.id };
      await setStage(brand, pl, opp, canonical, canonical === 'Won' ? 'won' : canonical === 'Lost' ? 'lost' : 'open');
      return { moved: true, stage: canonical, opportunityId: opp.id };
    });
  }

  async function ensurePipelines({ dryRun: dry = dryRun, brands = BRANDS } = {}) {
    const out = [];
    for (const brand of brands) {
      if (!cli && (!credMap[brand] || !credMap[brand].token)) { out.push({ brand, status: 'no_credentials' }); continue; }
      let who = {};
      try {
        who = await verifyBrand(brand);
        const found = findNamed(await listPipelines(brand), PIPELINE_NAME, brand);
        const base = { brand, locationId: who.locationId, locationName: who.name };
        if (found) {
          const c = checkPipeline(found);
          out.push(c.ok ? { ...base, status: 'ok', pipelineId: found.id } : { ...base, status: 'mismatch', pipelineId: found.id, detail: c.detail });
          continue;
        }
        if (dry) { out.push({ ...base, status: 'would_create', stages: STAGES }); continue; }
        const { locationId } = credsFor(brand, { needToken: false });
        const reread = async () => { const p = findNamed(await listPipelines(brand), PIPELINE_NAME, brand); return p ? { pipeline: p } : undefined; };
        await request(brand, 'POST', '/opportunities/pipelines', { body: {
          locationId, name: PIPELINE_NAME, stages: STAGES.map((name, i) => ({ name, position: i + 1, showInFunnel: true })),
        }, reread });
        for (const k of Object.keys(pipeCache)) if (k.startsWith(brand + ':')) delete pipeCache[k];
        const made = findNamed(await listPipelines(brand), PIPELINE_NAME, brand);
        const c = made ? checkPipeline(made) : { ok: false, detail: 'created but not visible on re-read' };
        out.push(c.ok ? { ...base, status: 'created', pipelineId: made.id } : { ...base, status: 'mismatch', pipelineId: made && made.id, detail: c.detail });
      } catch (err) {
        out.push({ brand, status: 'error', detail: err.message, ...(who.locationId ? { locationId: who.locationId, locationName: who.name } : {}) });
      }
    }
    return out;
  }

  return { trackReply, moveStage, ensurePipelines, brandForMailbox, checkPipeline, verifyBrand };
}

module.exports = {
  createGhlTracker, loadGhlCreds, brandForMailbox, createThrottle, makeDefaultCli, statusFromCliError,
  STAGES, BRANDS, PIPELINE_NAME, DEFAULT_LOCATIONS, CLI_GAPS,
};
