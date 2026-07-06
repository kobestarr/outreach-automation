#!/usr/bin/env node
// create-cardiologists-lemlist.js — builds the doctors campaign in Lemlist end to end:
// campaign -> 4 sequence steps -> 248 leads with per-lead A/B subject variable.
// Docs: developer.lemlist.com (fetched 2026-07-06): POST /campaigns, POST /sequences/{id}/steps,
// POST /campaigns/{id}/leads/. Auth: Basic base64(":"+apiKey).
// Subject A/B: step 1 subject is {{subjectLine}}; each lead carries subjectLine (A or B,
// alternating) + subjectVariant for later open-rate analysis. Emails 2-4 blank subject (same thread).
//
// Usage: node create-cardiologists-lemlist.js [--go] [--limit N]
const fs = require('fs'), path = require('path');
const { getCredential } = require('./shared/outreach-core/credentials-loader');
const { parseCSV } = require('./shared/outreach-core/csv/csv-util');
const { appendLedger, readLedger } = require('./shared/outreach-core/csv/ledger');

const GO = process.argv.includes('--go');
const limIdx = process.argv.indexOf('--limit');
const LIMIT = limIdx >= 0 ? parseInt(process.argv[limIdx + 1], 10) : 0;

const CSV = 'exports/cardiologists-2026-07-06-lemlist.csv';
const CAMPAIGN_NAME = 'KSD Doctors - Cardiologists 2026-07';
const SENT_LEDGER = path.join(__dirname, 'data/sent-ledger.txt');

// Subjects are PRE-RENDERED per lead at build time. Never put {{tokens}} inside a
// variable's value: Lemlist substitutes variables in one pass, so nested tokens
// would reach inboxes as literal text (caught 2026-07-06 before launch).
const SUBJECT_A = (first, last) => `What do patients see when they Google "${first} ${last}"?`;
const SUBJECT_B = (first, last) => `"${first} ${last}": what do patients see when they Google your name?`;

const p = lines => lines.join('<br><br>');
const EMAILS = [
  {
    delay: 0,
    subject: '{{subjectLine}}',
    message: p([
      'Hi {{firstName}},',
      "As you know, when a patient gets a referral, they're handed a list of consultant names, and the first thing they do is type those names into Google, and these days ChatGPT too. Whatever comes up decides who they book.",
      "It's totally the natural thing to do!",
      'Try it yourself: type in "Dr Nigel Stephens".',
      "What you'll find is work we did together. Nigel wanted to control what patients saw when they compared him to the other {{ColloquialSpecialtyPlural}} on the list, and that's really all this is.",
      "I can do exactly the same for you. We've just built a new process that gets your site up and running much faster than before, starting from £999.",
      'Want me to show you what it would look like for your name?',
      'Cheers,<br>Kobi',
    ]),
  },
  {
    delay: 3, // Day 3
    subject: '',
    message: p([
      'Hi {{firstName}},',
      'Just bumping this in case it got buried.',
      'A ten second test: type your own name into Google or ChatGPT, then type Dr Nigel Stephens. That difference is exactly what patients see when they are choosing from a referral list.',
      'Happy to show you what your version would look like. Want a look?',
      'Cheers,<br>Kobi',
    ]),
  },
  {
    delay: 4, // Day 7
    subject: '',
    message: p([
      'Hi {{firstName}},',
      'Last proper one from me, promise.',
      'Patients find you one of two ways: a referral letter with your name on it, or a word of mouth recommendation. Either way, they check you out online before they book, and if what they find is thin, some of them quietly book another name on the list.',
      "With the new process it's faster than it's ever been, it starts from £999, and you barely have to lift a finger. If you'd like a quick chat, reply to this email or call me on 07989 746146.",
      'Cheers,<br>Kobi',
    ]),
  },
  {
    delay: 5, // Day 12
    subject: '',
    message: p([
      'Hi {{firstName}},',
      "I'll leave you in peace after this one.",
      'If you ever want your name to come up the way Dr Nigel Stephens\' does, just reply "website" and I\'ll send over the details. If not, no worries at all.',
      'All the best with the practice,<br>Kobi<br>Kobestarr Digital',
    ]),
  },
];

const auth = () => 'Basic ' + Buffer.from(':' + getCredential('lemlist', 'apiKey')).toString('base64');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(pathname, { method = 'GET', body } = {}) {
  const r = await fetch('https://api.lemlist.com/api' + pathname, {
    method,
    headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok) throw new Error(`${method} ${pathname} -> ${r.status}: ${text.slice(0, 300)}`);
  return json;
}

(async () => {
  console.log(GO ? 'LIVE RUN' : 'DRY-RUN (pass --go to execute)');

  // Leads from CSV, A/B assigned alternating on the safest-first order
  const rows = parseCSV(fs.readFileSync(CSV, 'utf8'));
  const hdr = rows[0];
  const col = n => hdr.indexOf(n);
  let leads = rows.slice(1).map((r, i) => ({
    email: r[col('email')].toLowerCase(),
    firstName: r[col('firstName')],
    lastName: r[col('lastName')],
    companyName: r[col('companyName')],
    jobTitle: r[col('jobTitle')],
    ColloquialSpecialtyPlural: r[col('ColloquialSpecialtyPlural')],
    subjectVariant: i % 2 === 0 ? 'A' : 'B',
    subjectLine: (i % 2 === 0 ? SUBJECT_A : SUBJECT_B)(r[col('firstName')], r[col('lastName')]),
  }));
  if (LIMIT > 0) leads = leads.slice(0, LIMIT);
  const counts = leads.reduce((a, l) => ((a[l.subjectVariant] = (a[l.subjectVariant] || 0) + 1), a), {});
  console.log(`leads: ${leads.length} | variant split:`, JSON.stringify(counts));
  console.log('sample A:', JSON.stringify({ ...leads[0], subjectLine: leads[0].subjectLine.slice(0, 50) + '...' }));
  console.log('steps:', EMAILS.map((e, i) => `E${i + 1} delay=${e.delay}d subj="${e.subject}"`).join(' | '));

  if (!GO) return console.log('\nDRY-RUN done. Nothing created.');

  // 1. Campaign (idempotent-ish: bail if name already exists)
  const existing = await api('/campaigns?limit=100&page=1').catch(() => null);
  const already = existing && (existing.campaigns || existing).find?.(c => c.name === CAMPAIGN_NAME);
  let campaign;
  if (already) { console.log(`campaign already exists: ${already._id} — reusing, skipping step creation`); campaign = already; }
  else {
    campaign = await api('/campaigns', { method: 'POST', body: { name: CAMPAIGN_NAME, timezone: 'Europe/London' } });
    console.log('campaign created:', campaign._id, '| sequenceId:', campaign.sequenceId);
    for (let i = 0; i < EMAILS.length; i++) {
      const e = EMAILS[i];
      const step = await api(`/sequences/${campaign.sequenceId}/steps`, {
        method: 'POST',
        body: { type: 'email', subject: e.subject, message: e.message, delay: e.delay },
      });
      console.log(`  step ${i + 1} created (${step._id}, delay ${e.delay}d)`);
      await sleep(400);
    }
  }

  // 2. Leads (ledgered per-campaign for idempotent re-runs)
  const loadLedgerFile = path.join(__dirname, `data/lemlist-loaded-${campaign._id}.txt`);
  const loaded = readLedger(loadLedgerFile);
  let pushed = 0, skipped = 0; const failed = [];
  for (const lead of leads) {
    if (loaded.has(lead.email)) { skipped++; continue; }
    try {
      await api(`/campaigns/${campaign._id}/leads/`, { method: 'POST', body: lead });
      appendLedger(loadLedgerFile, [lead.email]);
      pushed++;
    } catch (e) { failed.push({ email: lead.email, error: e.message.slice(0, 120) }); }
    if ((pushed + skipped + failed.length) % 50 === 0) console.log(`  ...${pushed + skipped + failed.length}/${leads.length}`);
    await sleep(450);
  }
  appendLedger(SENT_LEDGER, leads.filter(l => !failed.some(f => f.email === l.email)).map(l => l.email));
  console.log(`DONE campaign ${campaign._id}: pushed ${pushed}, skipped ${skipped}, failed ${failed.length}`);
  failed.slice(0, 8).forEach(f => console.log('  FAIL', f.email, f.error));
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
