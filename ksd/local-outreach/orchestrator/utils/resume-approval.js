/**
 * Resume Approval Utility
 * Exports businesses with approved categories for a specific location/postcode
 */

const readline = require('readline');
const { loadApprovedTemplates } = require("../../../../shared/outreach-core/approval-system/approval-manager");
const { loadBusinesses, updateBusiness, generateBusinessId } = require("../modules/database");
const { generateOutreachContent } = require("../../../../shared/outreach-core/content-generation");
const { exportToLemlist } = require("../../../../shared/outreach-core/export-managers/lemlist-exporter");
const logger = require("../../../../shared/outreach-core/logger");

// Helper for CLI-friendly output (uses logger for consistency)
const cli = {
  log: (message) => logger.cli(message),
  info: (message, meta) => logger.info('resume-approval', message, meta),
  error: (message, meta) => logger.error('resume-approval', message, meta),
  warn: (message, meta) => logger.warn('resume-approval', message, meta)
};

// Create readline interface for prompts
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Create simple prompt using readline
 * @param {string} question - Prompt text
 * @returns {Promise<string>} User input
 */
function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Display export summary
 * @param {Array} records - Business records to export
 */
function displayExportSummary(records) {
  cli.log(`${'─'.repeat(68)}`);
  cli.log(`EXPORT SUMMARY`);
  cli.log(`${'─'.repeat(68)}\n`);
  cli.log(`Will export ${records.length} businesses:\n`);

  records.slice(0, 10).forEach((record, i) => {
    const business = record.business;
    cli.log(`  ${i + 1}. ${business.name} (${business.category}) - ${business.ownerEmail || 'no email'}`);
  });

  if (records.length > 10) {
    cli.log(`  ... and ${records.length - 10} more`);
  }

  cli.log(`\nExport to Lemlist campaign: ${process.env.LEMLIST_CAMPAIGN_ID || 'NOT SET'}`);
}

/**
 * Resume export for approved categories
 * @param {string} location - Location name (e.g., "Bramhall")
 * @param {string} postcode - Postcode prefix (e.g., "SK7")
 */
async function resumeApproval(location, postcode) {
  cli.log(`\n=== RESUME APPROVAL EXPORT ===\n`);
  cli.log(`Location: ${location} (${postcode})`);

  // Load approved templates
  const approvedTemplates = loadApprovedTemplates();
  const approvedCategories = Object.keys(approvedTemplates);

  if (approvedCategories.length === 0) {
    cli.log(`\n✗ No approved categories found. Run approve-cli first.\n`);
    rl.close();
    process.exit(1);
  }

  cli.log(`Approved categories: ${approvedCategories.join(', ')}\n`);

  // Load businesses with status="enriched" (not yet exported)
  const records = loadBusinesses({
    status: "enriched",
    location: location,
    postcode: postcode
  });

  cli.log(`Found ${records.length} enriched businesses\n`);

  // Filter to approved categories only
  const toExport = records.filter(record => {
    const category = (record.business.category || "unknown").toLowerCase();
    return approvedCategories.includes(category);
  });

  if (toExport.length === 0) {
    cli.log(`\n✗ No businesses with approved categories found.\n`);
    rl.close();
    process.exit(0);
  }

  cli.log(`Businesses to export: ${toExport.length}\n`);
  displayExportSummary(toExport);

  // Confirm export
  const confirm = await prompt(`\nConfirm export? (y/n): `);
  if (confirm.toLowerCase() !== 'y') {
    console.log(`\nExport cancelled.\n`);
    rl.close();
    process.exit(0);
  }

  // Export each business
  const results = { success: 0, failed: 0, errors: [] };

  for (const record of toExport) {
    try {
      const business = record.business;

      // Skip if no email
      if (!business.ownerEmail) {
        cli.log(`[SKIP] ${business.name} - no email address`);
        continue;
      }

      // Generate content (using approved template)
      const content = await generateOutreachContent(business, {
        provider: process.env.CONTENT_PROVIDER || 'claude',
        generateEmail: true,
        emailSequence: true
      });

      // Export to Lemlist
      const campaignId = process.env.LEMLIST_CAMPAIGN_ID;
      if (campaignId) {
        await exportToLemlist(business, campaignId, content.emailSequence);

        // Update database status
        const businessId = generateBusinessId(business);
        updateBusiness(businessId, {
          status: "exported",
          exportedTo: ["lemlist"],
          exportedAt: new Date().toISOString()
        });

        logger.info('resume-approval', `Exported ${business.name} to lemlist`);
        cli.log(`[${new Date().toISOString()}] [INFO] Exported ${business.name} to lemlist`);
        results.success++;
      }
    } catch (error) {
      logger.error('resume-approval', 'Export failed', {
        business: record.business.name,
        error: error.message
      });
      cli.error(`Failed to export ${record.business.name}`, { error: error.message });
      results.failed++;
      results.errors.push({ business: record.business.name, error: error.message });
    }
  }

  // Display results
  cli.log(`\n✓ Successfully exported ${results.success} businesses`);
  if (results.failed > 0) {
    cli.log(`✗ Failed: ${results.failed}`);
    cli.log(`\nErrors:`);
    results.errors.forEach(err => {
      cli.log(`  - ${err.business}: ${err.error}`);
    });
  }

  cli.log(`\nNext steps:`);
  cli.log(`  1. Check Lemlist campaign: ${process.env.LEMLIST_CAMPAIGN_ID}`);
  cli.log(`  2. Verify email sequences in Lemlist UI`);
  cli.log(`  3. Launch campaign when ready\n`);

  rl.close();
}

/**
 * Print usage information
 */
function printUsage() {
  cli.log(`\nUsage: node resume-approval.js <location> <postcode>`);
  cli.log(`Example: node resume-approval.js Bramhall SK7\n`);
  cli.log(`Environment variables required:`);
  cli.log(`  LEMLIST_CAMPAIGN_ID  - Lemlist campaign ID (e.g., cam_9NsHPnykWESTncCW8)`);
  cli.log(`  LEMLIST_API_KEY      - Lemlist API key`);
  cli.log(`  CONTENT_PROVIDER     - claude or openai (optional, defaults to claude)\n`);
}

// CLI entry point
if (require.main === module) {
  const location = process.argv[2];
  const postcode = process.argv[3];

  if (!location || !postcode) {
    printUsage();
    process.exit(1);
  }

  if (!process.env.LEMLIST_CAMPAIGN_ID) {
    cli.error(`LEMLIST_CAMPAIGN_ID not set in environment`);
    cli.log(`Set it with: export LEMLIST_CAMPAIGN_ID=cam_YOUR_CAMPAIGN_ID\n`);
    process.exit(1);
  }

  if (!process.env.LEMLIST_API_KEY) {
    cli.error(`LEMLIST_API_KEY not set in environment`);
    cli.log(`Set it with: export LEMLIST_API_KEY=lem_YOUR_API_KEY\n`);
    process.exit(1);
  }

  resumeApproval(location, postcode).catch(err => {
    cli.error(`Error: ${err.message}`);
    rl.close();
    process.exit(1);
  });
}

module.exports = { resumeApproval };
