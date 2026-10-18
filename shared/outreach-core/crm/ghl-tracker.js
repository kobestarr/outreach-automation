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
 *     the docs type `stages` as string[] but the example uses {name, position, showInFunnel} objects, we send objects)
 *     https://marketplace.gohighlevel.com/docs/ghl/opportunities/create-pipeline
 *   Upsert contact  POST /contacts/upsert (tags OVERWRITE existing tags, so tags are added separately)
 *     https://marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact
 *   Add tags        POST /contacts/:id/tags {tags}
 *     https://marketplace.gohighlevel.com/docs/ghl/contacts/add-tags
 *   Find by email   GET  /contacts/search/duplicate?locationId=&email=
 *     https://marketplace.gohighlevel.com/docs/ghl/contacts/get-duplicate-contact
 *   Search opps     GET  /opportunities/search?locationId&pipelineId&contactId&status&limit
 *     https://marketplace.gohighlevel.com/docs/ghl/opportunities/search-opportunity
 *   Create opp      POST /opportunities/ {pipelineId, locationId, name, status, contactId, pipelineStageId}
 *     https://marketplace.gohighlevel.com/docs/ghl/opportunities/create-opportunity
 *   Update opp      PUT  /opportunities/:id {pipelineStageId, status}
 *     https://marketplace.gohighlevel.com/docs/ghl/opportunities/update-opportunity
 *   Notes           POST|GET /contacts/:id/notes
 *     https://marketplace.gohighlevel.com/docs/ghl/contacts/create-note
 *   Rate limits: 100 requests per 10 s and 200,000 per day per app per resource
 *     https://marketplace.gohighlevel.com/docs/other/rate-limits   (429 handling is not documented: we back off)
 *
 * Tokens are never logged or put in error messages.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE_URL = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
const PIPELINE_NAME = 'Cold Email';
const STAGES = ['Replied', 'Interested', 'Call booked', 'Proposal sent', 'Won', 'Not now', 'Lost'];
const BRANDS = ['kobestarr', 'stripped', 'dealflow'];
const DEFAULT_LOCATIONS = { kobestarr: 'r0zUXIn2l7A8zjR3nPmD', stripped: 'HZxQ2NMNDVGkqkpOeXru', dealflow: 'DOVRoZsKe13gs64zmpF5' };
const BRAND_DOMAINS = {
  kobestarr: ['kobestarrdigital.com', 'kobestarr.digital', 'trykobestarrdigital.com'],
  stripped: ['strippedmedia.co.uk', 'strippedmedia.org', 'gostripped.media'],
  dealflow: ['dealflowmedia.co', 'dealflowmedia.pro', 'dealflowmedia.group'],
};
const LABEL_STAGE = { warm: 'Interested', maybe: 'Replied', referral: 'Replied', no: 'Lost', left_company: 'Lost' };
const TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 4;
const NOTE_MAX = 1500;
// forward-only order; Not now is a parking stage (rank 0, can be revived); Lost handled specially
const RANK = { Replied: 0, 'Not now': 0, Interested: 1, 'Call booked': 2, 'Proposal sent': 3, Won: 4, Lost: 5 };

function brandForMailbox(addr) {
  const m = String(addr || '').toLowerCase().match(/@([a-z0-9.-]+)/);
  const domain = m ? m[1].replace(/[>\s].*$/, '') : '';
  for (const [brand, list] of Object.entries(BRAND_DOMAINS)) {
    if (list.some((d) => domain === d || domain.endsWith('.' + d))) return brand;
  }
  return 'kobestarr';
}

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
const stripBearer = (t) => String(t || '').replace(/^Bearer\s+/i, '').trim();

/** Vault ghl.<brand> first, then ~/.claude.json mcpServers.ghl-<brand>. Returns { brand: {token, locationId} }. */
function loadGhlCreds({ vaultPath, claudeJsonPath } = {}) {
  const vault = readJson(vaultPath || path.join(os.homedir(), '.credentials', 'api-keys.json')) || {};
  const claude = readJson(claudeJsonPath || path.join(os.homedir(), '.claude.json')) || {};
  const out = {};
  for (const brand of BRANDS) {
    const v = vault.ghl && vault.ghl[brand];
    const vObj = typeof v === 'string' ? { token: v } : (v || {});
    const vTok = stripBearer(vObj.token || vObj.private_integration_token || vObj.pit);
    const vLoc = vObj.location_id || vObj.locationId;
    const h = (claude.mcpServers && claude.mcpServers['ghl-' + brand] && claude.mcpServers['ghl-' + brand].headers) || {};
    const token = vTok || stripBearer(h.Authorization || h.authorization);
    if (!token) continue;
    out[brand] = { token, locationId: vLoc || h.locationId || DEFAULT_LOCATIONS[brand] };
  }
  return out;
}

function trimText(t, n) {
  const s = String(t || '').trim();
  return s.length > n ? s.slice(0, n) + ' [trimmed]' : s;
}

function createGhlTracker({ fetch = global.fetch, creds, log = () => {}, dryRun = false, sleep, baseUrl = BASE_URL, version = API_VERSION } = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const credMap = creds || loadGhlCreds();
  const pipeCache = {};

  function credsFor(brand) {
    const c = credMap[brand];
    if (!c || !c.token) throw new Error(`No GHL credentials for brand "${brand}" (vault ghl.${brand} or ~/.claude.json ghl-${brand})`);
    return { token: c.token, locationId: c.locationId || DEFAULT_LOCATIONS[brand] };
  }

  async function request(brand, method, p, { query, body } = {}) {
    const { token } = credsFor(brand);
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    const label = `GHL ${method} ${p}`;
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
        clearTimeout(timer);
        lastErr = new Error(e && e.name === 'AbortError' ? `${label} timed out after ${TIMEOUT_MS / 1000}s` : `${label} network error: ${e && e.message}`);
        if (attempt < MAX_ATTEMPTS) { await wait(500 * 2 ** (attempt - 1)); continue; }
        throw lastErr;
      }
      clearTimeout(timer);
      const text = await res.text();
      let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
      if (res.ok) return json || {};
      lastErr = new Error(`${label} failed with ${res.status}: ${String((json && (json.message || json.error)) || text).slice(0, 200)}`);
      lastErr.status = res.status;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) throw lastErr;
      const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
      const delay = ra > 0 ? ra * 1000 : 500 * 2 ** (attempt - 1);
      log(`${label} got ${res.status}, retrying in ${delay} ms (attempt ${attempt})`);
      await wait(delay);
    }
    throw lastErr;
  }

  async function listPipelines(brand) {
    const { locationId } = credsFor(brand);
    const r = await request(brand, 'GET', '/opportunities/pipelines', { query: { locationId } });
    return r.pipelines || [];
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

  async function getColdEmail(brand) {
    if (pipeCache[brand]) return pipeCache[brand];
    const p = (await listPipelines(brand)).find((x) => String(x.name).toLowerCase() === PIPELINE_NAME.toLowerCase());
    if (!p) throw new Error(`No "${PIPELINE_NAME}" pipeline in the ${brand} sub-account. Run: node ghl-setup.js --apply`);
    const byName = {}; const byId = {};
    for (const s of p.stages || []) { byName[s.name.toLowerCase()] = s.id; byId[s.id] = s.name; }
    return (pipeCache[brand] = { id: p.id, byName, byId });
  }
  const stageId = (pl, name) => {
    const id = pl.byName[String(name).toLowerCase()];
    if (!id) throw new Error(`Stage "${name}" not found in the Cold Email pipeline`);
    return id;
  };

  function canMove(cur, tgt) {
    if (cur === tgt || cur === 'Won' || cur === 'Lost') return false;
    if (tgt === 'Lost' || tgt === 'Not now') return true;
    return RANK[tgt] > (RANK[cur] ?? 0);
  }

  async function findOpenOpp(brand, pl, contactId) {
    const { locationId } = credsFor(brand);
    const r = await request(brand, 'GET', '/opportunities/search', { query: { locationId, pipelineId: pl.id, contactId, status: 'open', limit: '100' } });
    return (r.opportunities || []).find((o) => !o.pipelineId || o.pipelineId === pl.id) || null;
  }

  async function applyStage(brand, pl, opp, target) {
    const body = { pipelineStageId: stageId(pl, target) };
    body.status = target === 'Won' ? 'won' : target === 'Lost' ? 'lost' : 'open';
    await request(brand, 'PUT', `/opportunities/${opp.id}`, { body });
  }

  async function trackReply(e) {
    const label = e && e.label;
    if (label === 'auto') return { action: 'skipped', reason: 'auto replies are not tracked' };
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.email || '')) throw new Error('trackReply needs a valid email');
    if (!LABEL_STAGE[label]) throw new Error(`trackReply: unknown label "${label}" (expected ${Object.keys(LABEL_STAGE).join(', ')} or auto)`);
    const brand = e.brand || brandForMailbox(e.mailbox);
    const target = LABEL_STAGE[label];
    const tags = ['cold-email', ...(e.campaign ? [`campaign:${e.campaign}`] : []), `brand:${brand}`];
    if (dryRun) return { dryRun: true, brand, stage: target, tags, email: e.email };

    const { locationId } = credsFor(brand);
    const up = await request(brand, 'POST', '/contacts/upsert', { body: {
      locationId, email: e.email, ...(e.firstName ? { firstName: e.firstName } : {}), ...(e.company ? { companyName: e.company } : {}), source: 'cold-email',
    } });
    const contactId = up.contact && (up.contact.id || up.contact._id);
    if (!contactId) throw new Error('GHL upsert returned no contact id');

    const ref = crypto.createHash('sha1').update([e.email.toLowerCase(), e.date, label, e.text].join('|')).digest('hex').slice(0, 10);
    const marker = `[ref:${ref}]`;
    const notes = (await request(brand, 'GET', `/contacts/${contactId}/notes`)).notes || [];
    if (notes.some((n) => String(n.body || '').includes(marker))) {
      return { brand, contactId, stage: target, created: false, moved: false, noteAdded: false, duplicate: true };
    }

    await request(brand, 'POST', `/contacts/${contactId}/tags`, { body: { tags } });

    const pl = await getColdEmail(brand);
    const name = `${e.company || e.firstName || e.email} - Cold Email`;
    let opp = await findOpenOpp(brand, pl, contactId);
    let created = false; let moved = false; let stage = target;
    if (!opp) {
      const body = { pipelineId: pl.id, locationId, name, status: target === 'Lost' ? 'lost' : 'open', contactId, pipelineStageId: stageId(pl, target) };
      const r = await request(brand, 'POST', '/opportunities/', { body });
      opp = r.opportunity || r; created = true;
    } else {
      const cur = pl.byId[opp.pipelineStageId];
      if (canMove(cur, target)) { await applyStage(brand, pl, opp, target); moved = true; } else stage = cur || target;
    }

    const lines = [`Cold email reply (${label})`, `Date: ${e.date || new Date().toISOString().slice(0, 10)}`];
    if (e.campaign) lines.push(`Campaign: ${e.campaign}`);
    if (e.mailbox) lines.push(`Mailbox: ${e.mailbox}`);
    if (label === 'referral') lines.push(`Referral: ${e.referral || 'named in the reply, see text'}`);
    if (label === 'no') lines.push('Lost reason: not interested (replied no)');
    if (label === 'left_company') lines.push('Lost reason: contact has left the company');
    lines.push('', trimText(e.text, NOTE_MAX), '', marker);
    await request(brand, 'POST', `/contacts/${contactId}/notes`, { body: { body: lines.join('\n') } });

    return { brand, contactId, opportunityId: opp.id, stage, created, moved, noteAdded: true };
  }

  async function moveStage(email, brand, stageName, { allowBackwards = false } = {}) {
    const canonical = STAGES.find((s) => s.toLowerCase() === String(stageName).toLowerCase());
    if (!canonical) throw new Error(`Unknown stage "${stageName}". Stages: ${STAGES.join(', ')}`);
    if (dryRun) return { dryRun: true, brand, stage: canonical };
    const { locationId } = credsFor(brand);
    const r = await request(brand, 'GET', '/contacts/search/duplicate', { query: { locationId, email } });
    const c = r.contact || (r.contacts && r.contacts[0]);
    if (!c) return { moved: false, reason: 'no contact with that email' };
    const pl = await getColdEmail(brand);
    const opp = await findOpenOpp(brand, pl, c.id);
    if (!opp) return { moved: false, reason: 'no open Cold Email deal for that contact' };
    const cur = pl.byId[opp.pipelineStageId];
    const ok = allowBackwards ? cur !== canonical : canMove(cur, canonical);
    if (!ok) return { moved: false, reason: `deal is at ${cur}`, stage: cur, opportunityId: opp.id };
    await applyStage(brand, pl, opp, canonical);
    return { moved: true, stage: canonical, opportunityId: opp.id };
  }

  async function ensurePipelines({ dryRun: dry = dryRun, brands = BRANDS } = {}) {
    const out = [];
    for (const brand of brands) {
      if (!credMap[brand] || !credMap[brand].token) { out.push({ brand, status: 'no_credentials' }); continue; }
      try {
        const existing = (await listPipelines(brand)).find((p) => String(p.name).toLowerCase() === PIPELINE_NAME.toLowerCase());
        if (existing) {
          const c = checkPipeline(existing);
          out.push(c.ok ? { brand, status: 'ok', pipelineId: existing.id } : { brand, status: 'mismatch', pipelineId: existing.id, detail: c.detail });
          continue;
        }
        if (dry) { out.push({ brand, status: 'would_create', stages: STAGES }); continue; }
        const { locationId } = credsFor(brand);
        await request(brand, 'POST', '/opportunities/pipelines', { body: {
          locationId, name: PIPELINE_NAME, stages: STAGES.map((name, position) => ({ name, position, showInFunnel: true })),
        } });
        delete pipeCache[brand];
        const made = (await listPipelines(brand)).find((p) => String(p.name).toLowerCase() === PIPELINE_NAME.toLowerCase());
        const c = made ? checkPipeline(made) : { ok: false, detail: 'created but not visible on re-read' };
        out.push(c.ok ? { brand, status: 'created', pipelineId: made.id } : { brand, status: 'mismatch', pipelineId: made && made.id, detail: c.detail });
      } catch (err) {
        out.push({ brand, status: 'error', detail: err.message });
      }
    }
    return out;
  }

  return { trackReply, moveStage, ensurePipelines, brandForMailbox, checkPipeline };
}

module.exports = { createGhlTracker, loadGhlCreds, brandForMailbox, STAGES, BRANDS, PIPELINE_NAME, DEFAULT_LOCATIONS };
