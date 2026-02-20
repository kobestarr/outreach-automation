/**
 * Re-export Clean Leads to Lemlist
 *
 * Reads all verified leads from database and exports to Lemlist campaign.
 * Handles name resolution: DB name → email extraction → "there" fallback.
 * Generates all merge variables (localIntro, observation, pricing, etc.)
 */

const Database = require('better-sqlite3');
const { addLeadToCampaign } = require('./shared/outreach-core/export-managers/lemlist-exporter');
const { getAllMergeVariables } = require('./shared/outreach-core/content-generation/email-merge-variables');
const { isValidPersonName, extractNameFromEmail, isValidEmail, isValidNamePair } = require('./shared/outreach-core/validation/data-quality');

const CAMPAIGN_ID = 'cam_bJYSQ4pqMzasQWsRb';
const DB_PATH = './ksd/local-outreach/orchestrator/data/businesses.db';
const DELAY_MS = 500; // Between API calls
const AUTO_CONFIRM = process.argv.includes('--yes');

// Category filtering
const TRADE_CATEGORIES = [
  'builders', 'electricians', 'plumbers', 'cleaners', 'gardeners',
  'roofers', 'landscapers', 'painters and decorators', 'plasterers', 'tilers',
  'fencing contractors', 'heating engineers', 'boiler installers', 'handymen',
  'bathroom fitters', 'kitchen fitters', 'window cleaners', 'driveway contractors',
  'tree surgeons', 'locksmiths', 'pest control', 'carpet cleaners', 'car mechanics'
];
const EXCLUDE_TRADES = process.argv.includes('--exclude-trades');
const ONLY_TRADES = process.argv.includes('--only-trades');
const CATEGORY_FILTER = process.argv.find(a => a.startsWith('--category='));
const SPECIFIC_CATEGORY = CATEGORY_FILTER ? CATEGORY_FILTER.split('=')[1] : null;

/**
 * Clean business name for use in customer-facing emails
 * - Strips internal annotations like "(SALES PAGE ONLY)"
 * - Title-cases ALL CAPS multi-word names
 */
function cleanBusinessNameForEmail(name) {
  if (!name) return name;

  // Strip parenthetical internal annotations
  let cleaned = name.replace(/\s*\([^)]*\)\s*/g, '').trim();

  // Title-case ALL CAPS multi-word names (but leave single-word acronyms like "EMS-IT" alone)
  if (cleaned === cleaned.toUpperCase() && /\s/.test(cleaned)) {
    cleaned = cleaned.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  return cleaned;
}

/**
 * Determine the final firstName for a lead
 * Priority: DB name → email extraction → "there"
 */
function resolveFirstName(lead) {
  const dbName = lead.owner_first_name;

  // 1. Valid DB name
  if (dbName && dbName !== 'there' && isValidPersonName(dbName)) {
    // Also check name pair validation
    if (isValidNamePair(dbName, lead.owner_last_name || '')) {
      return { firstName: dbName, lastName: lead.owner_last_name || '', usedFallback: false };
    }
  }

  // 2. Team names (e.g., "CRO Info Team") - always valid
  if (dbName && dbName.endsWith(' Team')) {
    return { firstName: dbName, lastName: '', usedFallback: false };
  }

  // 3. Extract from email
  const email = lead.owner_email;
  if (email) {
    const extracted = extractNameFromEmail(email);
    if (extracted) {
      const parts = extracted.split(' ');
      const first = parts[0];
      const last = parts.slice(1).join(' ');
      if (isValidPersonName(first) && isValidNamePair(first, last)) {
        return { firstName: first, lastName: last, usedFallback: false };
      }
    }
  }

  // 4. Fallback to "there"
  return { firstName: 'there', lastName: '', usedFallback: true };
}

async function reexport() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║           RE-EXPORT CLEAN LEADS TO LEMLIST                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const db = new Database(DB_PATH);

  // Build query with category filters
  let query = `SELECT * FROM businesses
    WHERE owner_email IS NOT NULL AND length(owner_email) > 0
    AND (email_verified IS NULL OR email_verified != 0)`;
  const params = [];

  if (EXCLUDE_TRADES) {
    query += ` AND category NOT IN (${TRADE_CATEGORIES.map(() => '?').join(',')})`;
    params.push(...TRADE_CATEGORIES);
    console.log(`Excluding trades: ${TRADE_CATEGORIES.join(', ')}\n`);
  } else if (ONLY_TRADES) {
    query += ` AND category IN (${TRADE_CATEGORIES.map(() => '?').join(',')})`;
    params.push(...TRADE_CATEGORIES);
    console.log(`Only trades: ${TRADE_CATEGORIES.join(', ')}\n`);
  } else if (SPECIFIC_CATEGORY) {
    query += ` AND category = ?`;
    params.push(SPECIFIC_CATEGORY);
    console.log(`Category filter: ${SPECIFIC_CATEGORY}\n`);
  }

  query += ` ORDER BY name`;
  const leads = db.prepare(query).all(...params);

  console.log(`Found ${leads.length} verified leads in database\n`);

  // Pre-process: resolve names and validate
  const toExport = [];
  const toSkip = [];

  for (const lead of leads) {
    // Validate email first
    if (!isValidEmail(lead.owner_email)) {
      toSkip.push({ lead, reason: `Bad email: ${lead.owner_email}` });
      continue;
    }

    // Resolve name
    const { firstName, lastName, usedFallback } = resolveFirstName(lead);

    toExport.push({
      lead,
      firstName,
      lastName,
      usedFallback
    });
  }

  // Report plan
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  TO EXPORT: ${toExport.length} leads`);
  console.log(`  SKIPPED:   ${toSkip.length} leads (bad email)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const named = toExport.filter(e => !e.usedFallback && !e.firstName.endsWith(' Team'));
  const teams = toExport.filter(e => e.firstName.endsWith(' Team'));
  const fallbacks = toExport.filter(e => e.usedFallback);

  console.log(`  Named leads:    ${named.length} (real person names)`);
  console.log(`  Team leads:     ${teams.length} (company team fallback)`);
  console.log(`  "there" leads:  ${fallbacks.length} (generic email, no name found)`);
  console.log();

  if (toSkip.length > 0) {
    console.log('--- SKIPPED ---');
    for (const { lead, reason } of toSkip) {
      console.log(`  SKIP  ${lead.name}: ${reason}`);
    }
    console.log();
  }

  // Preview all leads
  console.log('--- EXPORT PREVIEW ---');
  for (const { lead, firstName, lastName, usedFallback } of toExport) {
    const nameDisplay = usedFallback ? '(there)' : `${firstName} ${lastName}`.trim();
    const tag = usedFallback ? 'THERE' : firstName.endsWith(' Team') ? 'TEAM ' : 'NAME ';
    const displayBizName = cleanBusinessNameForEmail(lead.name);
    console.log(`  ${tag}  ${nameDisplay.padEnd(25)} → ${lead.owner_email.padEnd(45)} ${displayBizName}`);
  }
  console.log();

  // Confirm
  if (!AUTO_CONFIRM) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
      rl.question(`Export ${toExport.length} leads to Lemlist campaign? (yes/no): `, resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
      console.log('\nExport cancelled.\n');
      db.close();
      return;
    }
  } else {
    console.log(`Auto-confirming export of ${toExport.length} leads...\n`);
  }

  // Execute export
  console.log('\n--- Exporting to Lemlist ---\n');

  let exported = 0;
  let duplicates = 0;
  let errors = 0;

  for (const { lead, firstName, lastName, usedFallback } of toExport) {
    // Build business object for merge variables
    let businessData = {};
    try {
      businessData = lead.business_data ? JSON.parse(lead.business_data) : {};
    } catch (e) {
      // Ignore JSON parse errors
    }

    const cleanName = cleanBusinessNameForEmail(lead.name);

    const business = {
      ...businessData,
      name: cleanName,
      businessName: cleanName,
      ownerFirstName: firstName,
      ownerLastName: lastName,
      ownerEmail: lead.owner_email,
      emailVerified: true,
      emailSource: lead.email_source || 'valid',
      website: lead.website,
      phone: lead.phone,
      category: lead.category,
      location: lead.location,
      postcode: lead.postcode,
      address: lead.address,
      assignedOfferTier: lead.assigned_tier,
      usedFallbackName: usedFallback,
      // Preserve owners array from business_data for multi-owner note generation
      owners: businessData.owners || undefined
    };

    // Generate merge variables
    const mergeVars = getAllMergeVariables(business);

    // Build lead data for Lemlist API
    const leadData = {
      email: lead.owner_email,
      firstName: firstName,
      lastName: lastName,
      companyName: cleanName,
      phone: lead.phone,
      companyDomain: lead.website ? (() => {
        try { return new URL(lead.website).hostname.replace(/^www\./, ''); } catch { return null; }
      })() : null,
      timezone: 'Europe/London',
      // Merge variables
      localIntro: mergeVars.localIntro,
      observationSignal: mergeVars.observationSignal,
      meetingOption: mergeVars.meetingOption,
      microOfferPrice: mergeVars.microOfferPrice,
      multiOwnerNote: mergeVars.multiOwnerNote || '',
      noNameNote: mergeVars.noNameNote || '',
      businessType: mergeVars.businessType,
      location: mergeVars.location || lead.location || ''
    };

    try {
      await addLeadToCampaign(CAMPAIGN_ID, leadData);
      const nameTag = usedFallback ? '(there)' : firstName;
      console.log(`  OK    ${nameTag.padEnd(22)} ${lead.owner_email.padEnd(45)} ${lead.name}`);
      exported++;

      // Update database: mark as exported
      db.prepare('UPDATE businesses SET exported_to = ?, exported_at = ? WHERE id = ?')
        .run('lemlist', new Date().toISOString(), lead.id);

      // Rate limit
      await new Promise(r => setTimeout(r, DELAY_MS));
    } catch (err) {
      if (err.message.includes('DUPLICATE') || err.message.includes('already exist')) {
        console.log(`  DUP   ${lead.owner_email.padEnd(45)} ${lead.name}`);
        duplicates++;
      } else {
        console.log(`  ERR   ${lead.owner_email}: ${err.message}`);
        errors++;
      }
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  db.close();

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('EXPORT COMPLETE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Exported:    ${exported}`);
  console.log(`  Duplicates:  ${duplicates}`);
  console.log(`  Errors:      ${errors}`);
  console.log(`  Total:       ${exported + duplicates + errors} / ${toExport.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (errors > 0) {
    console.log('Some leads failed to export. Check errors above.\n');
    process.exit(1);
  } else {
    console.log('All leads exported successfully!\n');
  }
}

reexport().catch(err => {
  console.error('Export failed:', err.message);
  process.exit(1);
});
