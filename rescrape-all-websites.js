/**
 * Re-scrape all businesses with Playwright-enabled pipeline
 *
 * Runs scrapeWebsite() on every business in the DB and reports:
 * - New names found (especially from JS-rendered sites)
 * - Comparison with current DB data
 * - Which sites triggered Playwright
 *
 * Does NOT run full enrichment (no Companies House, Icypeas, LinkedIn calls)
 * Just the website scraping part to test Playwright integration.
 */

const Database = require('better-sqlite3');
const { scrapeWebsite } = require('./shared/outreach-core/enrichment/website-scraper');

const DB_PATH = './ksd/local-outreach/orchestrator/data/businesses.db';
const DELAY_MS = 1000; // Between scrapes to be polite

async function rescrapeAll() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║     RE-SCRAPE ALL BUSINESSES (Playwright-enabled pipeline)       ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const db = new Database(DB_PATH);

  const businesses = db.prepare(`
    SELECT id, name, website, owner_first_name, owner_last_name, owner_email
    FROM businesses
    WHERE website IS NOT NULL AND length(website) > 0
    ORDER BY name
  `).all();

  console.log(`Found ${businesses.length} businesses with websites\n`);

  let scraped = 0;
  let improved = 0;
  let updated = 0;
  let playwrightUsed = 0;
  let errors = 0;
  const improvements = [];

  for (const biz of businesses) {
    const label = `${biz.name.substring(0, 40).padEnd(40)}`;

    // Skip social media URLs
    if (biz.website.includes('facebook.com') || biz.website.includes('instagram.com')) {
      console.log(`  SKIP  ${label}  (social media URL)`);
      continue;
    }

    try {
      const result = await scrapeWebsite(biz.website);
      scraped++;

      const currentName = `${biz.owner_first_name || ''} ${biz.owner_last_name || ''}`.trim();
      const newNames = result.ownerNames.map(o => o.name).join(', ') || '(none)';
      const newEmails = result.emails.length;
      const namesWithEmails = result.ownerNames.filter(o => o.hasEmailMatch).length;

      // Check if we found new/better data
      const hadName = biz.owner_first_name && biz.owner_first_name !== 'there' && !biz.owner_first_name.endsWith(' Team');
      const foundNewNames = result.ownerNames.length > 0;
      const foundMore = result.ownerNames.length > 1;
      const isImprovement = (!hadName && foundNewNames) || foundMore;

      if (isImprovement) {
        improved++;
        improvements.push({
          name: biz.name,
          website: biz.website,
          currentName,
          newNames: result.ownerNames.map(o => `${o.name} (${o.title || 'unknown'})`),
          newEmails: result.emails,
          namesWithEmails
        });
        console.log(`  NEW!  ${label}  ${currentName || '(none)'} → ${newNames} [${newEmails} emails, ${namesWithEmails} matched]`);
      } else if (foundNewNames) {
        console.log(`  OK    ${label}  ${newNames} [${newEmails} emails]`);
      } else {
        console.log(`  ---   ${label}  no names found [${newEmails} emails]`);
      }

      // PERSIST: Update business_data with new owners array
      if (result.ownerNames.length > 0) {
        try {
          const row = db.prepare('SELECT business_data FROM businesses WHERE id = ?').get(biz.id);
          let businessData = {};
          try { businessData = row && row.business_data ? JSON.parse(row.business_data) : {}; } catch (e) {}

          // Build owners array matching enrichment pipeline format
          businessData.owners = result.ownerNames.slice(0, 5).map(o => {
            const parts = o.name.split(/\s+/);
            return {
              firstName: parts[0] || '',
              lastName: parts.slice(1).join(' ') || '',
              fullName: o.name,
              title: o.title || null,
              email: o.matchedEmail || null,
              emailSource: o.hasEmailMatch ? 'website-scraping' : null,
              source: 'website-scraping'
            };
          });

          // Update primary owner if we found a better one
          const bestOwner = result.ownerNames[0];
          const bestParts = bestOwner.name.split(/\s+/);

          db.prepare(`
            UPDATE businesses
            SET business_data = ?,
                owner_first_name = COALESCE(NULLIF(owner_first_name, ''), ?),
                owner_last_name = COALESCE(NULLIF(owner_last_name, ''), ?),
                updated_at = ?
            WHERE id = ?
          `).run(
            JSON.stringify(businessData),
            bestParts[0] || biz.owner_first_name,
            bestParts.slice(1).join(' ') || biz.owner_last_name,
            new Date().toISOString(),
            biz.id
          );
          updated++;
        } catch (saveErr) {
          console.log(`  SAVE-ERR  ${label}  ${saveErr.message}`);
        }
      }

    } catch (err) {
      console.log(`  ERR   ${label}  ${err.message.substring(0, 60)}`);
      errors++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SCRAPE COMPLETE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Scraped:     ${scraped}`);
  console.log(`  Improved:    ${improved} (new/better names found)`);
  console.log(`  DB Updated:  ${updated} (owners array saved)`);
  console.log(`  Errors:      ${errors}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (improvements.length > 0) {
    console.log('\n=== IMPROVEMENTS FOUND ===\n');
    for (const imp of improvements) {
      console.log(`  ${imp.name}`);
      console.log(`    Was:   ${imp.currentName || '(no name)'}`);
      console.log(`    Now:   ${imp.newNames.join(', ')}`);
      console.log(`    Emails found: ${imp.newEmails.length} (${imp.namesWithEmails} matched to people)`);
      console.log();
    }
  }

  db.close();
}

rescrapeAll().catch(err => {
  console.error('Re-scrape failed:', err);
  process.exit(1);
});
