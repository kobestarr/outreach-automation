/**
 * Demo: Show Actual Emails Extracted from Website
 * This will show you the raw emails that get pulled from websites
 */

const { scrapeWebsite } = require('./shared/outreach-core/enrichment/website-scraper');

async function demo() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║           DEMO: EMAIL EXTRACTION FROM WEBSITE                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const testWebsite = 'https://www.arundeldentalpractice.co.uk';

  console.log(`🔍 Scraping: ${testWebsite}\n`);
  console.log('Looking for:');
  console.log('  - Email addresses on the website');
  console.log('  - Owner/staff names');
  console.log('  - Matching emails to people\n');

  try {
    const websiteData = await scrapeWebsite(testWebsite);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 RAW EMAILS FOUND ON WEBSITE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (websiteData.emails && websiteData.emails.length > 0) {
      console.log(`✅ Found ${websiteData.emails.length} email addresses:\n`);
      websiteData.emails.forEach((email, idx) => {
        console.log(`   ${idx + 1}. ${email}`);
      });
    } else {
      console.log('❌ No emails found\n');
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('👥 PEOPLE FOUND ON WEBSITE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (websiteData.ownerNames && websiteData.ownerNames.length > 0) {
      console.log(`✅ Found ${websiteData.ownerNames.length} people:\n`);
      websiteData.ownerNames.forEach((person, idx) => {
        const emailIndicator = person.matchedEmail ? ' 📧' : '';
        const emailDisplay = person.matchedEmail ? ` → ${person.matchedEmail}` : '';
        console.log(`   ${idx + 1}. ${person.name}${emailIndicator}${person.title ? ` (${person.title})` : ''}${emailDisplay}`);
      });
    } else {
      console.log('❌ No people found\n');
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ MATCHED EMAILS (People with Email Addresses)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const peopleWithEmails = websiteData.ownerNames?.filter(p => p.matchedEmail) || [];

    if (peopleWithEmails.length > 0) {
      console.log(`✅ Found ${peopleWithEmails.length} people with verified email addresses:\n`);
      peopleWithEmails.forEach((person, idx) => {
        console.log(`   ${idx + 1}. ${person.name}`);
        console.log(`      Email: ${person.matchedEmail}`);
        console.log(`      Title: ${person.title || 'N/A'}`);
        console.log(`      Confidence: ${person.hasEmailMatch ? 'HIGH' : 'MEDIUM'}\n`);
      });
    } else {
      console.log('⚠️  No email-to-person matches found\n');
      console.log('This means we have emails OR names, but couldn\'t confidently match them together.\n');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`Total emails found: ${websiteData.emails?.length || 0}`);
    console.log(`Total people found: ${websiteData.ownerNames?.length || 0}`);
    console.log(`Successfully matched: ${peopleWithEmails.length}`);
    console.log(`Match rate: ${websiteData.ownerNames?.length > 0 ? Math.round((peopleWithEmails.length / websiteData.ownerNames.length) * 100) : 0}%\n`);

    if (peopleWithEmails.length > 0) {
      console.log('╔════════════════════════════════════════════════════════════════════╗');
      console.log('║                   ✅ SUCCESS! ✅                                   ║');
      console.log('║                                                                    ║');
      console.log('║  We found email addresses matched to specific people!             ║');
      console.log('║  These are the highest-quality leads for outreach.                ║');
      console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    } else {
      console.log('╔════════════════════════════════════════════════════════════════════╗');
      console.log('║                   ⚠️  PARTIAL DATA ⚠️                             ║');
      console.log('║                                                                    ║');
      console.log('║  We found emails OR names, but couldn\'t match them together.      ║');
      console.log('║  We would need to use fallback strategies for this business.      ║');
      console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    }

  } catch (error) {
    console.error('\n❌ Demo failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

demo();
