/**
 * Quick Lemlist Status Checker
 * Check how many leads are verified, unverified, etc.
 */

const https = require('https');
const { getCredential } = require('./shared/outreach-core/credentials-loader');

const CAMPAIGN_ID = 'cam_bJYSQ4pqMzasQWsRb';

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const apiKey = getCredential('lemlist', 'apiKey');
    const auth = Buffer.from(`:${apiKey}`).toString('base64');

    const options = {
      hostname: 'api.lemlist.com',
      path: path,
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function checkLemlistStatus() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              LEMLIST CAMPAIGN STATUS CHECK                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Campaign ID: ${CAMPAIGN_ID}\n`);

  try {
    // Get all leads
    console.log('Fetching leads from Lemlist...\n');
    const leads = await makeRequest(`/api/campaigns/${CAMPAIGN_ID}/leads`);

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`TOTAL LEADS: ${leads.length}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Analyze leads
    let verified = 0;
    let notVerified = 0;
    let contacted = 0;
    let notContacted = 0;
    let replied = 0;
    let bounced = 0;

    const emailDomains = {};
    const companyNames = [];
    const missingData = {
      noPhone: 0,
      noFirstName: 0,
      noLastName: 0
    };

    for (const lead of leads) {
      // Verification status
      if (lead.isEmailVerified || lead.emailVerified) {
        verified++;
      } else {
        notVerified++;
      }

      // Contact status
      if (lead.contacted || lead.isContacted) {
        contacted++;
      } else {
        notContacted++;
      }

      // Engagement
      if (lead.replied) replied++;
      if (lead.bounced) bounced++;

      // Data quality
      if (!lead.phone) missingData.noPhone++;
      if (!lead.firstName) missingData.noFirstName++;
      if (!lead.lastName) missingData.noLastName++;

      // Email domains
      if (lead.email) {
        const domain = lead.email.split('@')[1];
        emailDomains[domain] = (emailDomains[domain] || 0) + 1;
      }

      // Company names
      if (lead.companyName) {
        companyNames.push(lead.companyName);
      }
    }

    console.log('📊 EMAIL VERIFICATION STATUS:');
    console.log(`   ✅ Verified: ${verified} (${Math.round(verified/leads.length*100)}%)`);
    console.log(`   ❌ Not Verified: ${notVerified} (${Math.round(notVerified/leads.length*100)}%)`);
    console.log();

    console.log('📧 CAMPAIGN STATUS:');
    console.log(`   📤 Contacted: ${contacted}`);
    console.log(`   ⏳ Not Contacted: ${notContacted}`);
    console.log(`   💬 Replied: ${replied}`);
    console.log(`   ⚠️  Bounced: ${bounced}`);
    console.log();

    console.log('📋 DATA QUALITY:');
    console.log(`   Missing Phone: ${missingData.noPhone} (${Math.round(missingData.noPhone/leads.length*100)}%)`);
    console.log(`   Missing First Name: ${missingData.noFirstName} (${Math.round(missingData.noFirstName/leads.length*100)}%)`);
    console.log(`   Missing Last Name: ${missingData.noLastName} (${Math.round(missingData.noLastName/leads.length*100)}%)`);
    console.log();

    console.log('🌐 TOP EMAIL DOMAINS:');
    const sortedDomains = Object.entries(emailDomains)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    sortedDomains.forEach(([domain, count]) => {
      const percentage = Math.round(count/leads.length*100);
      console.log(`   ${domain}: ${count} (${percentage}%)`);
    });
    console.log();

    console.log('🏢 SAMPLE COMPANIES:');
    companyNames.slice(0, 10).forEach(name => {
      console.log(`   - ${name}`);
    });
    console.log();

    // Campaign info
    const campaignInfo = await makeRequest(`/api/campaigns/${CAMPAIGN_ID}`);
    console.log('⚙️  CAMPAIGN SETTINGS:');
    console.log(`   Name: ${campaignInfo.name || 'N/A'}`);
    console.log(`   Status: ${campaignInfo.status || campaignInfo.isEnabled ? 'Active' : 'Paused'}`);
    console.log(`   Daily limit: ${campaignInfo.sendLimit || 'Not set'}`);
    console.log();

    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SUMMARY:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (notVerified > 0) {
      console.log(`\n🚨 CRITICAL: ${notVerified} emails are NOT VERIFIED!`);
      console.log('   Action required: Verify emails in Lemlist before launch');
      console.log('   1. Go to campaign → Select all leads → Verify emails');
      console.log('   2. OR run: node verify-and-export.js\n');
    } else {
      console.log('\n✅ All emails are verified! Ready to launch.\n');
    }

    if (missingData.noFirstName > 0) {
      console.log(`⚠️  ${missingData.noFirstName} leads missing first name (will use "Hi there,")`);
    }

    if (bounced > 0) {
      console.log(`\n❌ WARNING: ${bounced} emails have bounced!`);
      console.log('   Remove these before continuing.\n');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkLemlistStatus().catch(console.error);
