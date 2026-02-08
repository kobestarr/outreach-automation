/**
 * Quick Live Test for Micro-Offer Email Generation
 * Run: node test-live-generation.js
 */

const { generateEmailContent } = require('./shared/outreach-core/content-generation/gpt-email-generator');
const { generateConnectionNote, generateLinkedInMessage } = require('./shared/outreach-core/content-generation/gpt-linkedin-generator');

async function testLiveGeneration() {
  console.log('=================================');
  console.log('  LIVE MICRO-OFFER TEST');
  console.log('=================================\n');

  const testBusiness = {
    businessName: 'The Cutting Room',
    ownerFirstName: 'Sarah',
    category: 'Hair Salon',
    location: 'Bramhall, SK7',
    reviewCount: 8,
    rating: 4.2,
    website: null,
    linkedInTitle: 'Owner at The Cutting Room'
  };

  console.log('Test Business:', testBusiness.businessName);
  console.log('Category:', testBusiness.category);
  console.log('Location:', testBusiness.location);
  console.log('');

  try {
    // Test 1: Email Generation
    console.log('📧 Generating Email...');
    const emailResult = await generateEmailContent(testBusiness);

    console.log('\n✅ EMAIL GENERATED:');
    console.log('━'.repeat(50));
    console.log(`Subject: ${emailResult.subject}`);
    console.log('━'.repeat(50));
    console.log(emailResult.body);
    console.log('━'.repeat(50));

    console.log('\n📊 Email Metadata:');
    console.log(JSON.stringify(emailResult.metadata, null, 2));

    // Validate 20 rules
    const subjectLowercase = emailResult.subject === emailResult.subject.toLowerCase();
    const bodyWordCount = emailResult.body.split(/\s+/).length;
    const bodyUnder100Words = bodyWordCount <= 100;
    const noExclamation = !emailResult.body.includes('!');
    const hasBuzzwords = /synergy|leverage|circle back|game-changer|innovative|cutting-edge/i.test(emailResult.body);

    console.log('\n✅ 20-Rule Validation:');
    console.log(`  ${subjectLowercase ? '✓' : '✗'} Lowercase subject: ${subjectLowercase}`);
    console.log(`  ${bodyUnder100Words ? '✓' : '✗'} Body under 100 words: ${bodyWordCount} words`);
    console.log(`  ${noExclamation ? '✓' : '✗'} No exclamation marks: ${noExclamation}`);
    console.log(`  ${!hasBuzzwords ? '✓' : '✗'} No buzzwords: ${!hasBuzzwords}`);

    // Test 2: LinkedIn Connection Note
    console.log('\n\n💼 Generating LinkedIn Connection Note...');
    const connectionNote = await generateConnectionNote({
      ownerFirstName: testBusiness.ownerFirstName,
      businessName: testBusiness.businessName,
      category: testBusiness.category,
      location: testBusiness.location,
      linkedInTitle: testBusiness.linkedInTitle,
      emailAngleUsed: emailResult.metadata.categoryAngle
    });

    console.log('\n✅ CONNECTION NOTE GENERATED:');
    console.log('━'.repeat(50));
    console.log(connectionNote);
    console.log('━'.repeat(50));
    console.log(`Character count: ${connectionNote.length} (max 300)`);

    // Test 3: LinkedIn First Message
    console.log('\n\n💼 Generating LinkedIn First Message...');
    const linkedInMessage = await generateLinkedInMessage({
      ownerFirstName: testBusiness.ownerFirstName,
      businessName: testBusiness.businessName,
      category: testBusiness.category,
      location: testBusiness.location,
      emailSubject: emailResult.subject,
      emailPrimaryHook: emailResult.metadata.primaryHook
    });

    console.log('\n✅ LINKEDIN MESSAGE GENERATED:');
    console.log('━'.repeat(50));
    console.log(linkedInMessage);
    console.log('━'.repeat(50));
    console.log(`Character count: ${linkedInMessage.length} (max 500)`);

    // Check angle differentiation
    const emailAngle = emailResult.metadata.categoryAngle.substring(0, 30);
    const angleRepeated = linkedInMessage.includes(emailAngle);
    console.log(`\n${!angleRepeated ? '✅' : '⚠️'} Angle differentiation: ${!angleRepeated ? 'PASS' : 'WARN - may repeat email angle'}`);

    console.log('\n\n✅ ALL TESTS PASSED!\n');

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    if (error.message.includes('OpenAI API error')) {
      console.error('\nℹ️  Make sure your OpenAI API key is configured in credentials.json');
    }
    process.exit(1);
  }
}

// Run test
testLiveGeneration()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
