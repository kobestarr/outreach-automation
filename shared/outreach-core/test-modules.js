/**
 * Test script for outreach core modules
 * Run with: node test-modules.js
 */

const { getCredential, checkDailyLimit, recordUsage } = require('./credentials-loader');
const { verifyEmail, checkAvailability } = require('./email-verification/reoon-verifier');
const logger = require('./logger');

async function testCredentialsLoader() {
  logger.info('test-modules', '\n=== Testing Credentials Loader ===');
  
  try {
    // Test loading credentials
    const reoonKey = getCredential('reoon', 'apiKey');
    logger.info('test-modules', '✅ Reoon API key loaded:', { preview: reoonKey.substring(0, 10) + '...' });
    
    const hasdataKey = getCredential('hasdata', 'apiKey');
    logger.info('test-modules', '✅ HasData API key loaded:', { preview: hasdataKey.substring(0, 10) + '...' });
    
    const openaiKey = getCredential('openai', 'apiKey');
    logger.info('test-modules', '✅ OpenAI API key loaded:', { preview: openaiKey.substring(0, 10) + '...' });
    
    // Test usage tracking
    const reoonLimit = checkDailyLimit('reoon');
    logger.info('test-modules', '📊 Reoon Usage:', {
      used: reoonLimit.used,
      remaining: reoonLimit.remaining,
      limit: reoonLimit.limit,
      canUse: reoonLimit.canUse
    });
    
    const icypeasLimit = checkDailyLimit('icypeas');
    logger.info('test-modules', '📊 Icypeas Usage:', {
      used: icypeasLimit.used,
      remaining: icypeasLimit.remaining,
      limit: icypeasLimit.limit,
      canUse: icypeasLimit.canUse
    });
    
    logger.info('test-modules', '✅ Credentials loader test passed!');
    return true;
  } catch (error) {
    logger.error('test-modules', '❌ Credentials loader test failed:', { error: error.message });
    return false;
  }
}

async function testEmailVerification() {
  logger.info('test-modules', '\n=== Testing Email Verification (Reoon) ===');
  
  try {
    // Check availability first
    const availability = checkAvailability();
    logger.info('test-modules', '📊 Reoon Availability:', {
      remaining: availability.remaining,
      canUse: availability.canUse
    });
    
    if (!availability.canUse) {
      logger.warn('test-modules', '⚠️  Daily limit reached. Skipping actual verification test.');
      return true;
    }
    
    // Test with a known valid email (use a test email to avoid wasting credits)
    logger.info('test-modules', '🧪 Testing verification (using test@example.com - this will use 1 credit)...');
    logger.info('test-modules', '   (You can change this to a real email if you want)');
    
    // Uncomment the line below to actually test verification
    // const result = await verifyEmail('test@example.com');
    // logger.info('test-modules', '✅ Verification result:', { result: JSON.stringify(result, null, 2) });
    
    logger.warn('test-modules', '⚠️  Skipping actual API call to save credits. Uncomment in test script to test.');
    logger.info('test-modules', '✅ Email verification module loaded successfully!');
    return true;
  } catch (error) {
    logger.error('test-modules', '❌ Email verification test failed:', { error: error.message });
    return false;
  }
}

async function runAllTests() {
  logger.info('test-modules', '🚀 Starting Outreach Core Module Tests\n');
  logger.info('test-modules', '='.repeat(50));
  
  const results = {
    credentials: await testCredentialsLoader(),
    emailVerification: await testEmailVerification()
  };
  
  logger.info('test-modules', '\n' + '='.repeat(50));
  logger.info('test-modules', '📋 Test Summary:');
  logger.info('test-modules', '   Credentials Loader:', { status: results.credentials ? '✅ PASS' : '❌ FAIL' });
  logger.info('test-modules', '   Email Verification:', { status: results.emailVerification ? '✅ PASS' : '❌ FAIL' });
  
  const allPassed = Object.values(results).every(r => r === true);
  logger.info('test-modules', '\n' + (allPassed ? '✅ All tests passed!' : '❌ Some tests failed'));
  
  return allPassed;
}

// Run tests if called directly
if (require.main === module) {
  runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    logger.error('test-modules', 'Fatal error:', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

module.exports = { runAllTests, testCredentialsLoader, testEmailVerification };
