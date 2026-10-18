// Which address in a Mailead webhook event is the LEAD (never one of our own sending mailboxes).
// Same field order as leadEmail() in vps/mailead-webhook-receiver.js (from_email_account first, then lead_email_account),
// but "ours" is an EXACT match on the 9 sending domains. The receiver's substring hints would call info@strippedpine.co.uk
// ours. The 27 mailboxes are kobi / kobi.o / kobi.omenaka at each domain (same list as replies/mailboxes.js on feat/harvey-replies;
// consolidate after merge).
const OWN_DOMAINS = [
  'kobestarrdigital.com', 'kobestarr.digital', 'trykobestarrdigital.com',
  'strippedmedia.co.uk', 'strippedmedia.org', 'gostripped.media',
  'dealflowmedia.co', 'dealflowmedia.pro', 'dealflowmedia.group',
];
const OWN_SET = new Set(OWN_DOMAINS);

const addrOf = s => {
  const m = String(s || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(s || '')).trim().toLowerCase();
};
const isOwnMailbox = a => { const x = addrOf(a); return x.includes('@') && OWN_SET.has(x.split('@')[1]); };

function leadEmail(ev) {
  const cands = [ev && ev.from_email_account, ev && ev.lead_email_account].filter(Boolean);
  for (const c of cands) if (!isOwnMailbox(c)) return addrOf(c);
  return null; // both fields are our own mailboxes: never report our address as the lead
}

module.exports = { leadEmail, isOwnMailbox, OWN_DOMAINS };
