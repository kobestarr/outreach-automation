/**
 * Cleanup Bad Leads
 *
 * Identifies and fixes leads with:
 * 1. Company names / business descriptors as person names
 * 2. UI elements / form text as names
 * 3. Broken name parsing ("My Su", "Socials Su", etc.)
 * 4. Bad emails (sentry.io, wixpress.com internal tracking)
 *
 * Uses DATABASE as source of truth (Lemlist GET leads API returns empty).
 *
 * Actions:
 * - Bad names → Update to firstName="there", lastName="" in both DB and Lemlist
 * - Bad emails → Delete from Lemlist entirely
 */

const https = require('https');
const { getCredential } = require('./shared/outreach-core/credentials-loader');

const CAMPAIGN_ID = 'cam_bJYSQ4pqMzasQWsRb';

// ============================================================
// BAD NAME PATTERNS
// ============================================================

// Last names that are business descriptors (not real surnames)
const BAD_LAST_NAMES = new Set([
  'accountancy', 'accounting', 'insurance', 'structural', 'response',
  'approaches', 'protection', 'diet', 'law', 'operators', 'businesses',
  'management', 'certified', 'files', 'birmingham', 'su', 'pl',
  'client', 'choose your survey', 'machine operators', 'meze pl',
]);

// First names that are clearly not person names
const BAD_FIRST_NAMES = new Set([
  'attach', 'survey', 'my', 'socials', 'recurring', 'mixed',
  'commercial', 'community', 'cutter', 'data', 'elimination',
  'employment', 'engineering', 'managed', 'cheshire', 'chartered',
  'wilson', 'aldridge', 'begum', 'cro',
]);

// Email domains that should never be in the campaign
const BAD_EMAIL_DOMAINS = [
  'sentry.io',
  'sentry-next.wixpress.com',
  'wixpress.com',
  'sentry.wixpress.com',
];

// Email patterns that are clearly not business emails
const BAD_EMAIL_PATTERNS = [
  /^[a-f0-9]{20,}@/i,  // Long hex strings (sentry IDs)
];

// ============================================================
// DETECTION FUNCTIONS
// ============================================================

function isBadName(firstName, lastName) {
  const first = (firstName || '').toLowerCase().trim();
  const last = (lastName || '').toLowerCase().trim();

  // Already fallback or empty - skip
  if (first === 'there' || first === '') return false;

  // Check bad first names
  if (BAD_FIRST_NAMES.has(first)) return true;

  // Check bad last names
  if (BAD_LAST_NAMES.has(last)) return true;

  // "Su" as last name with any first name
  if (last === 'su') return true;

  // Last name is 2 chars or less and not a known short surname
  if (last.length > 0 && last.length <= 2 && !isCommonShortSurname(last)) return true;

  // First name looks like a company/business word
  if (isBusinessWord(first)) return true;

  // Last name looks like a business descriptor
  if (isBusinessWord(last)) return true;

  return false;
}

function isCommonShortSurname(name) {
  const realShortSurnames = new Set([
    'li', 'wu', 'xu', 'ye', 'ma', 'he', 'hu', 'lu', 'ng',
    'ho', 'lo', 'ko', 'do', 'le', 'ly', 'qi', 'yu', 'ai'
  ]);
  return realShortSurnames.has(name.toLowerCase());
}

function isBusinessWord(word) {
  const businessWords = new Set([
    'accountancy', 'accounting', 'insurance', 'structural', 'consulting',
    'commercial', 'community', 'engineering', 'recruitment', 'chartered',
    'management', 'certified', 'protection', 'employment', 'elimination',
    'professional', 'construction', 'architectural', 'financial',
    'digital', 'response', 'approaches', 'solutions', 'services',
    'associates', 'partnership', 'enterprises', 'holdings', 'group',
    'limited', 'ltd', 'plc', 'inc', 'corp',
    'diet', 'files', 'operators', 'businesses', 'survey', 'socials',
    'recurring', 'mixed', 'cutter', 'attach',
  ]);
  return businessWords.has(word.toLowerCase());
}

function isBadEmail(email) {
  if (!email) return true;

  // Check bad domains
  for (const domain of BAD_EMAIL_DOMAINS) {
    if (email.endsWith('@' + domain)) return true;
  }

  // Check bad patterns (hex IDs)
  for (const pattern of BAD_EMAIL_PATTERNS) {
    if (pattern.test(email)) return true;
  }

  return false;
}

// ============================================================
// LEMLIST API HELPERS
// ============================================================

function makeRequest(path, method, body) {
  return new Promise((resolve, reject) => {
    const apiKey = getCredential('lemlist', 'apiKey');
    const auth = Buffer.from(`:${apiKey}`).toString('base64');

    const options = {
      hostname: 'api.lemlist.com',
      path: path,
      method: method || 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    };

    if (body) {
      const postData = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(data ? JSON.parse(data) : { success: true });
          } catch (e) {
            resolve(data || { success: true });
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function updateLeadInLemlist(email, updates) {
  return makeRequest(
    `/api/campaigns/${CAMPAIGN_ID}/leads/${encodeURIComponent(email)}`,
    'PATCH',
    updates
  );
}

async function deleteLeadFromLemlist(email) {
  return makeRequest(
    `/api/campaigns/${CAMPAIGN_ID}/leads/${encodeURIComponent(email)}`,
    'DELETE'
  );
}

// ============================================================
// MAIN CLEANUP
// ============================================================

async function cleanup() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              LEAD CLEANUP - Fix Bad Names & Emails               ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Get all leads from DATABASE (Lemlist GET leads API returns empty)
  console.log('Reading leads from database...\n');

  const Database = require('better-sqlite3');
  const dbPath = './ksd/local-outreach/orchestrator/data/businesses.db';
  const db = new Database(dbPath);

  const leads = db.prepare(`
    SELECT id, name, owner_first_name, owner_last_name, owner_email,
           category, postcode, email_verified
    FROM businesses
    WHERE owner_email IS NOT NULL AND length(owner_email) > 0
    ORDER BY owner_first_name
  `).all();

  console.log(`Found ${leads.length} leads with emails in database\n`);

  // Step 2: Categorize issues
  const badNames = [];
  const badEmails = [];
  const goodLeads = [];

  for (const lead of leads) {
    if (isBadEmail(lead.owner_email)) {
      badEmails.push(lead);
    } else if (isBadName(lead.owner_first_name, lead.owner_last_name)) {
      badNames.push(lead);
    } else {
      goodLeads.push(lead);
    }
  }

  // Step 3: Report findings
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('ANALYSIS RESULTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`  GOOD leads:       ${goodLeads.length}`);
  console.log(`  BAD names:        ${badNames.length} (will fix to "there")`);
  console.log(`  BAD emails:       ${badEmails.length} (will DELETE from campaign)`);
  console.log();

  if (badEmails.length > 0) {
    console.log('--- BAD EMAILS (will be DELETED from Lemlist) ---');
    for (const lead of badEmails) {
      console.log(`  DELETE  "${lead.owner_first_name || ''} ${lead.owner_last_name || ''}" → ${lead.owner_email}`);
      console.log(`          Business: ${lead.name}`);
    }
    console.log();
  }

  if (badNames.length > 0) {
    console.log('--- BAD NAMES (will be fixed to "there") ---');
    for (const lead of badNames) {
      console.log(`  FIX     "${lead.owner_first_name} ${lead.owner_last_name}" → "there" (${lead.owner_email})`);
      console.log(`          Business: ${lead.name}`);
    }
    console.log();
  }

  // Show good leads for reference
  console.log('--- GOOD LEADS (no changes) ---');
  for (const lead of goodLeads) {
    const name = lead.owner_first_name
      ? `${lead.owner_first_name} ${lead.owner_last_name || ''}`.trim()
      : '(there)';
    console.log(`  OK      ${name} → ${lead.owner_email}`);
  }
  console.log();

  if (badNames.length === 0 && badEmails.length === 0) {
    console.log('All leads look good! Nothing to clean up.\n');
    db.close();
    return;
  }

  // Step 4: Ask for confirmation
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('ACTIONS TO TAKE:');
  console.log(`  - Delete ${badEmails.length} leads with bad emails from Lemlist`);
  console.log(`  - Fix ${badNames.length} leads with bad names → "there" in Lemlist`);
  console.log(`  - Update database for all changes`);
  console.log(`  - ${goodLeads.length} leads unchanged`);
  console.log(`  - Final campaign size: ~${goodLeads.length + badNames.length} leads`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const answer = await new Promise(resolve => {
    rl.question('Proceed with cleanup? (yes/no): ', resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
    console.log('\nCleanup cancelled.\n');
    db.close();
    return;
  }

  // Step 5: Execute cleanup
  console.log('\n--- Executing Lemlist cleanup ---\n');

  let deleted = 0;
  let fixed = 0;
  let errors = 0;

  // Delete bad email leads from Lemlist
  for (const lead of badEmails) {
    try {
      await deleteLeadFromLemlist(lead.owner_email);
      console.log(`  DELETED  ${lead.owner_email} (${lead.name})`);
      deleted++;
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (err) {
      console.log(`  ERROR deleting ${lead.owner_email}: ${err.message}`);
      errors++;
    }
  }

  // Fix bad name leads in Lemlist
  for (const lead of badNames) {
    try {
      await updateLeadInLemlist(lead.owner_email, {
        firstName: 'there',
        lastName: '',
        noNameNote: "I couldn't find your names anywhere! "
      });
      console.log(`  FIXED    "${lead.owner_first_name} ${lead.owner_last_name}" → "there" (${lead.owner_email})`);
      fixed++;
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (err) {
      console.log(`  ERROR fixing ${lead.owner_email}: ${err.message}`);
      errors++;
    }
  }

  // Step 6: Update database
  console.log('\n--- Updating database ---\n');

  const updateNameStmt = db.prepare(
    'UPDATE businesses SET owner_first_name = ?, owner_last_name = ? WHERE owner_email = ?'
  );
  const markBadEmailStmt = db.prepare(
    'UPDATE businesses SET email_verified = 0 WHERE owner_email = ?'
  );

  for (const lead of badNames) {
    try {
      updateNameStmt.run('there', '', lead.owner_email);
      console.log(`  DB FIXED  ${lead.owner_email}`);
    } catch (err) {
      console.log(`  DB ERROR  ${lead.owner_email}: ${err.message}`);
    }
  }

  for (const lead of badEmails) {
    try {
      markBadEmailStmt.run(lead.owner_email);
      console.log(`  DB MARKED BAD  ${lead.owner_email}`);
    } catch (err) {
      console.log(`  DB ERROR  ${lead.owner_email}: ${err.message}`);
    }
  }

  db.close();

  // Step 7: Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('CLEANUP COMPLETE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Deleted from Lemlist:   ${deleted}`);
  console.log(`  Names fixed to "there": ${fixed}`);
  console.log(`  Errors:                 ${errors}`);
  console.log(`  Campaign now has:       ~${goodLeads.length + fixed} leads`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

cleanup().catch(err => {
  console.error('Cleanup failed:', err.message);
  process.exit(1);
});
