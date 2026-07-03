// shared/outreach-core/campaigns/mailead-client.js
// Thin client for Mailead's direct REST API (reverse-engineered from the
// @taskmagic/piece-mailead source, 2026-07-02). Only the personal-key endpoints
// work: get_user_campaigns, add_lead, remove_lead. Everything else (read counts,
// template, send config, create campaign) is gated behind an internal service key.
// Key: ~/.credentials/api-keys.json -> mailead.apiKey. Docs: memory reference-mailead-direct-api.
const os = require('os'), path = require('path');

const BASE = 'https://2dxrjrlgtbxdztp2zjyksrus6a0bujtv.lambda-url.eu-central-1.on.aws';

function apiKey() {
  const creds = require(path.join(os.homedir(), '.credentials/api-keys.json'));
  const k = creds.mailead && creds.mailead.apiKey;
  if (!k) throw new Error('No mailead.apiKey in ~/.credentials/api-keys.json');
  return k;
}

const REQUEST_TIMEOUT_MS = 30_000; // one hung request must not stall a whole batch

async function req(endpoint, { method = 'POST', body } = {}) {
  const r = await fetch(`${BASE}/${endpoint}`, {
    method,
    headers: { 'X-API-Key': apiKey(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: r.ok, status: r.status, json };
}

// [{ id:<int>, title:<string> }]
async function listCampaigns() {
  const { ok, status, json } = await req('get_user_campaigns');
  if (!ok || !json.data) throw new Error(`get_user_campaigns failed (${status}): ${JSON.stringify(json)}`);
  return json.data.campaigns || [];
}

// Resolve an exact campaign title to its integer id (the dashboard-URL id is a
// Bubble id and is rejected by the API — must be the small integer).
async function resolveCampaignId(title) {
  const campaigns = await listCampaigns();
  const hit = campaigns.find(c => c.title === title);
  if (!hit) throw new Error(`No Mailead campaign titled '${title}'. Have: ${campaigns.map(c => c.title).join(', ')}`);
  return hit.id;
}

// Add one lead. Returns { ok, status, json }. NOTE: the API returns success even
// for no-ops (its success message is not proof of persistence), so callers must
// keep their own ledger of what was pushed.
async function addLead(campaignId, lead) {
  return req('add_lead', {
    body: {
      campaign_id: campaignId,
      email_to_add: lead.email,
      first_name: lead.first_name || '',
      last_name: lead.last_name || '',
      company_name: lead.company_name || '',
      company_website: lead.company_website || '',
      linkedin_url: lead.linkedin_url || '',
    },
  });
}

async function removeLead(campaignId, email) {
  return req('remove_lead', { body: { campaign_id: campaignId, email_to_remove: email } });
}

module.exports = { BASE, listCampaigns, resolveCampaignId, addLead, removeLead, req };
