/**
 * Test Playwright integration with the website scraper
 * Tests JS-rendered sites and verifies MULTI-PERSON extraction
 */

const { needsBrowserRendering, fetchWithBrowser, closeBrowser, extractVisibleText } = require('./shared/outreach-core/enrichment/browser-fetcher');
const { extractOwnerNames, extractEmails, scrapeWebsite } = require('./shared/outreach-core/enrichment/website-scraper');

async function testPlaywright() {
  console.log('=== PLAYWRIGHT INTEGRATION TEST (MULTI-PERSON) ===\n');

  // Test 1: Detection heuristic on known Wix HTML snippet
  console.log('--- Test 1: Detection Heuristic ---');
  const wixHtml = '<html><head><script>var wixCssCustom = true;</script></head><body><div id="SITE_CONTAINER"></div><script src="thunderbolt-main.js"></script></body></html>';
  const staticHtml = '<html><head><title>Test</title></head><body><h1>Hello World</h1><p>This is a normal static website with plenty of visible text content that should not trigger Playwright rendering at all.</p></body></html>';

  console.log(`  Wix HTML detected as JS-rendered: ${needsBrowserRendering(wixHtml)}`);
  console.log(`  Static HTML detected as JS-rendered: ${needsBrowserRendering(staticHtml)}`);
  console.log();

  // Test 2: Multi-person extraction from Arundel Dental (Wix team page)
  console.log('--- Test 2: Arundel Dental Practice - MULTI-PERSON EXTRACTION (Wix) ---');
  console.log('  URL: https://www.arundeldentalpractice.co.uk/meet-the-team-subtitle');
  try {
    const arundel = await fetchWithBrowser('https://www.arundeldentalpractice.co.uk/meet-the-team-subtitle', 20000);
    if (arundel) {
      const visibleText = extractVisibleText(arundel);
      const emails = extractEmails(arundel);
      const people = extractOwnerNames(arundel, emails);

      console.log(`  HTML length: ${arundel.length}`);
      console.log(`  Visible text length: ${visibleText.length}`);
      console.log(`  Emails found: ${emails.length} → ${emails.join(', ') || '(none)'}`);
      console.log(`  People found: ${people.length}`);

      if (people.length > 0) {
        console.log('  Team members:');
        for (const person of people) {
          const emailTag = person.hasEmailMatch ? ` [${person.matchedEmail}]` : '';
          console.log(`    - ${person.name} (${person.title || 'no title'})${emailTag}`);
        }
      }

      const PASS = people.length > 1 ? 'PASS' : 'FAIL';
      console.log(`\n  ${PASS}: Found ${people.length} people (expected >1)`);
    } else {
      console.log('  FAILED: fetchWithBrowser returned null');
    }
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
  }
  console.log();

  // Test 3: Multi-person extraction from Bramhall Smile Clinic (Divi team page)
  console.log('--- Test 3: Bramhall Smile Clinic - MULTI-PERSON EXTRACTION (Divi) ---');
  console.log('  URL: https://www.bramhallsmileclinic.co.uk/our-team/');
  try {
    const bramhall = await fetchWithBrowser('https://www.bramhallsmileclinic.co.uk/our-team/', 20000);
    if (bramhall) {
      const visibleText = extractVisibleText(bramhall);
      const emails = extractEmails(bramhall);
      const people = extractOwnerNames(bramhall, emails);

      console.log(`  HTML length: ${bramhall.length}`);
      console.log(`  Visible text length: ${visibleText.length}`);
      console.log(`  Emails found: ${emails.length} → ${emails.join(', ') || '(none)'}`);
      console.log(`  People found: ${people.length}`);

      if (people.length > 0) {
        console.log('  Team members:');
        for (const person of people) {
          const emailTag = person.hasEmailMatch ? ` [${person.matchedEmail}]` : '';
          console.log(`    - ${person.name} (${person.title || 'no title'})${emailTag}`);
        }
      }

      const PASS = people.length > 1 ? 'PASS' : 'FAIL';
      console.log(`\n  ${PASS}: Found ${people.length} people (expected >1)`);
    } else {
      console.log('  FAILED: fetchWithBrowser returned null');
    }
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
  }
  console.log();

  // Test 4: Full scrapeWebsite() pipeline — verifies early exit is REMOVED
  // This tests the complete flow: main page → team page discovery → multi-person extraction
  console.log('--- Test 4: Full scrapeWebsite() pipeline (early exit removed?) ---');
  console.log('  URL: https://www.arundeldentalpractice.co.uk');
  try {
    const result = await scrapeWebsite('https://www.arundeldentalpractice.co.uk');
    console.log(`  Owner names found: ${result.ownerNames.length}`);
    console.log(`  Emails found: ${result.emails.length}`);

    if (result.ownerNames.length > 0) {
      console.log('  People extracted by full pipeline:');
      for (const person of result.ownerNames) {
        const emailTag = person.hasEmailMatch ? ` [${person.matchedEmail}]` : '';
        console.log(`    - ${person.name} (${person.title || 'no title'})${emailTag}`);
      }
    }

    const PASS = result.ownerNames.length > 1 ? 'PASS' : 'FAIL';
    console.log(`\n  ${PASS}: Full pipeline found ${result.ownerNames.length} people (expected >1)`);
    if (result.ownerNames.length <= 1) {
      console.log('  DIAGNOSIS: Early exit may still be active — scraper stopped after finding 1 person');
    }
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
  }

  await closeBrowser();
  console.log('\n=== TEST COMPLETE ===');
}

testPlaywright().catch(err => {
  console.error('Test failed:', err);
  closeBrowser();
  process.exit(1);
});
