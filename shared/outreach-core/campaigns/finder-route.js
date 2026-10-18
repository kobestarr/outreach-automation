// shared/outreach-core/campaigns/finder-route.js
// Which campaign a lead may go to, decided from how the address was found (enrich-owner-emails.js columns).
// Pure. Reads lead.ref.email_status / email_confidence (normalise() puts unknown CSV columns in lead.ref).
// FAIL CLOSED: a file is "legacy" only when its header has no email_status column at all. If the column exists,
// a blank or unknown value is excluded. email_suggested is never read: a guess is not an address.
const MAIN = new Set(['found', 'found_flagged', 'scraped_owner']);
const INBOX = new Set(['found_generic', 'scraped_role', 'scraped_staff']);
const CATCH_ALL = new Set(['catch_all_found', 'icypeas_found']);
const norm = s => String(s == null ? '' : s).trim().toLowerCase();

function routeFor(lead) {
  const ref = (lead && lead.ref) || {};
  if (!norm(lead && lead.email)) return { route: 'excluded', reason: 'no_email' };
  if (!('email_status' in ref)) return { route: 'main', reason: 'legacy' };
  const status = norm(ref.email_status);
  if (!status) return { route: 'excluded', reason: 'blank_email_status' };
  if (MAIN.has(status)) return { route: 'main', reason: status };
  if (INBOX.has(status)) return { route: 'inbox', reason: status };
  if (CATCH_ALL.has(status)) {
    const conf = norm(ref.email_confidence);
    if (conf === 'high') return { route: 'main', reason: `${status}_high` };
    if (conf === 'low') return { route: 'probable', reason: `${status}_low` };
    return { route: 'excluded', reason: `${status}_confidence_${conf || 'blank'}` };
  }
  return { route: 'excluded', reason: `status_${status}` };
}

module.exports = { routeFor };
