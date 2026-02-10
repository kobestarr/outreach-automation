#!/usr/bin/env node
/**
 * Generic Business Export Utility
 * Exports ANY enriched business to Lemlist with optional LinkedIn enrichment
 *
 * Usage:
 *   node export-business.js <business-name-or-id> [--skip-linkedin]
 *   node export-business.js "KissDental Bramhall"
 *   node export-business.js kissdental-bramhall-sk71pa-c260c5f9
 *   node export-business.js "KissDental" --skip-linkedin
 */

const { loadBusinesses, updateBusiness, getBusiness } = require("../modules/database");
const { enrichLinkedIn } = require("../../../../shared/outreach-core/linkedin-enrichment");
const { generateOutreachContent } = require("../../../../shared/outreach-core/content-generation");
const { exportToLemlist, configureCampaignSequence } = require("../../../../shared/outreach-core/export-managers/lemlist-exporter");
const { getCredential } = require("../../../../shared/outreach-core/credentials-loader");
const logger = require("../../../../shared/outreach-core/logger");

/**
 * Export a business to Lemlist with full workflow
 * @param {string} businessNameOrId - Business name or database ID
 * @param {Object} options - Export options
 * @returns {Promise<Object>} Export results
 */
async function exportBusiness(businessNameOrId, options = {}) {
  const {
    skipLinkedIn = false,
    campaignId = process.env.LEMLIST_CAMPAIGN_ID || getCredential('lemlist', 'campaignId'),
    contentProvider = process.env.CONTENT_PROVIDER || 'claude',
    dryRun = false
  } = options;

  console.log(`\n=== EXPORT BUSINESS TO LEMLIST ===\n`);
  console.log(`Business: ${businessNameOrId}`);
  console.log(`Campaign: ${campaignId || 'NOT SET'}`);
  console.log(`LinkedIn Enrichment: ${skipLinkedIn ? 'SKIPPED' : 'ENABLED'}`);
  console.log(`Content Provider: ${contentProvider}`);
  console.log(`Dry Run: ${dryRun ? 'YES' : 'NO'}\n`);

  // Validate environment
  if (!campaignId && !dryRun) {
    throw new Error('LEMLIST_CAMPAIGN_ID environment variable not set');
  }

  // Find business in database
  let businessRecord = null;

  // Try as ID first
  businessRecord = getBusiness(businessNameOrId);

  // If not found, search by name
  if (!businessRecord) {
    const allBusinesses = loadBusinesses({ limit: 1000 });
    businessRecord = allBusinesses.find(b =>
      b.business.name?.toLowerCase().includes(businessNameOrId.toLowerCase()) ||
      b.business.businessName?.toLowerCase().includes(businessNameOrId.toLowerCase())
    );
  }

  if (!businessRecord) {
    throw new Error(`Business not found: ${businessNameOrId}`);
  }

  console.log(`✓ Found business: ${businessRecord.business.name || businessRecord.business.businessName}`);
  console.log(`  ID: ${businessRecord.id}`);
  console.log(`  Status: ${businessRecord.status}`);
  console.log(`  Category: ${businessRecord.business.category}`);
  console.log(`  Owners: ${businessRecord.business.owners?.length || 1}\n`);

  const results = {
    businessId: businessRecord.id,
    businessName: businessRecord.business.name || businessRecord.business.businessName,
    linkedInEnriched: false,
    emailGenerated: false,
    exported: false,
    lemlistLeads: [],
    errors: []
  };

  // Step 1: LinkedIn Enrichment (if enabled and needed)
  if (!skipLinkedIn) {
    console.log(`--- Step 1: LinkedIn Enrichment ---\n`);

    const business = businessRecord.business;
    const owners = business.owners || [
      {
        firstName: business.ownerFirstName,
        lastName: business.ownerLastName,
        email: business.ownerEmail
      }
    ];

    let linkedInUpdates = [];

    for (let i = 0; i < owners.length; i++) {
      const owner = owners[i];

      // Skip if already has LinkedIn URL
      if (owner.linkedInUrl) {
        console.log(`  ${owner.firstName} ${owner.lastName}: Already has LinkedIn URL (${owner.linkedInUrl})`);
        continue;
      }

      console.log(`  Enriching ${owner.firstName} ${owner.lastName}...`);

      try {
        // Pass full business object with current owner's details merged
        const enrichmentResult = await enrichLinkedIn({
          ...business, // Include category, revenue, tier, etc. for decision logic
          ownerFirstName: owner.firstName,
          ownerLastName: owner.lastName
        });

        if (enrichmentResult.enriched) {
          console.log(`    ✓ LinkedIn profile found: ${enrichmentResult.linkedInUrl}`);
          linkedInUpdates.push({
            ownerIndex: i,
            linkedInUrl: enrichmentResult.linkedInUrl,
            linkedInData: enrichmentResult.linkedInData
          });
          results.linkedInEnriched = true;
        } else {
          console.log(`    ✗ LinkedIn profile not found (${enrichmentResult.reason})`);
        }
      } catch (error) {
        console.error(`    ✗ Enrichment failed: ${error.message}`);
        results.errors.push({
          step: 'linkedin_enrichment',
          owner: `${owner.firstName} ${owner.lastName}`,
          error: error.message
        });
      }

      // Rate limiting delay
      if (i < owners.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Update database with LinkedIn data
    if (linkedInUpdates.length > 0 && !dryRun) {
      const updatedBusiness = { ...businessRecord.business };

      if (updatedBusiness.owners) {
        linkedInUpdates.forEach(update => {
          updatedBusiness.owners[update.ownerIndex].linkedInUrl = update.linkedInUrl;
          updatedBusiness.owners[update.ownerIndex].linkedInData = update.linkedInData;
        });
      } else {
        // Single owner case
        if (linkedInUpdates[0]) {
          updatedBusiness.linkedInUrl = linkedInUpdates[0].linkedInUrl;
          updatedBusiness.linkedInData = linkedInUpdates[0].linkedInData;
        }
      }

      updateBusiness(businessRecord.id, { business: updatedBusiness });
      console.log(`\n  ✓ Database updated with LinkedIn data\n`);

      // Reload business record with updated data
      businessRecord = getBusiness(businessRecord.id);
    }
  } else {
    console.log(`--- Step 1: LinkedIn Enrichment SKIPPED ---\n`);
  }

  // Step 2: Generate Email Content
  console.log(`--- Step 2: Generate Email Content ---\n`);

  let emailContent = null;

  try {
    emailContent = await generateOutreachContent(businessRecord.business, {
      provider: contentProvider,
      generateEmail: true,
      emailSequence: true
    });

    // Use first email from sequence if email field not present
    const firstEmail = emailContent.email || (emailContent.emailSequence && emailContent.emailSequence[0]);

    if (!firstEmail) {
      throw new Error('No email content generated');
    }

    console.log(`  ✓ Email generated\n`);
    console.log(`  Subject: ${firstEmail.subject}`);
    console.log(`  Body Preview: ${firstEmail.body.substring(0, 150)}...\n`);

    results.emailGenerated = true;
    results.emailSubject = firstEmail.subject;
  } catch (error) {
    console.error(`  ✗ Email generation failed: ${error.message}\n`);
    results.errors.push({
      step: 'email_generation',
      error: error.message
    });
    throw error;
  }

  // Step 3: Export to Lemlist
  if (dryRun) {
    console.log(`--- Step 3: Export to Lemlist SKIPPED (dry run) ---\n`);
    console.log(`  Would export to campaign: ${campaignId}\n`);
    return results;
  }

  console.log(`--- Step 3: Export to Lemlist ---\n`);

  try {
    const exportResult = await exportToLemlist(
      businessRecord.business,
      campaignId,
      emailContent.emailSequence || [emailContent.email]
    );

    if (exportResult.multiOwner) {
      // Check if all leads were duplicates
      if (exportResult.allDuplicates) {
        console.log(`  ⚠ Multi-owner export: All leads already exist in campaign`);
        console.log(`    Duplicate leads: ${exportResult.duplicateCount}\n`);

        exportResult.errors.forEach((err, i) => {
          console.log(`    ${i + 1}. ${err.owner} (${err.email}) - Already exists`);
        });
        console.log();

        results.exported = true; // Consider as successful since leads exist
        results.lemlistLeads = []; // No new leads created
        results.allDuplicates = true;
      } else {
        console.log(`  ✓ Multi-owner export successful`);
        console.log(`    Leads created: ${exportResult.successCount}`);
        console.log(`    Failed: ${exportResult.failureCount}`);
        if (exportResult.duplicateCount > 0) {
          console.log(`    Duplicates skipped: ${exportResult.duplicateCount}`);
        }
        console.log();

        exportResult.leads.forEach((lead, i) => {
          console.log(`    ${i + 1}. ${lead.firstName} ${lead.lastName} (${lead.email})`);
          console.log(`       Lead ID: ${lead._id}\n`);
        });

        results.exported = true;
        results.lemlistLeads = exportResult.leads.map(l => ({
          id: l._id,
          email: l.email,
          name: `${l.firstName} ${l.lastName}`
        }));
      }
    } else {
      console.log(`  ✓ Single-owner export successful`);
      console.log(`    Lead ID: ${exportResult._id}`);
      console.log(`    Email: ${exportResult.email}\n`);

      results.exported = true;
      results.lemlistLeads = [{
        id: exportResult._id,
        email: exportResult.email,
        name: `${exportResult.firstName} ${exportResult.lastName}`
      }];
    }

    // Update database status
    updateBusiness(businessRecord.id, {
      status: 'exported',
      exportedTo: ['lemlist'],
      exportedAt: new Date().toISOString()
    });

    console.log(`  ✓ Database status updated to 'exported'\n`);

  } catch (error) {
    console.error(`  ✗ Export failed: ${error.message}\n`);
    results.errors.push({
      step: 'lemlist_export',
      error: error.message
    });
    throw error;
  }

  // Step 4: Configure Campaign Email Sequence
  if (!dryRun && emailContent.emailSequence) {
    console.log(`--- Step 4: Configure Campaign Email Sequence ---\n`);

    try {
      const sequenceResult = await configureCampaignSequence(
        campaignId,
        emailContent.emailSequence
      );

      console.log(`  ✓ Campaign sequence configured`);
      console.log(`    Email steps: ${sequenceResult.emailStepsConfigured}\n`);

      sequenceResult.emailSteps.forEach((step, i) => {
        console.log(`    ${step.position}. "${step.subject}" (${step.delay} days after previous)`);
      });
      console.log();

      results.sequenceConfigured = true;
      results.emailSteps = sequenceResult.emailStepsConfigured;

    } catch (error) {
      console.error(`  ⚠ Campaign sequence configuration failed: ${error.message}`);
      console.error(`  Note: Leads were exported successfully, but sequence needs manual setup in Lemlist UI\n`);

      results.sequenceConfigured = false;
      results.errors.push({
        step: 'campaign_sequence',
        error: error.message,
        severity: 'warning' // Non-fatal - leads are already exported
      });

      // Don't throw - leads are already created, sequence can be set up manually
    }
  } else if (dryRun) {
    console.log(`--- Step 4: Configure Campaign Email Sequence SKIPPED (dry run) ---\n`);
  }

  // Summary
  console.log(`=== EXPORT COMPLETE ===\n`);
  console.log(`Business: ${results.businessName}`);
  console.log(`LinkedIn Enriched: ${results.linkedInEnriched ? 'YES' : 'NO'}`);
  console.log(`Leads Created: ${results.lemlistLeads.length}`);
  console.log(`Email Sequence: ${results.sequenceConfigured ? `YES (${results.emailSteps} steps)` : 'NO'}`);
  console.log(`Errors: ${results.errors.filter(e => !e.severity || e.severity !== 'warning').length}\n`);

  if (results.errors.length > 0) {
    const warnings = results.errors.filter(e => e.severity === 'warning');
    const errors = results.errors.filter(e => !e.severity || e.severity !== 'warning');

    if (errors.length > 0) {
      console.log(`Errors:\n`);
      errors.forEach(err => {
        console.log(`  - ${err.step}: ${err.error}`);
      });
      console.log();
    }

    if (warnings.length > 0) {
      console.log(`Warnings:\n`);
      warnings.forEach(err => {
        console.log(`  - ${err.step}: ${err.error}`);
      });
      console.log();
    }
  }

  console.log(`Next Steps:`);
  console.log(`  1. Check Lemlist campaign: https://app.lemlist.com/campaigns/${campaignId}`);

  if (results.sequenceConfigured) {
    console.log(`  2. ✓ Email sequence is configured - review in Lemlist UI`);
    console.log(`  3. Launch campaign when ready 🚀\n`);
  } else {
    console.log(`  2. ⚠ Configure email sequence manually in Lemlist (4 emails)`);
    console.log(`  3. Launch campaign when ready\n`);
  }

  return results;
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: node export-business.js <business-name-or-id> [options]

Arguments:
  business-name-or-id    Business name (partial match) or database ID

Options:
  --skip-linkedin        Skip LinkedIn enrichment step
  --dry-run             Preview export without actually sending
  --help, -h            Show this help message

Environment Variables:
  LEMLIST_CAMPAIGN_ID   Lemlist campaign ID (required)
  CONTENT_PROVIDER      Email generator (claude|gpt, default: claude)

Examples:
  node export-business.js "KissDental Bramhall"
  node export-business.js kissdental-bramhall-sk71pa-c260c5f9
  node export-business.js "KissDental" --skip-linkedin
  node export-business.js "The Hair Salon" --dry-run
`);
    process.exit(0);
  }

  const businessNameOrId = args[0];
  const options = {
    skipLinkedIn: args.includes('--skip-linkedin'),
    dryRun: args.includes('--dry-run')
  };

  exportBusiness(businessNameOrId, options)
    .then(results => {
      process.exit(results.errors.length > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error(`\n✗ Fatal Error: ${error.message}\n`);
      process.exit(1);
    });
}

module.exports = { exportBusiness };
