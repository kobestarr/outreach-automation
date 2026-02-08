/**
 * Test Micro-Offer Generation WITHOUT Outscraper API
 * Uses manually defined business data
 * Run: node test-without-scraping.js
 */

const { generateEmailContent } = require('./shared/outreach-core/content-generation/gpt-email-generator');
const { generateConnectionNote, generateLinkedInMessage } = require('./shared/outreach-core/content-generation/gpt-linkedin-generator');

async function testWithoutScraping() {
  console.log('🧪 Testing Micro-Offer System WITHOUT Outscraper\n');
  console.log('Using manually defined business data...\n');

  // Manually define business data (no scraping needed)
  const businesses = [
    {
      businessName: 'Elite Plumbing Services',
      ownerFirstName: 'John',
      category: 'Plumber',
      location: 'Bramhall, SK7',
      reviewCount: 6,
      rating: 4.3,
      website: null,
      linkedInTitle: 'Owner at Elite Plumbing'
    },
    {
      businessName: 'Glamour Hair Studio',
      ownerFirstName: 'Sarah',
      category: 'Hair Salon',
      location: 'Manchester',
      reviewCount: 34,
      rating: 4.8,
      website: 'https://glamourhair.co.uk',
      instagramUrl: 'https://instagram.com/glamourhair',
      linkedInTitle: 'Founder & Stylist at Glamour Hair Studio'
    },
    {
      businessName: 'The Daily Grind Cafe',
      ownerFirstName: 'Mike',
      category: 'Cafe',
      location: 'London SW1A 1AA',
      reviewCount: 89,
      rating: 4.6,
      website: 'https://dailygrind.london',
      linkedInTitle: 'Owner at The Daily Grind'
    }
  ];

  for (const business of businesses) {
    console.log('━'.repeat(60));
    console.log(`📍 ${business.businessName} (${business.category})`);
    console.log('━'.repeat(60));

    try {
      // Generate email
      console.log('\n📧 Generating Email...');
      const emailResult = await generateEmailContent(business);

      console.log(`\n✅ Subject: ${emailResult.subject}`);
      console.log(`\n${emailResult.body}\n`);

      const wordCount = emailResult.body.split(/\s+/).length;
      console.log(`📊 Metadata:`);
      console.log(`   Category: ${emailResult.metadata.categoryGroup}`);
      console.log(`   Primary Hook: ${emailResult.metadata.primaryHook}`);
      console.log(`   Signals Detected: ${emailResult.metadata.observationSignals.join(', ')}`);
      console.log(`   Micro-Offer: ${emailResult.metadata.microOfferPrice}`);
      console.log(`   Word Count: ${wordCount} words`);

      // Generate LinkedIn connection note
      console.log('\n💼 Generating LinkedIn Connection Note...');
      const connectionNote = await generateConnectionNote({
        ...business,
        emailAngleUsed: emailResult.metadata.categoryAngle
      });

      console.log(`\n✅ Connection Note (${connectionNote.length} chars):`);
      console.log(`"${connectionNote}"\n`);

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`\n❌ Error for ${business.businessName}:`, error.message);
    }

    console.log('\n');
  }

  console.log('✅ Test complete!\n');
}

// Run test
testWithoutScraping()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
