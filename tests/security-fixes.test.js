/**
 * Security Fixes Test Suite - Phase 1
 * Tests SSRF protection, redirect limiting, domain validation, and SMTP rate limiting
 */

const { validateUrl, isPrivateIp } = require('../shared/outreach-core/security/url-validator');
const smtpRateLimiter = require('../shared/outreach-core/security/smtp-rate-limiter');

async function runTests() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          SECURITY FIXES TEST SUITE - PHASE 1                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  let passedTests = 0;
  let failedTests = 0;

  /**
   * Test helper function
   */
  function test(name, testFn) {
    try {
      testFn();
      console.log(`✅ PASS: ${name}`);
      passedTests++;
    } catch (error) {
      console.log(`❌ FAIL: ${name}`);
      console.log(`   Error: ${error.message}\n`);
      failedTests++;
    }
  }

  async function asyncTest(name, testFn) {
    try {
      await testFn();
      console.log(`✅ PASS: ${name}`);
      passedTests++;
    } catch (error) {
      console.log(`❌ FAIL: ${name}`);
      console.log(`   Error: ${error.message}\n`);
      failedTests++;
    }
  }

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  }

  // ============================================================================
  // TEST SUITE 1: SSRF PROTECTION
  // ============================================================================

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST SUITE 1: SSRF PROTECTION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Test 1.1: Loopback IP (127.0.0.1)
  test('1.1: isPrivateIp() blocks loopback 127.0.0.1', () => {
    assert(isPrivateIp('127.0.0.1'), 'Should block 127.0.0.1');
    assert(isPrivateIp('127.0.0.2'), 'Should block 127.0.0.2');
    assert(isPrivateIp('127.255.255.255'), 'Should block any 127.x.x.x');
  });

  // Test 1.2: Private Class A (10.0.0.0/8)
  test('1.2: isPrivateIp() blocks private Class A 10.0.0.0/8', () => {
    assert(isPrivateIp('10.0.0.1'), 'Should block 10.0.0.1');
    assert(isPrivateIp('10.255.255.255'), 'Should block 10.255.255.255');
  });

  // Test 1.3: Private Class B (172.16.0.0/12)
  test('1.3: isPrivateIp() blocks private Class B 172.16.0.0/12', () => {
    assert(isPrivateIp('172.16.0.1'), 'Should block 172.16.0.1');
    assert(isPrivateIp('172.31.255.255'), 'Should block 172.31.255.255');
    assert(!isPrivateIp('172.15.0.1'), 'Should NOT block 172.15.0.1 (outside range)');
    assert(!isPrivateIp('172.32.0.1'), 'Should NOT block 172.32.0.1 (outside range)');
  });

  // Test 1.4: Private Class C (192.168.0.0/16)
  test('1.4: isPrivateIp() blocks private Class C 192.168.0.0/16', () => {
    assert(isPrivateIp('192.168.0.1'), 'Should block 192.168.0.1');
    assert(isPrivateIp('192.168.255.255'), 'Should block 192.168.255.255');
  });

  // Test 1.5: Link-local (169.254.0.0/16)
  test('1.5: isPrivateIp() blocks link-local 169.254.0.0/16', () => {
    assert(isPrivateIp('169.254.0.1'), 'Should block 169.254.0.1');
    assert(isPrivateIp('169.254.169.254'), 'Should block AWS metadata endpoint');
  });

  // Test 1.6: Carrier-grade NAT (100.64.0.0/10)
  test('1.6: isPrivateIp() blocks Carrier-grade NAT 100.64.0.0/10', () => {
    assert(isPrivateIp('100.64.0.1'), 'Should block 100.64.0.1');
    assert(isPrivateIp('100.127.255.255'), 'Should block 100.127.255.255');
    assert(!isPrivateIp('100.63.0.1'), 'Should NOT block 100.63.0.1 (outside range)');
  });

  // Test 1.7: Public IPs allowed
  test('1.7: isPrivateIp() allows public IPs', () => {
    assert(!isPrivateIp('8.8.8.8'), 'Should allow Google DNS');
    assert(!isPrivateIp('1.1.1.1'), 'Should allow Cloudflare DNS');
    assert(!isPrivateIp('151.101.1.140'), 'Should allow public IP');
  });

  // Test 1.8: validateUrl() blocks private IPs
  await asyncTest('1.8: validateUrl() blocks http://127.0.0.1', async () => {
    const result = await validateUrl('http://127.0.0.1');
    assert(!result.safe, 'Should reject 127.0.0.1');
    assert(result.reason === 'Private IP address', 'Reason should be "Private IP address"');
  });

  // Test 1.9: validateUrl() blocks cloud metadata
  await asyncTest('1.9: validateUrl() blocks AWS metadata endpoint', async () => {
    const result = await validateUrl('http://169.254.169.254/latest/meta-data/');
    assert(!result.safe, 'Should reject 169.254.169.254');
    assert(result.reason === 'Blocked hostname' || result.reason === 'Private IP address',
           `Reason should be "Blocked hostname" or "Private IP address" (got "${result.reason}")`);
  });

  // Test 1.10: validateUrl() blocks localhost hostname
  await asyncTest('1.10: validateUrl() blocks localhost hostname', async () => {
    const result = await validateUrl('http://localhost');
    assert(!result.safe, 'Should reject localhost');
    assert(result.reason === 'Blocked hostname', 'Reason should be "Blocked hostname"');
  });

  // Test 1.11: validateUrl() blocks invalid protocols
  await asyncTest('1.11: validateUrl() blocks non-HTTP protocols', async () => {
    const result = await validateUrl('file:///etc/passwd');
    assert(!result.safe, 'Should reject file:// protocol');
    assert(result.reason === 'Invalid protocol (only http/https allowed)', 'Should specify invalid protocol');
  });

  // Test 1.12: validateUrl() allows legitimate URLs
  await asyncTest('1.12: validateUrl() allows legitimate public URLs', async () => {
    const result = await validateUrl('https://www.google.com');
    assert(result.safe, 'Should allow google.com');
  });

  console.log('\n');

  // ============================================================================
  // TEST SUITE 2: SMTP RATE LIMITING
  // ============================================================================

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST SUITE 2: SMTP RATE LIMITING');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Test 2.1: First 5 attempts allowed
  test('2.1: SMTP rate limiter allows first 5 attempts', () => {
    smtpRateLimiter.clearAll(); // Reset for testing
    const host = 'test-mail-server.example.com';

    assert(smtpRateLimiter.canAttempt(host), '1st attempt should be allowed');
    assert(smtpRateLimiter.canAttempt(host), '2nd attempt should be allowed');
    assert(smtpRateLimiter.canAttempt(host), '3rd attempt should be allowed');
    assert(smtpRateLimiter.canAttempt(host), '4th attempt should be allowed');
    assert(smtpRateLimiter.canAttempt(host), '5th attempt should be allowed');
  });

  // Test 2.2: 6th attempt blocked
  test('2.2: SMTP rate limiter blocks 6th attempt', () => {
    // Continuing from previous test (already at 5 attempts)
    const host = 'test-mail-server.example.com';
    assert(!smtpRateLimiter.canAttempt(host), '6th attempt should be blocked');
  });

  // Test 2.3: Status tracking
  test('2.3: SMTP rate limiter status tracking', () => {
    const host = 'test-mail-server.example.com';
    const status = smtpRateLimiter.getStatus(host);

    assert(status.attempts === 5, `Should show 5 attempts (got ${status.attempts})`);
    assert(status.remaining === 0, `Should show 0 remaining (got ${status.remaining})`);
    assert(status.resetAt !== null, 'Should have reset timestamp');
  });

  // Test 2.4: Different hosts have separate limits
  test('2.4: SMTP rate limiter isolates different hosts', () => {
    smtpRateLimiter.clearAll();
    const host1 = 'mail1.example.com';
    const host2 = 'mail2.example.com';

    // Use up limit for host1
    for (let i = 0; i < 5; i++) {
      smtpRateLimiter.canAttempt(host1);
    }

    assert(!smtpRateLimiter.canAttempt(host1), 'host1 should be rate limited');
    assert(smtpRateLimiter.canAttempt(host2), 'host2 should still be allowed');
  });

  // Test 2.5: Manual reset
  test('2.5: SMTP rate limiter manual reset', () => {
    smtpRateLimiter.clearAll();
    const host = 'test-reset.example.com';

    // Use up limit
    for (let i = 0; i < 5; i++) {
      smtpRateLimiter.canAttempt(host);
    }

    assert(!smtpRateLimiter.canAttempt(host), 'Should be rate limited before reset');

    smtpRateLimiter.reset(host);

    assert(smtpRateLimiter.canAttempt(host), 'Should be allowed after manual reset');
  });

  console.log('\n');

  // ============================================================================
  // SUMMARY
  // ============================================================================

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const totalTests = passedTests + failedTests;
  const passRate = Math.round((passedTests / totalTests) * 100);

  console.log(`Total Tests:  ${totalTests}`);
  console.log(`Passed:       ${passedTests} ✅`);
  console.log(`Failed:       ${failedTests} ❌`);
  console.log(`Pass Rate:    ${passRate}%\n`);

  if (failedTests === 0) {
    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║                  ✅ ALL TESTS PASSED ✅                            ║');
    console.log('║         Phase 1 security fixes are working correctly!              ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    process.exit(0);
  } else {
    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║                  ❌ SOME TESTS FAILED ❌                           ║');
    console.log('║            Please review and fix failing tests                     ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    process.exit(1);
  }
}

// Run the test suite
runTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
