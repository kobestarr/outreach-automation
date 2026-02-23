#!/usr/bin/env node

/**
 * Verify football club emails through Reoon
 * Reads both Mailead CSVs, dedupes, verifies, and re-exports clean CSVs
 */

const fs = require('fs');
const path = require('path');
const { verifyEmail, checkAvailability } = require('./shared/outreach-core/email-verification/reoon-verifier');

const DRY_RUN = process.argv.includes('--dry-run');

function parseCsvLine(line) {
  const parts = [];
  let current = '', inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  const files = [
    'exports/ufh-football-clubs-mailead-2026-02-22.csv',
    'exports/ufh-chelsea-area-clubs-mailead-2026-02-22.csv',
  ];

  // Check Reoon availability
  const avail = checkAvailability();
  console.log(`Reoon remaining today: ${avail.remaining}`);

  // Collect all unique emails across both files
  const emailSet = new Set();
  const fileData = {};

  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const header = lines[0];
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const parts = parseCsvLine(lines[i]);
      const email = parts[0]?.trim().toLowerCase();
      if (email) emailSet.add(email);
      rows.push({ line: lines[i], parts, email });
    }
    fileData[file] = { header, rows };
    console.log(`${file}: ${rows.length} rows`);
  }

  const uniqueEmails = [...emailSet];
  console.log(`\nUnique emails to verify: ${uniqueEmails.length}`);

  if (uniqueEmails.length > avail.remaining) {
    console.log(`WARNING: Only ${avail.remaining} verifications remaining. Will verify first ${avail.remaining}.`);
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN — would verify these emails. Run without --dry-run to proceed.');
    return;
  }

  // Verify all emails
  const results = {};
  let valid = 0, invalid = 0, risky = 0, errors = 0;

  for (let i = 0; i < uniqueEmails.length; i++) {
    const email = uniqueEmails[i];
    process.stdout.write(`  [${i + 1}/${uniqueEmails.length}] ${email.padEnd(45)} `);

    try {
      const result = await verifyEmail(email, 'power');
      results[email] = result;

      if (result.isValid) {
        valid++;
        console.log(`VALID (${result.status}, score: ${result.score})`);
      } else if (result.status === 'risky' || result.status === 'unknown') {
        risky++;
        console.log(`RISKY (${result.status}, score: ${result.score})`);
      } else {
        invalid++;
        console.log(`INVALID (${result.status}, reason: ${result.reason || '-'})`);
      }

      // Small delay between requests
      await new Promise(r => setTimeout(r, 150));
    } catch (err) {
      errors++;
      console.log(`ERROR: ${err.message.substring(0, 50)}`);
      results[email] = { isValid: false, status: 'error', email };
    }
  }

  // Summary
  console.log('\n=== VERIFICATION SUMMARY ===');
  console.log(`Valid: ${valid} | Invalid: ${invalid} | Risky: ${risky} | Errors: ${errors}`);

  // Re-export both files, removing invalid emails
  for (const file of files) {
    const { header, rows } = fileData[file];
    const validRows = rows.filter(r => {
      const result = results[r.email];
      // Keep valid and risky (risky = catch-all servers etc, usually deliverable)
      return result && (result.isValid || result.status === 'risky' || result.status === 'unknown');
    });
    const invalidRows = rows.filter(r => {
      const result = results[r.email];
      return result && !result.isValid && result.status !== 'risky' && result.status !== 'unknown';
    });

    // Write verified CSV
    const verifiedFile = file.replace('.csv', '-verified.csv');
    const csv = [header, ...validRows.map(r => r.line)].join('\n');
    fs.writeFileSync(verifiedFile, csv);

    console.log(`\n${path.basename(file)}:`);
    console.log(`  Original: ${rows.length} | Verified valid: ${validRows.length} | Removed: ${invalidRows.length}`);
    console.log(`  Saved: ${verifiedFile}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
