/**
 * Test that generic emails are now kept and prioritized correctly
 */

const { scrapeWebsite } = require('./shared/outreach-core/enrichment/website-scraper');

const testBusinesses = [
  { name: 'Kloud Tax', url: 'https://www.kloudtaxaccountants.co.uk/', expected: 'enquiries@kloudtaxaccountants.co.uk' },
  { name: 'Bupa Dental', url: 'https://www.bupa.co.uk/dental/dental-care/practices/p/bramhall', expected: 'info@ or similar' },
  { name: 'The Little Hideout Cafe', url: 'https://www.thelittlehideout.co.uk/', expected: 'info@ or contact@' }
];

console.log('\n╔════════════════════════════════════════════════════════════════════╗');
console.log('║           GENERIC EMAIL FIX VERIFICATION                           ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');

(async () => {
  for (const business of testBusinesses) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Testing: ${business.name}`);
    console.log(`URL: ${business.url}`);
    console.log(`Expected: ${business.expected}\n`);

    try {
      const result = await scrapeWebsite(business.url);

      if (result.emails && result.emails.length > 0) {
        console.log(`✅ EMAILS FOUND: ${result.emails.length}`);
        result.emails.forEach((email, i) => {
          const isGeneric = /^(info|contact|hello|support|admin|enquiries|mail)@/i.test(email);
          const label = isGeneric ? '(generic)' : '(personal)';
          console.log(`  ${i + 1}. ${email} ${label}`);
        });
      } else {
        console.log(`❌ NO EMAILS FOUND`);
      }

      console.log();
    } catch (error) {
      console.log(`❌ Error: ${error.message}\n`);
    }
  }

  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                    TEST COMPLETE                                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
})();
