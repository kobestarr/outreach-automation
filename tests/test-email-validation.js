/**
 * Test Email Validation for Name Extraction
 * Shows which emails were found and if any match owner names
 */

const { scrapeWebsite } = require('../shared/outreach-core/enrichment/website-scraper');

async function testEmailValidation() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         TEST: Email Validation for Name Extraction                ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const testUrl = 'https://www.arundeldentalpractice.co.uk';

  console.log(`🔍 Scraping: ${testUrl}\n`);

  try {
    // Use internal fetch to get emails
    const https = require('https');

    const html = await new Promise((resolve, reject) => {
      https.get(testUrl, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
        res.on('error', reject);
      });
    });

    // Extract emails manually
    const emailPattern = /\b[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const emails = html.match(emailPattern) || [];
    const uniqueEmails = [...new Set(emails)];

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('EMAILS FOUND ON WEBSITE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`📧 Found ${uniqueEmails.length} unique emails:\n`);
    uniqueEmails.forEach((email, idx) => {
      console.log(`   ${idx + 1}. ${email}`);
    });

    // Now scrape and see what names were found
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('NAME EXTRACTION RESULTS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result = await scrapeWebsite(testUrl);

    console.log(`👥 Found ${result.ownerNames.length} owner names:\n`);
    result.ownerNames.forEach((owner, idx) => {
      const matchIcon = owner.hasEmailMatch ? '✅' : '❌';
      console.log(`   ${idx + 1}. ${matchIcon} ${owner.name}${owner.title ? ` (${owner.title})` : ''}`);
    });

    // Test pattern matching manually
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('MANUAL PATTERN TESTING');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test if Christopher Needham should match any emails
    const testName = 'Christopher Needham';
    const nameParts = testName.toLowerCase().split(' ');
    const firstName = nameParts[0]; // christopher
    const lastName = nameParts[1];  // needham

    console.log(`Testing patterns for: ${testName}\n`);
    console.log(`   Patterns to match:`);
    console.log(`   - ${firstName}.${lastName}@ (christopher.needham@)`);
    console.log(`   - ${firstName}${lastName}@ (christopherneedham@)`);
    console.log(`   - ${firstName}@ (christopher@)`);
    console.log(`   - ${firstName[0]}${lastName}@ (cneedham@)`);
    console.log(`   - ${firstName[0]}.${lastName}@ (c.needham@)\n`);

    console.log(`   Checking against found emails:\n`);
    uniqueEmails.forEach(email => {
      const emailLower = email.toLowerCase();
      const patterns = [
        { pattern: `${firstName}.${lastName}@`, matches: emailLower.includes(`${firstName}.${lastName}@`) },
        { pattern: `${firstName}${lastName}@`, matches: emailLower.includes(`${firstName}${lastName}@`) },
        { pattern: `${firstName}@`, matches: emailLower.includes(`${firstName}@`) },
        { pattern: `${firstName[0]}${lastName}@`, matches: emailLower.includes(`${firstName[0]}${lastName}@`) },
        { pattern: `${firstName[0]}.${lastName}@`, matches: emailLower.includes(`${firstName[0]}.${lastName}@`) }
      ];

      const anyMatch = patterns.some(p => p.matches);
      if (anyMatch) {
        console.log(`   ✅ ${email} - MATCHES!`);
        patterns.forEach(p => {
          if (p.matches) console.log(`      Pattern: ${p.pattern}`);
        });
      } else {
        console.log(`   ❌ ${email} - no match`);
      }
    });

    console.log('\n╔════════════════════════════════════════════════════════════════════╗');
    console.log('║                   ✅ TEST COMPLETE ✅                              ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

testEmailValidation();
