// Which address in a Mailead webhook event is the LEAD (never one of our own sending mailboxes).
// Same rule as leadEmail() in vps/mailead-webhook-receiver.js. The receiver starts a server when required and ships to
// the VPS as a single file, so the rule is copied here and tests/bounce-loop.test.js fails if the two ever drift apart.
const OWN_DOMAIN_HINTS = ['kobestarr', 'dealflowmedia', 'stripped', 'trykobestarr'];

function leadEmail(ev) {
  const cands = [ev && ev.from_email_account, ev && ev.lead_email_account].filter(Boolean);
  for (const c of cands) if (!OWN_DOMAIN_HINTS.some(h => String(c).toLowerCase().includes(h))) return c;
  return null; // both fields are our own mailboxes: never report our address as the lead
}

module.exports = { leadEmail, OWN_DOMAIN_HINTS };
