/**
 * Test name extraction from email addresses
 */

const { getAllMergeVariables } = require('./shared/outreach-core/content-generation/email-merge-variables');

const testCases = [
  {
    name: '4mation architecture ltd',
    email: 'derek@4mation-architecture.com',
    ownerFirstName: null,
    expectedFirstName: 'Derek'
  },
  {
    name: 'Bevan & Co',
    email: 'peter@bevan.co.uk',
    ownerFirstName: null,
    expectedFirstName: 'Peter'
  },
  {
    name: 'EMS-IT',
    email: 'warren.lessells@ems-it.co.uk',
    ownerFirstName: null,
    expectedFirstName: 'Warren'
  },
  {
    name: 'Liz Kay Mortgages',
    email: 'liz@lizkaymortgages.co.uk',
    ownerFirstName: null,
    expectedFirstName: 'Liz'
  },
  {
    name: 'Whitfield Architects',
    email: 'hello@whitfieldarchitects.com',
    ownerFirstName: null,
    expectedFirstName: 'there' // Generic email, should fallback to "there"
  },
  {
    name: 'Butcher & Barlow',
    email: 'enquiries@butcher-barlow.co.uk',
    ownerFirstName: null,
    expectedFirstName: 'there' // Generic email, should fallback to "there"
  }
];

console.log('\n╔════════════════════════════════════════════════════════════════════╗');
console.log('║          NAME EXTRACTION FROM EMAIL - TEST RESULTS                ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');

let passed = 0;
let failed = 0;

testCases.forEach(test => {
  const mergeVars = getAllMergeVariables(test);
  const actualFirstName = mergeVars.firstName;
  const testPassed = actualFirstName === test.expectedFirstName;

  if (testPassed) {
    console.log(`✅ PASS: ${test.name}`);
    console.log(`   Email: ${test.email}`);
    console.log(`   Expected: "${test.expectedFirstName}" → Got: "${actualFirstName}"\n`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${test.name}`);
    console.log(`   Email: ${test.email}`);
    console.log(`   Expected: "${test.expectedFirstName}" → Got: "${actualFirstName}"\n`);
    failed++;
  }
});

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (failed === 0) {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                 ✅ ALL TESTS PASSED! ✅                            ║');
  console.log('║                                                                    ║');
  console.log('║  Name extraction from emails is working correctly!                ║');
  console.log('║  derek@... → Derek, peter@... → Peter, etc.                       ║');
  console.log('║  Generic emails (info@, hello@) correctly fallback to "there"     ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
} else {
  console.log('⚠️  Some tests failed. Check the output above.\n');
  process.exit(1);
}
