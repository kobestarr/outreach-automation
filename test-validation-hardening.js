/**
 * Test that hardened validation catches ALL known bad patterns
 */
const { isValidPersonName, isValidNamePair, isValidEmail } = require('./shared/outreach-core/validation/data-quality');

// All the bad names that slipped through before
const badNames = [
  ['Aldridge', 'Birmingham'],
  ['Attach', 'Files'],
  ['Begum', 'Client'],
  ['Chartered', 'Management'],
  ['Chartered', 'Certified'],
  ['Cheshire', 'Structural'],
  ['Commercial', 'Insurance'],
  ['Community', 'Response'],
  ['Cutter', 'Approaches'],
  ['Data', 'Protection'],
  ['Elimination', 'Diet'],
  ['Employment', 'Law'],
  ['Engineering', 'Machine Operators'],
  ['Kajal', 'Bh'],
  ['Managed', 'Businesses'],
  ['Mixed', 'Meze Pl'],
  ['My', 'Su'],
  ['Socials', 'Su'],
  ['Survey', 'Choose Your Survey'],
  ['Wilson', 'Accountancy'],
  ['Recurring', 'Su'],
];

// Bad emails
const badEmails = [
  '605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com',
  '8c4075d5481d476e945486754f783364@sentry.io',
];

// Good names that should PASS
const goodNames = [
  ['Anna', 'Wickham'],
  ['Ben', 'Foster'],
  ['Christopher', 'Needham'],
  ['Mohamed', 'Mahmoud'],
  ['Suzie', 'Facer'],
  ['Tom', 'Bedford'],
  ['there', ''],
];

// Good emails that should PASS
const goodEmails = [
  'anna.wickham@castletree.co.uk',
  'bramhallsmiles@gmail.com',
  'info@techevolution.co.uk',
  'peter@bevan.co.uk',
];

console.log('=== BAD NAMES (should ALL be rejected) ===');
let allBadCaught = true;
for (const [first, last] of badNames) {
  const validPair = isValidNamePair(first, last);
  const blocked = !validPair;
  const marker = blocked ? '  BLOCKED' : '  MISSED!';
  const suffix = blocked ? '' : ' <-- FIX THIS';
  console.log(marker + ' ' + first + ' ' + last + suffix);
  if (!blocked) allBadCaught = false;
}

console.log();
console.log('=== BAD EMAILS (should ALL be rejected) ===');
let allBadEmailsCaught = true;
for (const email of badEmails) {
  const valid = isValidEmail(email);
  const marker = valid ? '  MISSED!' : '  BLOCKED';
  console.log(marker + ' ' + email);
  if (valid) allBadEmailsCaught = false;
}

console.log();
console.log('=== GOOD NAMES (should ALL pass) ===');
let allGoodPass = true;
for (const [first, last] of goodNames) {
  const validPair = isValidNamePair(first, last);
  const marker = validPair ? '  PASS   ' : '  FAIL!  ';
  console.log(marker + ' ' + first + ' ' + (last || '(empty)'));
  if (!validPair) allGoodPass = false;
}

console.log();
console.log('=== GOOD EMAILS (should ALL pass) ===');
let allGoodEmailsPass = true;
for (const email of goodEmails) {
  const valid = isValidEmail(email);
  const marker = valid ? '  PASS   ' : '  FAIL!  ';
  console.log(marker + ' ' + email);
  if (!valid) allGoodEmailsPass = false;
}

console.log();
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('RESULTS:');
console.log('  All bad names blocked:  ' + (allBadCaught ? 'YES' : 'NO - NEEDS FIXING'));
console.log('  All bad emails blocked: ' + (allBadEmailsCaught ? 'YES' : 'NO - NEEDS FIXING'));
console.log('  All good names pass:    ' + (allGoodPass ? 'YES' : 'NO - NEEDS FIXING'));
console.log('  All good emails pass:   ' + (allGoodEmailsPass ? 'YES' : 'NO - NEEDS FIXING'));
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const allPassed = allBadCaught && allBadEmailsCaught && allGoodPass && allGoodEmailsPass;
console.log(allPassed ? '\nALL TESTS PASSED - Validation is bulletproof!\n' : '\nSOME TESTS FAILED - Fix before launch!\n');
process.exit(allPassed ? 0 : 1);
