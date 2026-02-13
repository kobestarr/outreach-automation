/**
 * Delete Empty Leads from Lemlist
 * Removes leads that have no firstName or email
 */

const { getLeadsFromCampaign } = require('./shared/outreach-core/export-managers/lemlist-exporter');
const https = require('https');
const { getCredential } = require('./shared/outreach-core/credentials-loader');

const CAMPAIGN_ID = 'cam_bJYSQ4pqMzasQWsRb';

async function deleteLead(campaignId, email) {
  const apiKey = getCredential("lemlist", "apiKey");
  const authString = Buffer.from(":" + apiKey).toString("base64");

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.lemlist.com',
      path: `/api/campaigns/${campaignId}/leads/${encodeURIComponent(email)}`,
      method: "DELETE",
      headers: {
        "Authorization": `Basic ${authString}`,
        "Accept": "application/json"
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      let totalLength = 0;

      res.on("data", (chunk) => {
        chunks.push(chunk);
        totalLength += chunk.length;
      });

      res.on("end", () => {
        const data = Buffer.concat(chunks, totalLength).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, email });
        } else {
          reject(new Error(`Failed to delete ${email}: ${data}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    req.end();
  });
}

async function cleanupEmptyLeads() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              CLEANUP: Delete Empty Leads from Lemlist              ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  try {
    console.log('📥 Fetching all leads from campaign...\n');
    const leads = await getLeadsFromCampaign(CAMPAIGN_ID);

    console.log(`Found ${leads.length} total leads\n`);

    // Find empty leads (no firstName or no email)
    const emptyLeads = leads.filter(lead =>
      !lead.firstName ||
      !lead.email ||
      lead.firstName === 'undefined' ||
      lead.email.includes('undefined')
    );

    console.log(`🗑️  Found ${emptyLeads.length} empty leads to delete:\n`);

    if (emptyLeads.length === 0) {
      console.log('✅ No empty leads found! Campaign is clean.\n');
      return;
    }

    for (const lead of emptyLeads) {
      console.log(`   - ${lead.email || 'no-email'} (firstName: ${lead.firstName || 'missing'})`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('DELETING EMPTY LEADS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    let deleted = 0;
    let failed = 0;

    for (const lead of emptyLeads) {
      try {
        await deleteLead(CAMPAIGN_ID, lead.email);
        console.log(`✅ Deleted: ${lead.email}`);
        deleted++;

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.log(`❌ Failed to delete ${lead.email}: ${error.message}`);
        failed++;
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('CLEANUP SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`✅ Deleted: ${deleted} leads`);
    console.log(`❌ Failed: ${failed} leads`);
    console.log(`📊 Total: ${emptyLeads.length} leads processed\n`);

    if (deleted > 0) {
      console.log('╔════════════════════════════════════════════════════════════════════╗');
      console.log('║                    ✅ CLEANUP COMPLETE! ✅                         ║');
      console.log('║                                                                    ║');
      console.log('║  Empty leads removed from Lemlist campaign                        ║');
      console.log('║  Ready for fresh export with corrected data                       ║');
      console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    }

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

cleanupEmptyLeads()
  .then(() => {
    console.log('✅ Cleanup completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Cleanup failed:', error.message);
    process.exit(1);
  });
