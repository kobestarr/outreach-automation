// shared/outreach-core/csv/normalise.js
// Map arbitrary CSV headers onto the canonical lead schema; keep everything else in .ref
const { isValidEmail } = require('../validation/data-quality');

// canonical field -> lowercase header aliases (exact match after trim/lowercase)
const CANONICAL = {
  email:        ['email', 'decision maker email', 'email address', 'generic email address', 'e-mail'],
  first_name:   ['first_name', 'first name', 'decision maker first name', 'firstname'],
  last_name:    ['last_name', 'last name', 'decision maker last name', 'lastname', 'surname'],
  company_name: ['company_name', 'company', 'company name', 'organization name', 'organisation name', 'company_full'],
  category:     ['category', 'business type', 'industry'],
  town:         ['town', 'city', 'location'],
  website:      ['website', 'url', 'site'],
  linkedin_url: ['linkedin_url', 'linkedin', 'decision maker linkedin url', 'linkedin url'],
  insight:      ['insight'], // pre-composed per-lead insight; carrier templates may reference {insight}
};

function normalise(rows) {
  const header = rows[0].map(h => String(h).trim());
  const lower = header.map(h => h.toLowerCase());
  // canonical field -> column index (first alias hit wins; earlier aliases beat later)
  const map = {};
  for (const [field, aliases] of Object.entries(CANONICAL)) {
    for (const a of aliases) { const i = lower.indexOf(a); if (i >= 0) { map[field] = i; break; } }
  }
  const mappedIdx = new Set(Object.values(map));
  const leads = [], skipped = [];
  for (const r of rows.slice(1)) {
    if (r.every(c => String(c).trim() === '')) continue; // genuinely blank line
    const lead = { ref: {} };
    for (const [field, i] of Object.entries(map)) lead[field] = String(r[i] || '').trim();
    for (const field of Object.keys(CANONICAL)) if (!(field in lead)) lead[field] = '';
    lead.email = lead.email.toLowerCase();
    header.forEach((h, i) => { if (!mappedIdx.has(i)) lead.ref[h] = String(r[i] || '').trim(); });
    if (!isValidEmail(lead.email)) { skipped.push({ email: lead.email, reason: 'invalid_email' }); continue; }
    leads.push(lead);
  }
  return { leads, skipped, mappedFields: Object.keys(map) };
}

module.exports = { normalise, CANONICAL };
