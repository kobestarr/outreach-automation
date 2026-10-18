// The 27 cold-email sending mailboxes (3 locals x 9 domains) and which brand each belongs to.
const LOCALS = ['kobi', 'kobi.o', 'kobi.omenaka'];
const DOMAINS = {
  ksd: ['kobestarrdigital.com', 'kobestarr.digital', 'trykobestarrdigital.com'],
  stripped: ['strippedmedia.co.uk', 'strippedmedia.org', 'gostripped.media'],
  dealflow: ['dealflowmedia.co', 'dealflowmedia.pro', 'dealflowmedia.group'],
};

const MAILBOXES = [];
const BRAND_BY_DOMAIN = {};
for (const [brand, domains] of Object.entries(DOMAINS)) {
  for (const d of domains) {
    BRAND_BY_DOMAIN[d] = brand;
    for (const l of LOCALS) MAILBOXES.push(`${l}@${d}`);
  }
}
const SET = new Set(MAILBOXES);

const addrOf = s => {
  const m = String(s || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(s || '')).trim().toLowerCase();
};

const isOurMailbox = a => SET.has(addrOf(a));
const brandOf = a => BRAND_BY_DOMAIN[addrOf(a).split('@')[1]] || null;

// First of our mailboxes found in an address list (array or comma separated string), else null.
function ownMailboxIn(list) {
  const items = Array.isArray(list) ? list : String(list || '').split(',');
  for (const it of items) if (isOurMailbox(it)) return addrOf(it);
  return null;
}

module.exports = { MAILBOXES, isOurMailbox, brandOf, ownMailboxIn, addrOf };
