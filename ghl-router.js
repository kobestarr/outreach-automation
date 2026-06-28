#!/usr/bin/env node
/**
 * ghl-router.js — the tracking spine. Every lead source routes through here.
 *
 * Rule (Kobi, 2026-06-12): Send → Track → Notify.
 *   - Mailead / Lemlist SEND. GHL never sends.
 *   - Every lead (Bark, Twine, outreach reply, ...) is UPSERTED into GoHighLevel
 *     as a contact + opportunity, ALWAYS tagged `source:<channel>`.
 *   - Then Kobi gets a WhatsApp ping (Slack later).
 * After ~1 month the pipeline shows channel-by-channel conversion → double down / cut.
 *
 * Talks to GHL's public API directly with the Private Integration Token, so it runs
 * unattended on clawdbot (the Mac `ghl` CLI can't). Same creds, no CLI needed.
 *
 * Config via env (set on clawdbot):
 *   GHL_PIT          Kobestarr Digital Private Integration Token (pit-...)
 *   GHL_LOCATION_ID  Kobestarr Digital location id
 *   WHATSAPP_TO      destination (default 447989746146)
 *   WHATSAPP_BRIDGE  bridge URL (default http://localhost:3848/send-direct)
 *   WHATSAPP_TOKEN_FILE  path to internal token (default /root/.trendmine-internal-token)
 *
 * CLI:
 *   node ghl-router.js --source bark --name "Jane Smith" --email jane@co.com \
 *        --company "Acme" --phone 0161... --note "wants a website, SK7" [--value 1500] [--dry-run]
 *   --pipeline overrides the source→pipeline default (bark|outbound|sales).
 *
 * Programmatic:  const { routeLead } = require('./ghl-router'); await routeLead({...})
 */

const https = require('https');

const BASE = 'services.leadconnectorhq.com';
const VERSION = '2021-07-28';
const LOCATION_ID = process.env.GHL_LOCATION_ID || 'r0zUXIn2l7A8zjR3nPmD'; // Kobestarr Digital
const PIT = process.env.GHL_PIT || '';

// source → pipeline+stage (Kobestarr Digital). Tags always include source:<source>.
const PIPELINES = {
  bark:    { id: 'PJCejgN5XRT3m39mFxYZ', stage: 'cb0addd2-3754-4608-97ac-0999868122f7' }, // Bark Leads / New Lead
  outbound:{ id: 'bBHoXmRQcJiVKra8qpz0', stage: '9809a98e-4b23-4e33-b2ca-9885213d22b6' }, // Outbound Drip / Started
  sales:   { id: 'nqCpm9Ff5TqSZARHojvR', stage: '95f03ac3-cbeb-4b78-bd76-66ec49189868' }, // Sales Pipeline / Lead
};
// which pipeline a given source defaults to
const SOURCE_PIPELINE = {
  bark: 'bark',
  twine: 'sales',
  mailead: 'outbound', 'mailead-reply': 'outbound',
  lemlist: 'outbound', 'lemlist-reply': 'outbound',
};

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: BASE, path, method,
      headers: {
        'Authorization': `Bearer ${PIT}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Version': VERSION,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let j = null; try { j = JSON.parse(d); } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(j);
        else reject(new Error(`GHL ${method} ${path} → ${res.statusCode}: ${d.slice(0, 300)}`));
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function upsertContact({ email, phone, firstName, lastName, name, company, tags = [], source }) {
  const body = { locationId: LOCATION_ID };
  if (email) body.email = email;
  if (phone) body.phone = phone;
  if (firstName) body.firstName = firstName;
  if (lastName) body.lastName = lastName;
  if (name) body.name = name;
  if (company) body.companyName = company;
  if (tags.length) body.tags = tags;
  if (source) body.source = source;
  const r = await api('POST', '/contacts/upsert', body);
  const c = (r && (r.contact || r)) || {};
  return { id: c.id || c._id, isNew: r && r.new };
}

async function createOpportunity({ contactId, name, pipeline, value }) {
  const p = PIPELINES[pipeline] || PIPELINES.sales;
  const body = {
    locationId: LOCATION_ID,
    pipelineId: p.id,
    pipelineStageId: p.stage,
    name, contactId, status: 'open',
  };
  if (value != null) body.monetaryValue = value;
  return api('POST', '/opportunities/', body);
}

function whatsapp(message) {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    const to = process.env.WHATSAPP_TO || '447989746146';
    const url = process.env.WHATSAPP_BRIDGE || 'http://localhost:3848/send-direct';
    const tokenFile = process.env.WHATSAPP_TOKEN_FILE || '/root/.trendmine-internal-token';
    const payload = JSON.stringify({ to, message, source: 'ghl-router' }).replace(/'/g, "'\\''");
    const cmd = `TOKEN=$(cat ${tokenFile} 2>/dev/null); curl -s -X POST -H "X-Internal-Token: $TOKEN" ` +
      `-H "Content-Type: application/json" -d '${payload}' ${url}`;
    execFile('bash', ['-c', cmd], { timeout: 15000 }, (err) => {
      if (err) console.error('whatsapp ping failed:', err.message);
      resolve();
    });
  });
}

/** The one entry point every source calls. */
async function routeLead(lead) {
  const {
    source, pipeline, name, firstName, lastName, email, phone, company,
    note = '', value, extraTags = [], dryRun = false, notify = true,
  } = lead;
  if (!source) throw new Error('routeLead: source is required (for source:<channel> tag)');
  const pl = pipeline || SOURCE_PIPELINE[source] || 'sales';
  const tags = [`source:${source}`, ...extraTags];
  const oppName = `${name || company || email || 'Lead'} — ${source}`;

  if (dryRun) {
    console.log('[dry-run] would upsert contact:', { email, name, company, tags, source });
    console.log('[dry-run] would create opportunity:', { pipeline: pl, name: oppName, value });
    console.log('[dry-run] would ping:', oppName);
    return { dryRun: true };
  }

  const contact = await upsertContact({ email, phone, firstName, lastName, name, company, tags, source });
  let opp = null;
  if (contact.id) opp = await createOpportunity({ contactId: contact.id, name: oppName, pipeline: pl, value });

  if (notify) {
    const msg = `🟢 New ${source} lead → GHL\n${name || company || email}\n` +
      `${company ? company + '\n' : ''}${note ? note + '\n' : ''}` +
      `${value != null ? '£' + value + '\n' : ''}Pipeline: ${pl}${contact.isNew === false ? ' (existing contact)' : ''}`;
    await whatsapp(msg);
  }
  return { contactId: contact.id, isNew: contact.isNew, opportunity: opp };
}

module.exports = { routeLead, upsertContact, createOpportunity, PIPELINES };

// ---- CLI ----
if (require.main === module) {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
  const has = (k) => a.includes(`--${k}`);
  if (!PIT && !has('dry-run')) { console.error('Set GHL_PIT (Kobestarr Digital PIT).'); process.exit(1); }
  routeLead({
    source: get('source'), pipeline: get('pipeline'),
    name: get('name'), email: get('email'), phone: get('phone'), company: get('company'),
    note: get('note'), value: get('value') != null ? Number(get('value')) : undefined,
    dryRun: has('dry-run'), notify: !has('no-notify'),
  }).then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
