/**
 * Test: Email Extractor DNS Fix
 * Verify the email extractor now works after DNS fix
 */

const { extractEmailsFromWebsite } = require('./shared/outreach-core/email-discovery/website-email-extractor');

async function test() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║           TEST: EMAIL EXTRACTOR DNS FIX                           ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const testUrl = 'https://www.arundeldentalpractice.co.uk';

  console.log(`Testing email extraction from: ${testUrl}\n`);
  console.log('⏳ Extracting emails...\n');

  try {
    const emails = await extractEmailsFromWebsite(testUrl);

    if (emails.length > 0) {
      console.log(`✅ SUCCESS! Found ${emails.length} email(s):\n`);
      emails.forEach((email, idx) => {
        console.log(`   ${idx + 1}. ${email}`);
      });
      console.log('\n╔════════════════════════════════════════════════════════════════════╗');
      console.log('║              ✅ DNS FIX SUCCESSFUL ✅                              ║');
      console.log('║                                                                    ║');
      console.log('║  Email extraction is now working!                                 ║');
      console.log('║  Ready to export businesses to Lemlist.                           ║');
      console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    } else {
      console.log('⚠️  No emails found (website may not have contact emails on homepage)\n');
    }

  } catch (error) {
    console.error('❌ FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

test();
