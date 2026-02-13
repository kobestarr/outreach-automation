/**
 * Quick Export from Database to Lemlist
 * Reads enriched businesses from SQLite DB and exports
 */

const { loadBusinesses } = require('./ksd/local-outreach/orchestrator/modules/database');
const { getAllMergeVariables } = require('./shared/outreach-core/content-generation/email-merge-variables');
const { addLeadToCampaign } = require('./shared/outreach-core/export-managers/lemlist-exporter');

const CAMPAIGN_ID = 'cam_bJYSQ4pqMzasQWsRb';

async function exportFromDatabase() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          QUICK EXPORT FROM DATABASE TO LEMLIST                     ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Load all businesses with emails from database
  const businesses = loadBusinesses({ hasEmail: true });
  
  console.log(`📊 Found ${businesses.length} businesses with emails in database\n`);

  let exported = 0;
  let skipped = 0;
  let errors = 0;

  for (const record of businesses) {
    const business = record.business;
    
    if (!business.ownerEmail) {
      console.log(`⏭️  Skipping ${business.name} (no email)`);
      skipped++;
      continue;
    }

    // Generate merge variables
    const mergeVariables = getAllMergeVariables(business);

    // Prepare lead data for Lemlist
    const leadData = {
      email: business.ownerEmail,
      firstName: mergeVariables.firstName,
      lastName: mergeVariables.lastName,
      companyName: mergeVariables.companyName,
      businessType: mergeVariables.businessType,
      location: mergeVariables.location,
      localIntro: mergeVariables.localIntro,
      observationSignal: mergeVariables.observationSignal,
      meetingOption: mergeVariables.meetingOption,
      microOfferPrice: mergeVariables.microOfferPrice,
      multiOwnerNote: mergeVariables.multiOwnerNote,
      noNameNote: mergeVariables.noNameNote
    };

    try {
      await addLeadToCampaign(CAMPAIGN_ID, leadData);
      console.log(`✅ Exported: ${business.name} (${mergeVariables.microOfferPrice})`);
      exported++;
    } catch (error) {
      if (error.message.includes('already in the campaign')) {
        console.log(`⏭️  Skipped: ${business.name} (already in campaign)`);
        skipped++;
      } else {
        console.log(`❌ Error: ${business.name} - ${error.message}`);
        errors++;
      }
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('EXPORT SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`✅ Exported: ${exported}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`❌ Errors: ${errors}`);
  console.log(`📊 Total: ${businesses.length}\n`);
}

exportFromDatabase().catch(console.error);
