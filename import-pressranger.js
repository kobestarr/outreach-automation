#!/usr/bin/env node

/**
 * PressRanger CSV Import Script
 *
 * Imports journalist/podcast contacts from PressRanger CSV exports,
 * optionally verifies emails through Reoon, and saves to DB with campaign tagging.
 *
 * Auto-detects CSV column names and maps them to DB fields.
 *
 * Usage:
 *   node import-pressranger.js --file=exports/journalists.csv --campaign=ufh-journalists --dry-run
 *   node import-pressranger.js --file=exports/journalists.csv --campaign=ufh-journalists --verify
 *   node import-pressranger.js --file=exports/journalists.csv --campaign=ufh-journalists
 *   node import-pressranger.js --file=exports/podcasts.csv --campaign=ufh-podcasts --type=podcast
 */

const fs = require('fs');
const path = require('path');
const { initDatabase, saveBusiness, checkDuplicate, closeDatabase, getBusinessStats } = require('./ksd/local-outreach/orchestrator/modules/database');
const { verifyEmail, checkAvailability } = require('./shared/outreach-core/email-verification/reoon-verifier');

// CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const FILE = getArg('file');
const CAMPAIGN = getArg('campaign');
const CONTACT_TYPE = getArg('type') || 'journalist'; // journalist, podcast, publisher
const VERIFY = hasFlag('verify');
const DRY_RUN = hasFlag('dry-run');
const SKIP_DUPES = !hasFlag('allow-dupes');

if (!FILE || !CAMPAIGN) {
  console.log(`
PressRanger CSV Import

Usage:
  node import-pressranger.js --file=<csv-path> --campaign=<name> [options]

Options:
  --file=<path>        Path to PressRanger CSV export (required)
  --campaign=<name>    Campaign tag to assign (required)
  --type=<type>        Contact type: journalist, podcast, publisher (default: journalist)
  --verify             Verify emails through Reoon before saving
  --dry-run            Preview what would be imported (no DB writes)
  --allow-dupes        Import even if contact already exists in DB

Examples:
  node import-pressranger.js --file=exports/ufh-journalists.csv --campaign=ufh-journalists --dry-run
  node import-pressranger.js --file=exports/ufh-journalists.csv --campaign=ufh-journalists --verify
  node import-pressranger.js --file=exports/ufh-podcasts.csv --campaign=ufh-podcasts --type=podcast
`);
  process.exit(1);
}

// --- CSV Parser (handles quoted fields, commas in values) ---

function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const parseLine = (line) => {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current.trim());
    return fields;
  };

  const headers = parseLine(lines[0]).map(h => h.replace(/^"(.*)"$/, '$1').trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    if (values.length === 0 || (values.length === 1 && !values[0])) continue;

    const row = {};
    headers.forEach((header, idx) => {
      row[header] = (values[idx] || '').replace(/^"(.*)"$/, '$1').trim();
    });
    rows.push(row);
  }

  return { headers, rows };
}

// --- Column Mapping (auto-detect PressRanger column names) ---

// Map of possible PressRanger column names → our field names
// We check multiple variants because we don't know the exact format
const COLUMN_MAP = {
  // Name fields
  name: ['name', 'full name', 'fullname', 'contact name', 'journalist name', 'host name', 'podcast name', 'show name', 'publisher name'],
  firstName: ['first name', 'firstname', 'first_name', 'given name'],
  lastName: ['last name', 'lastname', 'last_name', 'surname', 'family name'],

  // Contact fields
  email: ['email', 'email address', 'e-mail', 'contact email', 'work email', 'primary email'],
  phone: ['phone', 'phone number', 'telephone', 'mobile', 'cell'],
  website: ['website', 'url', 'site', 'web', 'website url', 'personal website', 'podcast url', 'show url'],

  // Organisation
  publication: ['publication', 'outlet', 'media outlet', 'publisher', 'company', 'organization', 'organisation', 'network'],
  title: ['title', 'job title', 'role', 'position'],

  // Topic/category
  category: ['category', 'categories', 'topic', 'topics', 'beat', 'beats', 'writing topics', 'niche', 'genre', 'tags'],

  // Location
  location: ['location', 'city', 'region', 'country', 'state', 'area'],

  // Social
  twitter: ['twitter', 'twitter url', 'x', 'x url', 'twitter handle', 'x handle'],
  linkedin: ['linkedin', 'linkedin url', 'linkedin profile'],
  instagram: ['instagram', 'instagram url', 'ig'],

  // Podcast-specific
  podcastDescription: ['description', 'show description', 'about', 'bio', 'summary'],
  episodeCount: ['episodes', 'episode count', 'total episodes'],
  listenerCount: ['listeners', 'listener count', 'monthly listeners', 'downloads'],
};

function mapColumns(headers) {
  const mapping = {};
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());

  for (const [field, variants] of Object.entries(COLUMN_MAP)) {
    for (const variant of variants) {
      const idx = lowerHeaders.indexOf(variant);
      if (idx !== -1) {
        mapping[field] = headers[idx]; // Use original header case
        break;
      }
    }
  }

  return mapping;
}

// --- Email Validation ---

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const cleaned = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return false;
  // Reject obvious junk
  if (cleaned.includes('example.com') || cleaned.includes('test.com')) return false;
  if (cleaned.includes('sentry') || cleaned.includes('wixpress')) return false;
  if (/^[a-f0-9]{20,}@/.test(cleaned)) return false; // Tracking hashes
  return true;
}

// --- Main ---

async function main() {
  console.log(`\n=== PressRanger Import: ${CAMPAIGN} ===\n`);
  console.log(`File: ${FILE}`);
  console.log(`Type: ${CONTACT_TYPE}`);
  console.log(`Verify emails: ${VERIFY ? 'Yes (Reoon)' : 'No'}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  // Read CSV
  const filePath = path.resolve(FILE);
  if (!fs.existsSync(filePath)) {
    console.error(`\nERROR: File not found: ${filePath}`);
    process.exit(1);
  }

  const csvText = fs.readFileSync(filePath, 'utf8');
  const { headers, rows } = parseCSV(csvText);

  console.log(`\nCSV loaded: ${rows.length} rows, ${headers.length} columns`);
  console.log(`Headers: ${headers.join(', ')}`);

  // Auto-detect column mapping
  const colMap = mapColumns(headers);
  console.log('\nColumn mapping detected:');
  for (const [field, header] of Object.entries(colMap)) {
    console.log(`  ${field.padEnd(20)} → "${header}"`);
  }

  // Check for unmapped headers (show what we're ignoring)
  const mappedHeaders = new Set(Object.values(colMap));
  const unmapped = headers.filter(h => !mappedHeaders.has(h));
  if (unmapped.length > 0) {
    console.log(`\nUnmapped columns (stored in raw data): ${unmapped.join(', ')}`);
  }

  // Check we have at least a name or email
  if (!colMap.name && !colMap.firstName && !colMap.email) {
    console.error('\nERROR: Could not detect name or email columns. Check CSV headers.');
    console.log('Expected columns like: Name, Email, First Name, etc.');
    process.exit(1);
  }

  // Parse rows into contacts
  const contacts = rows.map(row => {
    const get = (field) => row[colMap[field]] || '';

    // Build name from available fields
    let firstName = get('firstName');
    let lastName = get('lastName');
    let fullName = get('name');

    if (!firstName && fullName) {
      const parts = fullName.trim().split(/\s+/);
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }
    if (!fullName && firstName) {
      fullName = `${firstName} ${lastName}`.trim();
    }

    const email = get('email').toLowerCase().trim();

    return {
      name: fullName || get('publication') || email.split('@')[0] || 'Unknown',
      firstName,
      lastName,
      email: isValidEmail(email) ? email : null,
      rawEmail: email || null, // Keep original even if invalid
      phone: get('phone'),
      website: get('website'),
      publication: get('publication'),
      title: get('title'),
      category: get('category'),
      location: get('location'),
      twitter: get('twitter'),
      linkedin: get('linkedin'),
      instagram: get('instagram'),
      podcastDescription: get('podcastDescription'),
      episodeCount: get('episodeCount'),
      listenerCount: get('listenerCount'),
      contactType: CONTACT_TYPE,
      source: 'pressranger',
      // Store all raw CSV data for reference
      rawData: { ...row },
    };
  });

  // Stats
  const withEmail = contacts.filter(c => c.email);
  const withPhone = contacts.filter(c => c.phone);
  const withName = contacts.filter(c => c.firstName);
  const withWebsite = contacts.filter(c => c.website);
  const invalidEmails = contacts.filter(c => c.rawEmail && !c.email);

  console.log(`\n--- Contact Summary ---`);
  console.log(`Total contacts: ${contacts.length}`);
  console.log(`With valid email: ${withEmail.length}`);
  console.log(`With phone: ${withPhone.length}`);
  console.log(`With name: ${withName.length}`);
  console.log(`With website: ${withWebsite.length}`);
  if (invalidEmails.length > 0) {
    console.log(`Invalid emails filtered: ${invalidEmails.length}`);
  }

  // Preview
  console.log(`\n--- Preview (first 10) ---\n`);
  for (const c of contacts.slice(0, 10)) {
    const nameStr = c.firstName ? `${c.firstName} ${c.lastName}`.trim() : c.name;
    const pubStr = c.publication ? ` [${c.publication}]` : '';
    const emailStr = c.email || '(no email)';
    console.log(`  ${nameStr}${pubStr} — ${emailStr}`);
  }
  if (contacts.length > 10) console.log(`  ... and ${contacts.length - 10} more`);

  if (DRY_RUN) {
    console.log('\nDRY RUN — no changes made. Remove --dry-run to import.\n');
    return;
  }

  // Initialize DB
  initDatabase();

  // Check for duplicates
  let toImport = contacts;
  const dupes = [];

  if (SKIP_DUPES) {
    toImport = [];
    for (const c of contacts) {
      const existingId = checkDuplicate({
        name: c.name,
        postcode: '',
        website: c.website,
        address: '',
      });
      if (existingId) {
        dupes.push({ name: c.name, existingId });
      } else {
        toImport.push(c);
      }
    }

    if (dupes.length > 0) {
      console.log(`\nDuplicates found (skipped): ${dupes.length}`);
      for (const d of dupes.slice(0, 5)) {
        console.log(`  - ${d.name} (existing: ${d.existingId})`);
      }
      if (dupes.length > 5) console.log(`  ... and ${dupes.length - 5} more`);
    }
  }

  console.log(`\nImporting: ${toImport.length} contacts`);

  // Email verification (if requested)
  const verificationResults = new Map();

  if (VERIFY) {
    const emailsToVerify = toImport.filter(c => c.email).map(c => c.email);
    console.log(`\n--- Email Verification (Reoon) ---\n`);

    const availability = checkAvailability();
    console.log(`Reoon quota: ${availability.remaining} remaining`);

    if (emailsToVerify.length > availability.remaining) {
      console.log(`WARNING: Only ${availability.remaining} verifications available, need ${emailsToVerify.length}`);
      console.log(`Will verify first ${availability.remaining} emails\n`);
    }

    const toVerify = emailsToVerify.slice(0, availability.remaining);
    let verified = 0, valid = 0, invalid = 0, errors = 0;

    for (let i = 0; i < toVerify.length; i++) {
      const email = toVerify[i];
      process.stdout.write(`  [${i + 1}/${toVerify.length}] ${email.padEnd(40)} `);

      try {
        const result = await verifyEmail(email, 'power');
        verificationResults.set(email, result);
        verified++;

        if (result.isValid || result.isSafeToSend) {
          valid++;
          console.log(`VALID (${result.status})`);
        } else {
          invalid++;
          console.log(`INVALID (${result.status}${result.reason ? ': ' + result.reason : ''})`);
        }
      } catch (err) {
        errors++;
        console.log(`ERROR: ${err.message.substring(0, 50)}`);
      }

      // Small delay between verifications
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`\nVerification summary: ${valid} valid, ${invalid} invalid, ${errors} errors`);
  }

  // Save to DB
  console.log(`\n--- Saving to Database ---\n`);
  let saved = 0, updated = 0, skippedInvalid = 0;

  for (const c of toImport) {
    // If we verified and the email is invalid, skip or save without email
    let emailVerified = false;
    let emailToSave = c.email;

    if (VERIFY && c.email) {
      const vResult = verificationResults.get(c.email);
      if (vResult) {
        if (vResult.isValid || vResult.isSafeToSend) {
          emailVerified = true;
        } else {
          emailToSave = null; // Don't save invalid emails
          skippedInvalid++;
        }
      }
    }

    // Build business object for DB
    const business = {
      name: c.name,
      businessName: c.name,
      category: c.category || CONTACT_TYPE,
      address: c.publication || '', // Use publication as address equivalent
      postcode: '',
      phone: c.phone,
      website: c.website,
      email: emailToSave,
      ownerEmail: emailToSave,
      ownerFirstName: c.firstName,
      ownerLastName: c.lastName,
      emailSource: 'pressranger',
      emailVerified: emailVerified,
      linkedInUrl: c.linkedin,
      // Store full PressRanger data in the business JSON
      contactType: c.contactType,
      source: 'pressranger',
      publication: c.publication,
      title: c.title,
      twitter: c.twitter,
      instagram: c.instagram,
      podcastDescription: c.podcastDescription,
      episodeCount: c.episodeCount,
      listenerCount: c.listenerCount,
      rawPressRangerData: c.rawData,
    };

    const existingId = checkDuplicate(business);

    saveBusiness(business, {
      location: c.location || '',
      postcode: '',
      status: emailVerified ? 'verified' : 'imported',
      scrapedAt: new Date().toISOString(),
      enrichedAt: null,
      campaigns: [CAMPAIGN],
    });

    if (existingId) {
      updated++;
    } else {
      saved++;
    }
  }

  console.log(`  New records: ${saved}`);
  console.log(`  Updated (campaign tag added): ${updated}`);
  if (skippedInvalid > 0) {
    console.log(`  Emails removed (failed verification): ${skippedInvalid}`);
  }

  // Campaign stats
  const stats = getBusinessStats({ campaign: CAMPAIGN });
  console.log(`\n${CAMPAIGN} campaign now has: ${stats.total} contacts`);
  console.log(`  With email: ${stats.withEmail}`);

  console.log(`\nNext steps:`);
  console.log(`  1. Export as CSV: node export-campaign.js --campaign=${CAMPAIGN} --format=csv`);
  if (!VERIFY) {
    console.log(`  2. Verify emails: node import-pressranger.js --file=${FILE} --campaign=${CAMPAIGN} --verify`);
  }
  console.log(`  3. View campaign: node export-campaign.js --list\n`);

  closeDatabase();
}

main().catch(err => {
  console.error('Fatal error:', err);
  closeDatabase();
  process.exit(1);
});
