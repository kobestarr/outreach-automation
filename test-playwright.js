/**
 * Test Playwright integration with the website scraper
 * Tests JS-rendered sites that previously returned empty content
 */

const { needsBrowserRendering, fetchWithBrowser, closeBrowser, extractVisibleText } = require('./shared/outreach-core/enrichment/browser-fetcher');
const { extractEmails } = require('./shared/outreach-core/enrichment/website-scraper');

async function testPlaywright() {
  console.log('=== PLAYWRIGHT INTEGRATION TEST ===\n');

  // Test 1: Detection heuristic on known Wix HTML snippet
  console.log('--- Test 1: Detection Heuristic ---');
  const wixHtml = '<html><head><script>var wixCssCustom = true;</script></head><body><div id="SITE_CONTAINER"></div><script src="thunderbolt-main.js"></script></body></html>';
  const staticHtml = '<html><head><title>Test</title></head><body><h1>Hello World</h1><p>This is a normal static website with plenty of visible text content that should not trigger Playwright rendering at all.</p></body></html>';

  console.log(`  Wix HTML detected as JS-rendered: ${needsBrowserRendering(wixHtml)}`);
  console.log(`  Static HTML detected as JS-rendered: ${needsBrowserRendering(staticHtml)}`);
  console.log();

  // Test 2: Render Arundel Dental Practice team page (Wix)
  console.log('--- Test 2: Arundel Dental Practice (Wix) ---');
  console.log('  URL: https://www.arundeldentalpractice.co.uk/meet-the-team-subtitle');
  try {
    const arundel = await fetchWithBrowser('https://www.arundeldentalpractice.co.uk/meet-the-team-subtitle', 20000);
    if (arundel) {
      const visibleText = extractVisibleText(arundel);
      console.log(`  HTML length: ${arundel.length}`);
      console.log(`  Visible text length: ${visibleText.length}`);
      // Look for team member names
      const namePatterns = [
        /Christopher\s+Needham/i,
        /Dr\s+/i,
        /BDS/i,
        /dentist/i,
      ];
      for (const pattern of namePatterns) {
        const match = visibleText.match(pattern);
        console.log(`  Contains "${pattern.source}": ${!!match}${match ? ` → "${match[0]}"` : ''}`);
      }
      // Show first 500 chars of visible text
      console.log(`  First 500 chars of visible text:`);
      console.log(`    ${visibleText.substring(0, 500).replace(/\n/g, ' ')}`);
    } else {
      console.log('  FAILED: fetchWithBrowser returned null');
    }
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
  }
  console.log();

  // Test 3: Render Bramhall Smile Clinic team page (Divi)
  console.log('--- Test 3: Bramhall Smile Clinic (Divi) ---');
  console.log('  URL: https://www.bramhallsmileclinic.co.uk/our-team/');
  try {
    const bramhall = await fetchWithBrowser('https://www.bramhallsmileclinic.co.uk/our-team/', 20000);
    if (bramhall) {
      const visibleText = extractVisibleText(bramhall);
      console.log(`  HTML length: ${bramhall.length}`);
      console.log(`  Visible text length: ${visibleText.length}`);
      const namePatterns = [
        /Mohamed/i,
        /Mahmoud/i,
        /dentist/i,
        /Dr\s+/i,
      ];
      for (const pattern of namePatterns) {
        const match = visibleText.match(pattern);
        console.log(`  Contains "${pattern.source}": ${!!match}${match ? ` → "${match[0]}"` : ''}`);
      }
      console.log(`  First 500 chars of visible text:`);
      console.log(`    ${visibleText.substring(0, 500).replace(/\n/g, ' ')}`);
    } else {
      console.log('  FAILED: fetchWithBrowser returned null');
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
