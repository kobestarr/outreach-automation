#!/usr/bin/env node
// lead-repair-2026-07-06.js — one-off: act on campaign 8890 auto-replies (2026-07-06 Gmail sweep).
// 1. Reoon-verify 5 replacement contacts named in auto-replies (personal mailboxes only)
// 2. Clone each original's ToSend row with the new name/email (same company carrier insight)
// 3. Append to sheet + sent-ledger + load-ledger, add to Mailead campaign 8890
// 4. Remove 9 dead mailboxes + 3 long-maternity contacts from campaign 8890
// Run: node lead-repair-2026-07-06.js --go   (dry-run without --go)
const fs = require('fs'), path = require('path');
const sheets = require('./shared/outreach-core/sheets/sheets-client');
const mailead = require('./shared/outreach-core/campaigns/mailead-client');
const { verifyEmails } = require('./shared/outreach-core/email-verification/reoon-verifier');
const { appendLedger } = require('./shared/outreach-core/csv/ledger');

const GO = process.argv.includes('--go');
const CAMPAIGN_ID = 8890;
const SHEET_ID = '1xcyH8DetTxqJWBfWRicAl0FEYyVJ8FvZ6F46W-k_D08';
const TAB = 'ToSend';
const SENT_LEDGER = path.join(__dirname, 'data/sent-ledger.txt');
const LOAD_LEDGER = path.join(__dirname, 'data/mailead-loaded-8890-ksd-pro-services-2026-07-02.txt');

// new contact -> original lead whose row we clone (source: auto-replies, 2026-07-06)
const REPLACEMENTS = [
  { first: 'Lucy',    email: 'lucy@vaaltd.co.uk',          origEmail: 'clara@vaaltd.co.uk',          last: '' },
  { first: 'Jane',    email: 'jane@cskarparis.co.uk',      origEmail: 'andrea@cskarparis.co.uk',     last: '' },
  { first: 'Frances', email: 'frances@warnerwilde.co.uk',  origEmail: 'charlotte@warnerwilde.co.uk', last: 'Wilde' },
  { first: 'Sam',     email: 'samcowley@josolyne.co.uk',   origEmail: 'chloe@josolyne.co.uk',        last: 'Cowley' },
  { first: 'Nils',    email: 'nils@matureaccountants.com', origEmail: 'andrea@matureaccountants.com', last: 'Lloyd Penny' },
];

// 9 auto-reply "person left / mailbox dead" + 3 long maternity (cover added above)
const REMOVE = [
  'martinw@employeemanagement.co.uk', 'daniel.lee@gpcfinancial.co.uk', 'alexia@bsco.co.nz',
  'clara@vaaltd.co.uk', 'adrian@seelhoff.com', 'eric.brousseau@kdainc.com', 'js@audleychaucer.com',
  'eoin.kelly@securitax.co.uk', 'adam.garnett@finling.net',
  'andrea@cskarparis.co.uk', 'charlotte@warnerwilde.co.uk', 'chloe@josolyne.co.uk',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log(GO ? 'LIVE RUN' : 'DRY-RUN (pass --go to execute)');

  // 1. Verify replacement emails (project rule: non-website emails get Reoon before a sender sees them)
  const results = await verifyEmails(REPLACEMENTS.map(r => r.email));
  const byEmail = Object.fromEntries(results.map((r, i) => [REPLACEMENTS[i].email, r]));
  const BAD = new Set(['invalid', 'disabled', 'disposable', 'spamtrap']);
  const adds = [];
  for (const r of REPLACEMENTS) {
    const v = byEmail[r.email] || {};
    const ok = !BAD.has(v.status);
    console.log(`verify ${r.email}: ${v.status || 'no-result'}${ok ? '' : '  -> SKIPPED'}`);
    if (ok) adds.push({ ...r, reoonStatus: v.status || '', reoonScore: String(v.score ?? ''), reoonSafe: v.isSafeToSend ? '1' : '0' });
  }

  // 2. Clone original rows
  const { header, rows } = await sheets.readRows(SHEET_ID, TAB);
  const col = name => header.indexOf(name);
  const newRows = [];
  for (const a of adds) {
    const orig = rows.find(row => (row['real_email'] || '').toLowerCase() === a.origEmail);
    if (!orig) { console.log(`NO SHEET ROW for original ${a.origEmail} — skipping ${a.email}`); continue; }
    const clone = { ...orig };
    clone['real_first_name'] = a.first;
    clone['real_last_name'] = a.last;
    clone['real_email'] = a.email;
    clone['reoonStatus'] = a.reoonStatus; clone['reoonScore'] = a.reoonScore; clone['reoonSafe'] = a.reoonSafe;
    clone['First Name'] = a.first;
    clone['Email'] = a.email;
    // Last Name (carrier insight) + Company Name stay as the original company row
    newRows.push({ a, clone });
    console.log(`staged ${a.first} <${a.email}> @ ${clone['Company Name']} | carrier: ${String(clone['Last Name']).slice(0, 60)}...`);
  }

  if (!GO) { console.log(`\nDRY-RUN done: would add ${newRows.length}, remove ${REMOVE.length}`); return; }

  // 3. Append sheet rows + ledgers + add to campaign
  if (newRows.length) {
    await sheets.appendRows(SHEET_ID, TAB, header, newRows.map(({ clone }) => header.map(h => clone[h] ?? '')));
    appendLedger(SENT_LEDGER, newRows.map(({ a }) => a.email));
    for (const { a, clone } of newRows) {
      const res = await mailead.addLead(CAMPAIGN_ID, {
        email: a.email, first_name: a.first, last_name: clone['Last Name'] || '', company_name: clone['Company Name'] || '',
      });
      console.log(`${res.json.success ? 'added' : 'ADD FAILED'} ${a.email}`);
      if (res.json.success) fs.appendFileSync(LOAD_LEDGER, a.email.toLowerCase() + '\n');
      await sleep(250);
    }
  }

  // 4. Removals
  for (const e of REMOVE) {
    const res = await mailead.removeLead(CAMPAIGN_ID, e);
    console.log(`${res.json.success ? 'removed' : 'REMOVE FAILED'} ${e}`);
    await sleep(250);
  }
  console.log(`\nDONE: +${newRows.length} added, -${REMOVE.length} removed from campaign ${CAMPAIGN_ID}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
