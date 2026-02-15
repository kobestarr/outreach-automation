/**
 * EMERGENCY: Verify and Export with Email Verification
 * Use this if Lemlist verification fails or you want to re-export with verified emails only
 */

const { verifyEmail } = require('./shared/outreach-core/email-verification/reoon-verifier');
const { addLeadToCampaign } = require('./shared/outreach-core/export-managers/lemlist-exporter');
const { getAllMergeVariables } = require('./shared/outreach-core/content-generation/email-merge-variables');
const logger = require('./shared/outreach-core/logger');

const CAMPAIGN_ID = 'cam_bJYSQ4pqMzasQWsRb';

// Sample leads from your current export (you can get these from Lemlist export)
// For now, let's create a function that reads from database and verifies

async function verifyAndExport() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║        VERIFY & EXPORT - Email Verification Before Export         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log('⚠️  WARNING: This will verify emails using Reoon credits!');
  console.log('⚠️  You have 500 verifications per day.\n');

  // Get leads from database
  const Database = require('better-sqlite3');
  const dbPath = './ksd/local-outreach/orchestrator/data/businesses.db';
  const db = new Database(dbPath);

  const leads = db.prepare(`
    SELECT * FROM businesses
    WHERE owner_email IS NOT NULL
    AND owner_email != ''
    ORDER BY scraped_at DESC
    LIMIT 69
  `).all();

  console.log(`📋 Found ${leads.length} leads with emails in database\n`);

  if (leads.length === 0) {
    console.log('❌ No leads found in database. Run export script first!\n');
    process.exit(1);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 1: VERIFYING EMAILS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let verified = 0;
  let invalid = 0;
  let risky = 0;
  let errors = 0;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    console.log(`[${i + 1}/${leads.length}] ${lead.name}`);
    console.log(`   Email: ${logger.sanitizeData(lead.owner_email)}`);

    try {
      const verification = await verifyEmail(lead.owner_email, 'quick'); // Use quick mode to save credits

      lead.emailVerified = verification.isValid;
      lead.emailStatus = verification.status;
      lead.emailScore = verification.score;

      if (verification.isValid) {
        console.log(`   ✅ VALID (${verification.status}, score: ${verification.score})`);
        verified++;
      } else if (verification.status === 'risky' || verification.status === 'unknown') {
        console.log(`   ⚠️  RISKY (${verification.status}, score: ${verification.score})`);
        risky++;
        lead.emailVerified = false; // Mark as unverified for safety
      } else {
        console.log(`   ❌ INVALID (${verification.status})`);
        invalid++;
        lead.emailVerified = false;
      }

      // Update database with verification status
      db.prepare(`
        UPDATE businesses
        SET email_verified = ?, email_source = ?, estimated_revenue = ?
        WHERE id = ?
      `).run(lead.emailVerified ? 1 : 0, verification.status, verification.score || 0, lead.id);

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error) {
      console.log(`   ❌ ERROR: ${error.message}`);
      errors++;
      lead.emailVerified = false;
    }

    console.log();
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('VERIFICATION SUMMARY:');
  console.log(`✅ Valid: ${verified} (${Math.round(verified/leads.length*100)}%)`);
  console.log(`⚠️  Risky: ${risky} (${Math.round(risky/leads.length*100)}%)`);
  console.log(`❌ Invalid: ${invalid} (${Math.round(invalid/leads.length*100)}%)`);
  console.log(`⚠️  Errors: ${errors}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Ask user if they want to export only verified emails
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 2: EXPORT TO LEMLIST');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('⚠️  Options:');
  console.log(`   1. Export ONLY verified emails (${verified} leads) - RECOMMENDED`);
  console.log(`   2. Export verified + risky emails (${verified + risky} leads) - Use if Gmail addresses`);
  console.log(`   3. Skip export (just wanted to verify)\n`);

  // For automation, let's export verified only
  const exportOption = 1; // Change this to 2 if you want to include risky

  const leadsToExport = leads.filter(lead => {
    if (exportOption === 1) return lead.emailVerified === true;
    if (exportOption === 2) return lead.emailVerified === true || lead.emailStatus === 'risky';
    return false;
  });

  console.log(`📤 Exporting ${leadsToExport.length} leads to Lemlist...\n`);

  let exported = 0;
  let skipped = 0;
  let exportErrors = 0;

  for (const lead of leadsToExport) {
    try {
      // Generate merge variables
      const business = {
        ...lead,
        name: lead.name,
        email: lead.owner_email,
        postcode: lead.postcode || 'SK7',
        ownerFirstName: lead.owner_first_name,
        ownerLastName: lead.owner_last_name,
        assignedOfferTier: lead.assigned_tier || 'tier3', // Database already stores as "tier3"
        usedFallbackName: !lead.owner_first_name || lead.owner_first_name === 'there'
      };

      const mergeVariables = getAllMergeVariables(business);

      const leadData = {
        email: lead.owner_email,
        firstName: mergeVariables.firstName,
        lastName: mergeVariables.lastName,
        companyName: mergeVariables.companyName,
        businessType: mergeVariables.businessType,
        location: mergeVariables.location,
        localIntro: mergeVariables.localIntro,
        observationSignal: mergeVariables.observationSignal,
        meetingOption: mergeVariables.meetingOption,
        microOfferPrice: mergeVariables.microOfferPrice,
        multiOwnerNote: mergeVariables.multiOwnerNote || '',
        noNameNote: mergeVariables.noNameNote || '',
        phone: lead.phone,
        website: lead.website
      };

      await addLeadToCampaign(CAMPAIGN_ID, leadData);
      console.log(`✅ ${lead.name} → ${logger.sanitizeData(lead.owner_email)}`);
      exported++;

      // Small delay between exports
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.log(`❌ ${lead.name} - Export failed: ${error.message}`);
      exportErrors++;
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('EXPORT SUMMARY:');
  console.log(`✅ Exported: ${exported}`);
  console.log(`❌ Errors: ${exportErrors}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              ✅ VERIFY & EXPORT COMPLETE! ✅                      ║');
  console.log('║                                                                    ║');
  console.log(`║  Total leads verified: ${leads.length}                                       ║`);
  console.log(`║  Valid emails: ${verified}                                                ║`);
  console.log(`║  Exported to Lemlist: ${exported}                                        ║`);
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  db.close();
}

// Run it
verifyAndExport().catch(console.error);
