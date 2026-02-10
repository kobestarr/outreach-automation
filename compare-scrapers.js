/**
 * Compare HasData vs Outscraper
 * Runs same search on both scrapers and compares data quality
 */

const hasdataScraper = require('./ksd/local-outreach/orchestrator/modules/google-maps-scraper');
const outscraperScraper = require('./ksd/local-outreach/orchestrator/modules/google-maps-scraper-outscraper');

async function compareScraper() {
  console.log('\n' + '='.repeat(80));
  console.log('SCRAPER COMPARISON: HasData vs Outscraper');
  console.log('='.repeat(80) + '\n');

  // Test params
  const location = 'Bramhall';
  const postcode = 'SK7';
  const businessTypes = ['dentists']; // Small test set
  const limit = 5; // Test with just 5 businesses

  console.log('Test Parameters:');
  console.log(`  Location: ${location} (${postcode})`);
  console.log(`  Business Types: ${businessTypes.join(', ')}`);
  console.log(`  Limit: ${limit} businesses`);
  console.log('\n' + '-'.repeat(80) + '\n');

  // Test 1: HasData
  console.log('🔵 TEST 1: HasData Scraper\n');
  let hasdataResults = [];
  let hasdataError = null;
  let hasdataTime = 0;

  try {
    const startTime = Date.now();
    hasdataResults = await hasdataScraper.scrapeGoogleMaps(location, postcode, businessTypes, true);
    hasdataTime = Date.now() - startTime;

    // Limit to 5 for comparison
    hasdataResults = hasdataResults.slice(0, limit);

    console.log(`✅ Success! Found ${hasdataResults.length} businesses in ${hasdataTime}ms\n`);
  } catch (error) {
    hasdataError = error.message;
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 2: Outscraper
  console.log('🟠 TEST 2: Outscraper\n');
  let outscraperResults = [];
  let outscraperError = null;
  let outscraperTime = 0;

  try {
    const startTime = Date.now();
    outscraperResults = await outscraperScraper.scrapeGoogleMapsOutscraper(location, postcode, businessTypes);
    outscraperTime = Date.now() - startTime;

    // Limit to 5 for comparison
    outscraperResults = outscraperResults.slice(0, limit);

    console.log(`✅ Success! Found ${outscraperResults.length} businesses in ${outscraperTime}ms\n`);
  } catch (error) {
    outscraperError = error.message;
    console.log(`❌ Error: ${error.message}\n`);
  }

  console.log('-'.repeat(80) + '\n');

  // Compare results
  console.log('📊 COMPARISON RESULTS\n');

  // Basic stats
  console.log('1. Performance:');
  console.log(`   HasData:    ${hasdataError ? 'FAILED' : `${hasdataTime}ms`}`);
  console.log(`   Outscraper: ${outscraperError ? 'FAILED' : `${outscraperTime}ms`}`);
  console.log('');

  if (hasdataError || outscraperError) {
    console.log('⚠️  Cannot compare - one or both scrapers failed\n');
    return;
  }

  // Data completeness
  console.log('2. Data Completeness:\n');

  const hasdataStats = analyzeResults(hasdataResults, 'HasData');
  const outscraperStats = analyzeResults(outscraperResults, 'Outscraper');

  printStats(hasdataStats, outscraperStats);

  // Show detailed business data
  console.log('\n3. Sample Business Data:\n');

  console.log('🔵 HasData Sample (First 3):\n');
  hasdataResults.slice(0, 3).forEach((b, i) => {
    console.log(`   ${i + 1}. ${b.name}`);
    console.log(`      Phone: ${b.phone || 'NONE'}`);
    console.log(`      Website: ${b.website || 'NONE'}`);
    console.log(`      Email: ${b.email || 'NONE'} ${b.emailsFromWebsite ? `(+ ${b.emailsFromWebsite.length} from website)` : ''}`);
    console.log(`      Rating: ${b.rating || 'N/A'} (${b.reviewCount || 0} reviews)`);
    console.log('');
  });

  console.log('🟠 Outscraper Sample (First 3):\n');
  outscraperResults.slice(0, 3).forEach((b, i) => {
    console.log(`   ${i + 1}. ${b.name}`);
    console.log(`      Phone: ${b.phone || 'NONE'}`);
    console.log(`      Website: ${b.website || 'NONE'}`);
    console.log(`      Email: ${b.email || 'NONE'}`);
    console.log(`      Rating: ${b.rating || 'N/A'} (${b.reviewCount || 0} reviews)`);
    console.log('');
  });

  // Recommendation
  console.log('-'.repeat(80) + '\n');
  console.log('💡 RECOMMENDATION:\n');

  if (hasdataStats.emailRate > outscraperStats.emailRate) {
    console.log(`✅ Use HasData - ${hasdataStats.emailRate}% email extraction vs ${outscraperStats.emailRate}% for Outscraper`);
  } else if (outscraperStats.emailRate > hasdataStats.emailRate) {
    console.log(`✅ Use Outscraper - ${outscraperStats.emailRate}% email extraction vs ${hasdataStats.emailRate}% for HasData`);
  } else {
    console.log(`🤔 Both scrapers have ${hasdataStats.emailRate}% email extraction - consider other factors (speed, cost, data quality)`);
  }

  console.log('\n' + '='.repeat(80) + '\n');
}

function analyzeResults(results, scraperName) {
  const total = results.length;
  const withPhone = results.filter(b => b.phone).length;
  const withWebsite = results.filter(b => b.website).length;
  const withEmail = results.filter(b => b.email).length;
  const withEmailsFromWebsite = results.filter(b => b.emailsFromWebsite && b.emailsFromWebsite.length > 0).length;
  const withRating = results.filter(b => b.rating).length;
  const avgRating = results.filter(b => b.rating).reduce((sum, b) => sum + b.rating, 0) / withRating || 0;
  const avgReviews = results.reduce((sum, b) => sum + (b.reviewCount || 0), 0) / total || 0;

  return {
    scraper: scraperName,
    total,
    withPhone,
    withWebsite,
    withEmail,
    withEmailsFromWebsite,
    withRating,
    avgRating,
    avgReviews,
    phoneRate: Math.round((withPhone / total) * 100),
    websiteRate: Math.round((withWebsite / total) * 100),
    emailRate: Math.round((withEmail / total) * 100),
    emailsFromWebsiteRate: Math.round((withEmailsFromWebsite / total) * 100)
  };
}

function printStats(hasdata, outscraper) {
  const fields = [
    { label: 'Businesses Found', hasdataVal: hasdata.total, outscraperVal: outscraper.total },
    { label: 'With Phone', hasdataVal: `${hasdata.withPhone} (${hasdata.phoneRate}%)`, outscraperVal: `${outscraper.withPhone} (${outscraper.phoneRate}%)` },
    { label: 'With Website', hasdataVal: `${hasdata.withWebsite} (${hasdata.websiteRate}%)`, outscraperVal: `${outscraper.withWebsite} (${outscraper.websiteRate}%)` },
    { label: 'With Email (GMB)', hasdataVal: `${hasdata.withEmail} (${hasdata.emailRate}%)`, outscraperVal: `${outscraper.withEmail} (${outscraper.emailRate}%)` },
    { label: 'With Website Emails', hasdataVal: `${hasdata.withEmailsFromWebsite} (${hasdata.emailsFromWebsiteRate}%)`, outscraperVal: `${outscraper.withEmailsFromWebsite} (${outscraper.emailsFromWebsiteRate}%)` },
    { label: 'Avg Rating', hasdataVal: hasdata.avgRating.toFixed(1), outscraperVal: outscraper.avgRating.toFixed(1) },
    { label: 'Avg Reviews', hasdataVal: Math.round(hasdata.avgReviews), outscraperVal: Math.round(outscraper.avgReviews) },
  ];

  console.log('   ' + '-'.repeat(76));
  console.log('   | Field                | HasData           | Outscraper        | Winner |');
  console.log('   ' + '-'.repeat(76));

  fields.forEach(field => {
    const hasdataStr = String(field.hasdataVal).padEnd(17);
    const outscraperStr = String(field.outscraperVal).padEnd(17);

    // Determine winner (for numeric comparisons)
    let winner = '  -   ';
    if (typeof field.hasdataVal === 'number' && typeof field.outscraperVal === 'number') {
      if (field.hasdataVal > field.outscraperVal) winner = '  HD  ';
      else if (field.outscraperVal > field.hasdataVal) winner = '  OS  ';
    } else if (field.label.includes('%')) {
      const hdRate = parseInt(field.hasdataVal.match(/\d+/)?.[0] || 0);
      const osRate = parseInt(field.outscraperStr.match(/\d+/)?.[0] || 0);
      if (hdRate > osRate) winner = '  HD  ';
      else if (osRate > hdRate) winner = '  OS  ';
    }

    console.log(`   | ${field.label.padEnd(20)} | ${hasdataStr} | ${outscraperStr} | ${winner} |`);
  });

  console.log('   ' + '-'.repeat(76));
  console.log('   HD = HasData, OS = Outscraper\n');
}

// Run comparison
compareScraper().catch(error => {
  console.error('\n❌ Comparison failed:', error.message);
  console.error(error.stack);
  process.exit(1);
});
