#!/usr/bin/env node
/**
 * Reply Detection CLI
 * Manually check for replies and auto-stop related sequences
 *
 * Usage:
 *   node check-replies.js                    # Check all campaigns
 *   node check-replies.js cam_abc123         # Check specific campaign
 *   node check-replies.js --watch            # Run continuously (every 5 min)
 */

const { checkCampaignForReplies, checkAllCampaigns } = require("./reply-detector");
const logger = require("../logger");

const args = process.argv.slice(2);
const campaignId = args.find(arg => arg.startsWith("cam_"));
const watchMode = args.includes("--watch");
const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Run reply detection
 */
async function run() {
  console.log("\n🔍 Reply Detection System\n");

  try {
    if (campaignId) {
      console.log(`Checking campaign: ${campaignId}\n`);
      const result = await checkCampaignForReplies(campaignId);
      displayResults([result]);
    } else {
      console.log("Checking all campaigns...\n");
      const results = await checkAllCampaigns();
      displayResults(results);
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    logger.error('check-replies-cli', 'Reply detection failed', { error: error.message });
    process.exit(1);
  }
}

/**
 * Display results in a user-friendly format
 */
function displayResults(results) {
  let totalReplies = 0;
  let totalStopped = 0;

  for (const result of results) {
    totalReplies += result.newReplies;
    totalStopped += result.stoppedSequences;

    if (result.newReplies > 0) {
      console.log(`\n📧 Campaign: ${result.campaignId}`);
      console.log(`   New replies: ${result.newReplies}`);
      console.log(`   Sequences stopped: ${result.stoppedSequences}`);

      if (result.details && result.details.length > 0) {
        for (const detail of result.details) {
          console.log(`\n   ✅ ${detail.repliedLead.name} (${detail.repliedLead.email}) replied`);
          console.log(`      Company: ${detail.repliedLead.companyName}`);
          if (detail.stoppedLeads.length > 0) {
            console.log(`      Stopped sequences for:`);
            detail.stoppedLeads.forEach(lead => {
              console.log(`         - ${lead.firstName} ${lead.lastName} (${lead.email})`);
            });
          }
          if (detail.errors && detail.errors.length > 0) {
            console.log(`      ⚠️  Errors:`);
            detail.errors.forEach(err => {
              console.log(`         - ${err.email}: ${err.error}`);
            });
          }
        }
      }
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Total new replies: ${totalReplies}`);
  console.log(`   Total sequences stopped: ${totalStopped}`);
  console.log(`   Campaigns checked: ${results.length}`);
  console.log();
}

/**
 * Watch mode - run continuously
 */
async function watch() {
  console.log(`\n👀 Watch mode enabled - checking every ${CHECK_INTERVAL / 1000 / 60} minutes`);
  console.log("   Press Ctrl+C to stop\n");

  while (true) {
    const timestamp = new Date().toLocaleString();
    console.log(`\n[${timestamp}] Running reply detection...`);

    try {
      await run();
    } catch (error) {
      console.error(`[${timestamp}] Error:`, error.message);
    }

    console.log(`\nNext check in ${CHECK_INTERVAL / 1000 / 60} minutes...`);
    await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
  }
}

// Run
if (watchMode) {
  watch().catch(error => {
    console.error("Fatal error in watch mode:", error);
    process.exit(1);
  });
} else {
  run().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
