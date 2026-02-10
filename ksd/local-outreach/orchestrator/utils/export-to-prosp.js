#!/usr/bin/env node
/**
 * Export Business to Prosp LinkedIn Campaign
 * Sends LinkedIn connection requests and messages via Prosp automation
 *
 * Usage:
 *   node export-to-prosp.js <business-name-or-id> [--send-now]
 *   node export-to-prosp.js "KissDental Bramhall"
 *   node export-to-prosp.js kissdental-bramhall-sk71pa-c260c5f9 --send-now
 */

const { getBusiness, loadBusinesses, updateBusiness } = require("../modules/database");
const { enrichLinkedIn } = require("../../../../shared/outreach-core/linkedin-enrichment");
const { sendLinkedInOutreach } = require("../../../../shared/outreach-core/prosp-integration/linkedin-outreach");
const { generateLinkedInMessage } = require("../../../../shared/outreach-core/content-generation/linkedin-message-generator");
const { getCredential } = require("../../../../shared/outreach-core/credentials-loader");
const logger = require("../../../../shared/outreach-core/logger");

/**
 * Export business to Prosp LinkedIn campaign
 * @param {string} businessNameOrId - Business name or database ID
 * @param {Object} options - Export options
 * @returns {Promise<Object>} Export results
 */
async function exportToProsp(businessNameOrId, options = {}) {
  const {
    skipLinkedIn = false,
    sendImmediately = false,
    campaignId = process.env.PROSP_CAMPAIGN_ID || getCredential("prosp", "campaignId"),
    listId = process.env.PROSP_LIST_ID || getCredential("prosp", "listId"),
    senderUrl = process.env.PROSP_SENDER_URL || getCredential("prosp", "senderUrl"),
    dryRun = false,
  } = options;

  console.log(`\n=== EXPORT BUSINESS TO PROSP LINKEDIN CAMPAIGN ===\n`);
  console.log(`Business: ${businessNameOrId}`);
  console.log(`Campaign: ${campaignId || "NOT SET"}`);
  console.log(`List: ${listId || "NOT SET"}`);
  console.log(`LinkedIn Enrichment: ${skipLinkedIn ? "SKIPPED" : "ENABLED"}`);
  console.log(`Send Immediately: ${sendImmediately ? "YES" : "NO (campaign auto-send)"}`);
  console.log(`Dry Run: ${dryRun ? "YES" : "NO"}\n`);

  // Validate environment
  if (!campaignId && !dryRun) {
    throw new Error("PROSP_CAMPAIGN_ID environment variable not set");
  }

  if (!listId && !dryRun) {
    throw new Error("PROSP_LIST_ID environment variable not set");
  }

  // Find business
  let businessRecord = getBusiness(businessNameOrId);

  if (!businessRecord) {
    const allBusinesses = loadBusinesses({ limit: 1000 });
    businessRecord = allBusinesses.find((b) =>
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
    addedToProsp: false,
    messagesSent: 0,
    owners: [],
    errors: [],
  };

  // Step 1: LinkedIn Enrichment (if needed)
  if (!skipLinkedIn) {
    console.log(`--- Step 1: LinkedIn Enrichment ---\n`);

    const business = businessRecord.business;
    const owners = business.owners || [
      {
        firstName: business.ownerFirstName,
        lastName: business.ownerLastName,
        linkedInUrl: business.linkedInUrl,
      },
    ];

    let linkedInUpdates = [];

    for (let i = 0; i < owners.length; i++) {
      const owner = owners[i];

      if (owner.linkedInUrl) {
        console.log(`  ${owner.firstName} ${owner.lastName}: Already has LinkedIn URL (${owner.linkedInUrl})`);
        continue;
      }

      console.log(`  Enriching ${owner.firstName} ${owner.lastName}...`);

      try {
        const enrichmentResult = await enrichLinkedIn({
          ...business,
          ownerFirstName: owner.firstName,
          ownerLastName: owner.lastName,
        });

        if (enrichmentResult.enriched) {
          console.log(`    ✓ LinkedIn profile found: ${enrichmentResult.linkedInUrl}`);
          linkedInUpdates.push({
            ownerIndex: i,
            linkedInUrl: enrichmentResult.linkedInUrl,
            linkedInData: enrichmentResult.linkedInData,
          });
          results.linkedInEnriched = true;
        } else {
          console.log(`    ✗ LinkedIn profile not found (${enrichmentResult.reason})`);
        }
      } catch (error) {
        console.error(`    ✗ Enrichment failed: ${error.message}`);
        results.errors.push({
          step: "linkedin_enrichment",
          owner: `${owner.firstName} ${owner.lastName}`,
          error: error.message,
        });
      }

      if (i < owners.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Update database with LinkedIn data
    if (linkedInUpdates.length > 0 && !dryRun) {
      const updatedBusiness = { ...businessRecord.business };

      if (updatedBusiness.owners) {
        linkedInUpdates.forEach((update) => {
          updatedBusiness.owners[update.ownerIndex].linkedInUrl = update.linkedInUrl;
          updatedBusiness.owners[update.ownerIndex].linkedInData = update.linkedInData;
        });
      } else {
        if (linkedInUpdates[0]) {
          updatedBusiness.linkedInUrl = linkedInUpdates[0].linkedInUrl;
          updatedBusiness.linkedInData = linkedInUpdates[0].linkedInData;
        }
      }

      updateBusiness(businessRecord.id, { business: updatedBusiness });
      console.log(`\n  ✓ Database updated with LinkedIn data\n`);

      businessRecord = getBusiness(businessRecord.id);
    }
  } else {
    console.log(`--- Step 1: LinkedIn Enrichment SKIPPED ---\n`);
  }

  // Step 2: Generate LinkedIn message (if sending immediately)
  let messageContent = null;

  if (sendImmediately) {
    console.log(`--- Step 2: Generate LinkedIn Message ---\n`);

    try {
      // Generate simple LinkedIn message referencing email
      messageContent = generateLinkedInMessage(businessRecord.business);

      console.log(`  ✓ Message generated\n`);
      console.log(`  Message:\n${messageContent}\n`);
    } catch (error) {
      console.error(`  ✗ Message generation failed: ${error.message}\n`);
      results.errors.push({
        step: "message_generation",
        error: error.message,
      });
      throw error;
    }
  } else {
    console.log(`--- Step 2: Message Generation SKIPPED (campaign will auto-send) ---\n`);
  }

  // Step 3: Export to Prosp
  if (dryRun) {
    console.log(`--- Step 3: Export to Prosp SKIPPED (dry run) ---\n`);
    console.log(`  Would add to campaign: ${campaignId}`);
    console.log(`  Would add to list: ${listId}\n`);
    return results;
  }

  console.log(`--- Step 3: Export to Prosp ---\n`);

  try {
    const outreachResult = await sendLinkedInOutreach(businessRecord.business, {
      campaignId: campaignId,
      listId: listId,
      sender: senderUrl,
      message: messageContent,
      sendImmediately: sendImmediately,
    });

    results.addedToProsp = outreachResult.addedToCampaign > 0;
    results.messagesSent = outreachResult.messagesSent;
    results.owners = outreachResult.owners;

    if (outreachResult.owners.length > 0) {
      console.log(`  ✓ Prosp outreach successful\n`);
      console.log(`    Owners added to campaign: ${outreachResult.addedToCampaign}`);
      if (sendImmediately) {
        console.log(`    Messages sent: ${outreachResult.messagesSent}`);
      }
      console.log();

      outreachResult.owners.forEach((owner, i) => {
        console.log(`    ${i + 1}. ${owner.name}`);
        console.log(`       LinkedIn: ${owner.linkedInUrl}`);
        console.log(`       Added to campaign: ${owner.addedToCampaign ? "✓" : "✗"}`);
        if (sendImmediately) {
          console.log(`       Message sent: ${owner.messageSent ? "✓" : "✗"}`);
        }
        if (owner.note) {
          console.log(`       Note: ${owner.note}`);
        }
        if (owner.error) {
          console.log(`       Error: ${owner.error}`);
        }
        console.log();
      });
    }

    // Update database status
    const exportedTo = businessRecord.exportedTo || [];
    if (!exportedTo.includes("prosp")) {
      exportedTo.push("prosp");
    }

    updateBusiness(businessRecord.id, {
      status: "exported",
      exportedTo: exportedTo,
      exportedAt: new Date().toISOString(),
    });

    console.log(`  ✓ Database status updated to 'exported'\n`);
  } catch (error) {
    console.error(`  ✗ Prosp export failed: ${error.message}\n`);
    results.errors.push({
      step: "prosp_export",
      error: error.message,
    });
    throw error;
  }

  // Summary
  console.log(`=== EXPORT COMPLETE ===\n`);
  console.log(`Business: ${results.businessName}`);
  console.log(`LinkedIn Enriched: ${results.linkedInEnriched ? "YES" : "NO"}`);
  console.log(`Added to Prosp Campaign: ${results.addedToProsp ? "YES" : "NO"}`);
  if (sendImmediately) {
    console.log(`Messages Sent: ${results.messagesSent}`);
  }
  console.log(`Errors: ${results.errors.length}\n`);

  if (results.errors.length > 0) {
    console.log(`Errors:\n`);
    results.errors.forEach((err) => {
      console.log(`  - ${err.step}: ${err.error}`);
    });
    console.log();
  }

  console.log(`Next Steps:`);
  console.log(`  1. Check Prosp campaign: https://prosp.ai/campaigns`);
  if (!sendImmediately) {
    console.log(`  2. Prosp will auto-send connection requests and messages based on campaign flow`);
  } else {
    console.log(`  2. Messages have been sent - monitor for replies in Prosp dashboard`);
  }
  console.log(`  3. Use webhooks to track replies and engagement\n`);

  return results;
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: node export-to-prosp.js <business-name-or-id> [options]

Arguments:
  business-name-or-id    Business name (partial match) or database ID

Options:
  --skip-linkedin        Skip LinkedIn enrichment step
  --send-now             Send message immediately (default: campaign auto-send)
  --dry-run              Preview export without actually sending
  --help, -h             Show this help message

Environment Variables:
  PROSP_CAMPAIGN_ID      Prosp campaign ID (required)
  PROSP_LIST_ID          Prosp contact list ID (required)
  PROSP_SENDER_URL       Sender's LinkedIn URL (required for --send-now)
  CONTENT_PROVIDER       Message generator (claude|gpt, default: claude)

Examples:
  node export-to-prosp.js "KissDental Bramhall"
  node export-to-prosp.js kissdental-bramhall-sk71pa-c260c5f9
  node export-to-prosp.js "KissDental" --skip-linkedin
  node export-to-prosp.js "The Hair Salon" --send-now
  node export-to-prosp.js "Dentist Practice" --dry-run
`);
    process.exit(0);
  }

  const businessNameOrId = args[0];
  const options = {
    skipLinkedIn: args.includes("--skip-linkedin"),
    sendImmediately: args.includes("--send-now"),
    dryRun: args.includes("--dry-run"),
  };

  exportToProsp(businessNameOrId, options)
    .then((results) => {
      process.exit(results.errors.length > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error(`\n✗ Fatal Error: ${error.message}\n`);
      process.exit(1);
    });
}

module.exports = { exportToProsp };
