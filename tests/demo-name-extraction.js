/**
 * Demo: Name Extraction from Arundel Dental Practice
 * Shows the improved extraction finding Christopher Needham, Michael Clark, and Rebecca Sherlock
 */

const { scrapeWebsite, parseName } = require('../shared/outreach-core/enrichment/website-scraper');
const { getAllMergeVariables } = require('../shared/outreach-core/content-generation/email-merge-variables');

async function demo() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║      DEMO: Name Extraction from Arundel Dental Practice           ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const testBusiness = {
    name: "Arundel Dental Practice",
    businessName: "Arundel Dental Practice",
    website: "https://www.arundeldentalpractice.co.uk",
    postcode: "SK7 1AL",
    location: "Bramhall, Stockport",
    category: "Dentist",
    assignedOfferTier: "tier5"
  };

  console.log('🔍 Scraping website for owner names...\n');
  console.log(`   Website: ${testBusiness.website}`);
  console.log(`   Looking for team page: /meet-the-team-subtitle\n`);

  try {
    const websiteData = await scrapeWebsite(testBusiness.website);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('OWNER NAMES EXTRACTED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (websiteData.ownerNames && websiteData.ownerNames.length > 0) {
      console.log(`✅ Found ${websiteData.ownerNames.length} owner names:\n`);
      websiteData.ownerNames.forEach((owner, idx) => {
        console.log(`   ${idx + 1}. ${owner.name}${owner.title ? ` (${owner.title})` : ''}`);
      });

      // Enrich business with first owner
      const primaryOwner = websiteData.ownerNames[0];
      const { firstName, lastName } = parseName(primaryOwner.name);
      testBusiness.ownerFirstName = firstName;
      testBusiness.ownerLastName = lastName;
      testBusiness.owners = websiteData.ownerNames.map(o => {
        const { firstName } = parseName(o.name);
        return {
          firstName: firstName,
          fullName: o.name,
          title: o.title
        };
      }).filter(o => o.firstName);

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('MERGE VARIABLES FOR EMAIL');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const mergeVariables = getAllMergeVariables(testBusiness);

      console.log(`firstName: "${mergeVariables.firstName}"`);
      console.log(`lastName: "${mergeVariables.lastName}"`);
      console.log(`companyName: "${mergeVariables.companyName}"`);
      console.log(`localIntro: "${mergeVariables.localIntro}"`);
      console.log(`observationSignal: "${mergeVariables.observationSignal}"`);
      console.log(`microOfferPrice: "${mergeVariables.microOfferPrice}"`);
      console.log(`meetingOption: "${mergeVariables.meetingOption}"`);
      console.log(`multiOwnerNote: "${mergeVariables.multiOwnerNote}"`);
      console.log(`noNameNote: "${mergeVariables.noNameNote}"`);

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('EMAIL PREVIEW');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const emailPreview = `Hi ${mergeVariables.firstName},

${mergeVariables.multiOwnerNote}${mergeVariables.noNameNote}${mergeVariables.localIntro}

I ${mergeVariables.observationSignal} at ${mergeVariables.companyName} and thought I'd reach out.

I help with things like keeping clients coming back, managing bookings, and getting your online presence sorted. I've worked with some interesting clients over the years (including Twiggy, yes the 60s fashion icon!), but I keep my prices pretty reasonable because I don't have the agency overheads.

From just ${mergeVariables.microOfferPrice} to get started – happy to ${mergeVariables.meetingOption} or I can share links to my work and we can have a chat on the phone.

Just reply to this email if you're interested.

Cheers,
Kobi

Sent from my iPhone`;

      console.log(emailPreview);
      console.log();

    } else {
      console.log('❌ No owner names found\n');
    }

    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║                   ✅ DEMO COMPLETE ✅                              ║');
    console.log('║                                                                    ║');
    console.log('║  Name extraction now finds:                                        ║');
    console.log('║  - Names from team page meta descriptions                          ║');
    console.log('║  - Names from HTML content                                         ║');
    console.log('║  - Multiple owners from same business                              ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  } catch (error) {
    console.error('\n❌ Demo failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

demo();
