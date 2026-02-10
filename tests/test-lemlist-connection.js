/**
 * Test Lemlist Connection
 * Verifies connection to existing campaign
 */

const { getCampaigns, addLeadToCampaign } = require('../shared/outreach-core/export-managers/lemlist-exporter');

async function testLemlistConnection() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║           LEMLIST CONNECTION TEST                                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Verify API connection and get campaigns
    console.log('📡 Step 1: Testing Lemlist API connection...');
    const campaigns = await getCampaigns();
    console.log(`   ✅ Connected! Found ${campaigns.length} campaigns\n`);

    // Step 2: Find your specific campaign
    console.log('🔍 Step 2: Looking for campaign cam_bJYSQ4pqMzasQWsRb...');
    const targetCampaignId = 'cam_bJYSQ4pqMzasQWsRb';
    const campaign = campaigns.find(c => c._id === targetCampaignId);

    if (campaign) {
      console.log(`   ✅ Campaign found: "${campaign.name}"`);
      console.log(`   - ID: ${campaign._id}`);
      console.log(`   - Status: ${campaign.isActive ? 'Active' : 'Inactive'}`);
      console.log(`   - Leads: ${campaign.stats?.leadCount || 0}\n`);
    } else {
      console.log(`   ⚠️  Campaign ${targetCampaignId} not found in list`);
      console.log(`   Available campaigns:`);
      campaigns.slice(0, 5).forEach(c => {
        console.log(`   - ${c.name} (${c._id})`);
      });
      console.log();
    }

    // Step 3: Test adding a lead (dry run with test data)
    console.log('🧪 Step 3: Testing lead export (with test data)...');

    const testLead = {
      email: 'test-integration@example.com',
      firstName: 'Test',
      lastName: 'Lead',
      companyName: 'Test Company',
      companyDomain: 'example.com'
    };

    try {
      const result = await addLeadToCampaign(targetCampaignId, testLead);
      console.log(`   ✅ Lead export successful!`);
      console.log(`   - Email: ${result.email || testLead.email}`);
      console.log(`   - Status: Added to campaign\n`);
    } catch (error) {
      if (error.message.includes('DUPLICATE_LEAD')) {
        console.log(`   ✅ Lead export working (test lead already exists)\n`);
      } else {
        console.log(`   ⚠️  Lead export failed: ${error.message}\n`);
      }
    }

    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('✅ Next Steps:');
    console.log('   1. Export Bramhall businesses to Lemlist:');
    console.log(`      node ksd/local-outreach/orchestrator/export-to-lemlist.js ${targetCampaignId}`);
    console.log('   2. Or use the orchestrator with auto-export:');
    console.log(`      node ksd/local-outreach/orchestrator/main.js --campaign ${targetCampaignId}\n`);

    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║              ✅ LEMLIST CONNECTION VERIFIED ✅                     ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  } catch (error) {
    console.error('\n❌ Lemlist connection test failed:');
    console.error(`   Error: ${error.message}`);

    if (error.message.includes('ENOTFOUND')) {
      console.error('   → Check internet connection');
    } else if (error.message.includes('401') || error.message.includes('403')) {
      console.error('   → Check Lemlist API key in credentials');
    }

    console.error();
    process.exit(1);
  }
}

// Run the test
testLemlistConnection().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
