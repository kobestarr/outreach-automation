/**
 * Test Email Extraction System
 * Tests website and social media email extraction with 5 Bramhall businesses
 */

const scraper = require('./ksd/local-outreach/orchestrator/modules/google-maps-scraper-outscraper');
const { extractEmailsFromWebsite } = require('./shared/outreach-core/email-discovery/website-email-extractor');
const { extractEmailsFromSocialMedia } = require('./shared/outreach-core/email-discovery/social-media-email-extractor');
const { generateEmailPatterns, verifyEmailExists } = require('./shared/outreach-core/email-discovery/email-pattern-matcher');

async function testExtraction() {
  console.log('\n=== EMAIL EXTRACTION TEST ===\n');

  // Get 5 Bramhall businesses
  const businesses = await scraper.scrapeGoogleMapsOutscraper('Bramhall', 'SK7', ['dentists']);
  const testSet = businesses.slice(0, 5);

  console.log(`Testing ${testSet.length} businesses:\n`);

  const results = {
    total: testSet.length,
    withWebsiteEmail: 0,
    withSocialEmail: 0,
    withPatternEmail: 0,
    withNoEmail: 0
  };

  for (const business of testSet) {
    console.log(`\n${'─'.repeat(68)}`);
    console.log(`${business.name}`);
    console.log(`${'─'.repeat(68)}`);
    console.log(`Website: ${business.website || 'NONE'}`);
    console.log(`Instagram: ${business.instagramUrl || 'NONE'}`);
    console.log(`Facebook: ${business.facebookUrl || 'NONE'}`);

    let emails = [];
    let source = 'none';

    // Try website
    if (business.website) {
      console.log(`\nTrying website extraction...`);
      const websiteEmails = await extractEmailsFromWebsite(business.website);
      if (websiteEmails.length > 0) {
        emails.push(...websiteEmails.map(e => ({ email: e, source: 'website' })));
        source = 'website';
        results.withWebsiteEmail++;
      }
    }

    // Try social media
    if (emails.length === 0 && (business.instagramUrl || business.facebookUrl)) {
      console.log(`\nTrying social media extraction...`);
      const socialEmails = await extractEmailsFromSocialMedia(business);
      if (socialEmails.length > 0) {
        emails.push(...socialEmails.map(e => ({ email: e, source: 'social' })));
        source = 'social';
        results.withSocialEmail++;
      }
    }

    // Try pattern matching
    if (emails.length === 0 && business.website) {
      console.log(`\nTrying pattern matching...`);
      try {
        const domain = new URL(business.website).hostname;
        const patterns = generateEmailPatterns(domain);

        for (const pattern of patterns) {
          const exists = await verifyEmailExists(pattern);
          if (exists) {
            emails.push({ email: pattern, source: 'pattern' });
            source = 'pattern';
            results.withPatternEmail++;
            break;
          }
        }
      } catch (err) {
        console.log(`Pattern matching error: ${err.message}`);
      }
    }

    if (emails.length === 0) {
      results.withNoEmail++;
    }

    console.log(`\n✉️  Emails found: ${emails.length}`);
    if (emails.length > 0) {
      emails.forEach(e => console.log(`   - ${e.email} (${e.source})`));
    } else {
      console.log(`   - NONE`);
    }

    // Delay between businesses
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Summary
  console.log(`\n${'='.repeat(68)}`);
  console.log(`TEST RESULTS SUMMARY`);
  console.log(`${'='.repeat(68)}\n`);
  console.log(`Total businesses tested: ${results.total}`);
  console.log(`With website emails:     ${results.withWebsiteEmail} (${Math.round(results.withWebsiteEmail/results.total*100)}%)`);
  console.log(`With social emails:      ${results.withSocialEmail} (${Math.round(results.withSocialEmail/results.total*100)}%)`);
  console.log(`With pattern emails:     ${results.withPatternEmail} (${Math.round(results.withPatternEmail/results.total*100)}%)`);
  console.log(`With NO emails:          ${results.withNoEmail} (${Math.round(results.withNoEmail/results.total*100)}%)`);

  const successRate = Math.round((results.total - results.withNoEmail) / results.total * 100);
  console.log(`\nEmail extraction success rate: ${successRate}%`);
  console.log(`Target: 70%+ (currently ${successRate >= 70 ? '✅ MET' : '❌ NOT MET'})\n`);

  console.log(`${'='.repeat(68)}\n`);
}

testExtraction().catch(console.error);
