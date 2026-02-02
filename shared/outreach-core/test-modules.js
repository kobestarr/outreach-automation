/**
 * Test script for outreach core modules
 * Run with: node test-modules.js
 */

const { getCredential, checkDailyLimit, recordUsage } = require('./credentials-loader');
const { verifyEmail, checkAvailability } = require('./email-verification/reoon-verifier');

async function testCredentialsLoader() {
  console.log('\n=== Testing Credentials Loader ===');
  
  try {
    // Test loading credentials
    const reoonKey = getCredential('reoon', 'apiKey');
    console.log('✅ Reoon API key loaded:', reoonKey.substring(0, 10) + '...');
    
    const hasdataKey = getCredential('hasdata', 'apiKey');
    console.log('✅ HasData API key loaded:', hasdataKey.substring(0, 10) + '...');
    
    const openaiKey = getCredential('openai', 'apiKey');
    console.log('✅ OpenAI API key loaded:', openaiKey.substring(0, 10) + '...');
    
    // Test usage tracking
    const reoonLimit = checkDailyLimit('reoon');
    console.log('\n📊 Reoon Usage:');
    console.log('   Used:', reoonLimit.used);
    console.log('   Remaining:', reoonLimit.remaining);
    console.log('   Limit:', reoonLimit.limit);
    console.log('   Can Use:', reoonLimit.canUse);
    
    const icypeasLimit = checkDailyLimit('icypeas');
    console.log('\n📊 Icypeas Usage:');
    console.log('   Used:', icypeasLimit.used);
    console.log('   Remaining:', icypeasLimit.remaining);
    console.log('   Limit:', icypeasLimit.limit);
    console.log('   Can Use:', icypeasLimit.canUse);
    
    console.log('\n✅ Credentials loader test passed!');
    return true;
  } catch (error) {
    console.error('❌ Credentials loader test failed:', error.message);
    return false;
  }
}

async function testEmailVerification() {
  console.log('\n=== Testing Email Verification (Reoon) ===');
  
  try {
    // Check availability first
    const availability = checkAvailability();
    console.log('📊 Reoon Availability:');
    console.log('   Remaining:', availability.remaining);
    console.log('   Can Use:', availability.canUse);
    
    if (!availability.canUse) {
      console.log('⚠️  Daily limit reached. Skipping actual verification test.');
      return true;
    }
    
    // Test with a known valid email (use a test email to avoid wasting credits)
    console.log('\n🧪 Testing verification (using test@example.com - this will use 1 credit)...');
    console.log('   (You can change this to a real email if you want)');
    
    // Uncomment the line below to actually test verification
    // const result = await verifyEmail('test@example.com');
    // console.log('✅ Verification result:', JSON.stringify(result, null, 2));
    
    console.log('\n⚠️  Skipping actual API call to save credits. Uncomment in test script to test.');
    console.log('✅ Email verification module loaded successfully!');
    return true;
  } catch (error) {
    console.error('❌ Email verification test failed:', error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Starting Outreach Core Module Tests\n');
  console.log('='.repeat(50));
  
  const results = {
    credentials: await testCredentialsLoader(),
    emailVerification: await testEmailVerification()
  };
  
  console.log('\n' + '='.repeat(50));
  console.log('\n📋 Test Summary:');
  console.log('   Credentials Loader:', results.credentials ? '✅ PASS' : '❌ FAIL');
  console.log('   Email Verification:', results.emailVerification ? '✅ PASS' : '❌ FAIL');
  
  const allPassed = Object.values(results).every(r => r === true);
  console.log('\n' + (allPassed ? '✅ All tests passed!' : '❌ Some tests failed'));
  
  return allPassed;
}

// Run tests if called directly
if (require.main === module) {
  runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { runAllTests, testCredentialsLoader, testEmailVerification };
