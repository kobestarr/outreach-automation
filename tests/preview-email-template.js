/**
 * Email Template Preview
 * Shows what the actual emails will look like with merge variables
 */

const { scrapeWebsite } = require('../shared/outreach-core/enrichment/website-scraper');
const { getAllMergeVariables } = require('../shared/outreach-core/content-generation/email-merge-variables');

async function previewEmail() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              EMAIL TEMPLATE PREVIEW WITH MERGE VARIABLES           ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Use Arundel Dental Practice as example (multi-owner scenario)
  const testUrl = 'http://www.arundeldentalpractice.co.uk/';

  console.log('🔍 Scraping example business: Arundel Dental Practice\n');

  const websiteData = await scrapeWebsite(testUrl);

  const business = {
    name: 'Arundel Dental Practice',
    businessName: 'Arundel Dental Practice',
    category: 'Dentist',
    website: testUrl,
    postcode: 'SK7',
    location: 'Bramhall',
    rating: 4.9,
    reviews: 285,
    assignedOfferTier: 'tier3',
    owners: websiteData.ownerNames.map(owner => ({
      firstName: owner.name.split(' ')[0],
      lastName: owner.name.split(' ').slice(1).join(' '),
      fullName: owner.name,
      title: owner.title,
      hasEmailMatch: owner.hasEmailMatch,
      matchedEmail: owner.matchedEmail
    }))
  };

  // Set primary owner
  const primaryOwner = business.owners[0];
  business.ownerFirstName = primaryOwner.firstName;
  business.ownerLastName = primaryOwner.lastName;

  // Generate merge variables
  const mergeVars = getAllMergeVariables(business);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('MERGE VARIABLES POPULATED:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`{{firstName}}:          ${mergeVars.firstName}`);
  console.log(`{{lastName}}:           ${mergeVars.lastName}`);
  console.log(`{{companyName}}:        ${mergeVars.companyName}`);
  console.log(`{{location}}:           ${mergeVars.location}`);
  console.log(`{{businessType}}:       ${mergeVars.businessType}`);
  console.log(`{{tier}}:               ${mergeVars.tier}`);
  console.log(`{{microOfferPrice}}:    ${mergeVars.microOfferPrice}`);
  console.log(`{{isNearby}}:           ${mergeVars.isNearby}`);
  console.log(`{{localIntro}}:         ${mergeVars.localIntro}`);
  console.log(`{{observationSignal}}:  ${mergeVars.observationSignal}`);
  console.log(`{{meetingOption}}:      ${mergeVars.meetingOption}`);
  console.log(`{{multiOwnerNote}}:     ${mergeVars.multiOwnerNote}`);
  console.log(`{{noNameNote}}:         ${mergeVars.noNameNote}\n`);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('EMAIL PREVIEW (WITH MERGE VARIABLES):');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const emailTemplate = `
Subject: Quick website question for ${mergeVars.companyName}

Hi ${mergeVars.firstName},

${mergeVars.multiOwnerNote}${mergeVars.localIntro}I'm reaching out to dental practices in your area about their online presence.

${mergeVars.observationSignal}

I help local ${mergeVars.businessType}s improve their websites and get more patients through Google. I'd love to show you what I could do for ${mergeVars.companyName}.

Would you be open to ${mergeVars.meetingOption} to discuss?

I can start with a micro-offer at just ${mergeVars.microOfferPrice} to prove value first.

Best regards,
Kobe

P.S. - I'm based locally in Poynton, so I understand the ${mergeVars.location} market well.
  `.trim();

  console.log(emailTemplate);

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('EXAMPLE WITHOUT NAME (FALLBACK):');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const noNameBusiness = {
    ...business,
    ownerFirstName: null,
    ownerLastName: null,
    owners: []
  };

  const noNameVars = getAllMergeVariables(noNameBusiness);

  const noNameEmail = `
Subject: Quick website question for ${noNameVars.companyName}

Hi there,

${noNameVars.noNameNote}${noNameVars.localIntro}I'm reaching out to dental practices in your area about their online presence.

${noNameVars.observationSignal}

I help local ${noNameVars.businessType}s improve their websites and get more patients through Google. I'd love to show you what I could do for ${noNameVars.companyName}.

Would you be open to ${noNameVars.meetingOption} to discuss?

I can start with a micro-offer at just ${noNameVars.microOfferPrice} to prove value first.

Best regards,
Kobe

P.S. - I'm based locally in Poynton, so I understand the ${noNameVars.location} market well.
  `.trim();

  console.log(noNameEmail);

  console.log('\n\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                     ✅ EMAIL PREVIEW COMPLETE                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log('📧 To preview in Lemlist:');
  console.log('   1. Go to: https://app.lemlist.com/campaigns/cam_bJYSQ4pqMzasQWsRb');
  console.log('   2. Click "Preview" to see how emails render');
  console.log('   3. Check that merge variables populate correctly');
  console.log('   4. Send test email to yourself first!\n');
}

previewEmail().catch(error => {
  console.error('\n❌ Preview failed:', error.message);
  process.exit(1);
});
