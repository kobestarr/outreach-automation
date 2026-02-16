/**
 * Test the dictionary-based concatenated name splitter
 */
const { extractNameFromEmail, trySplitConcatenatedName } = require('./shared/outreach-core/validation/data-quality');

console.log('=== CONCATENATED NAME SPLITTING TESTS ===\n');

// Test cases: [email, expectedFirstName, description]
const tests = [
  // Should SPLIT into first + last
  ['kategymer@owlbookkeeper.com', 'Kate Gymer', 'The original problem case'],
  ['jamessmith@gmail.com', 'James Smith', 'Classic first+last concatenation'],
  ['sarahjones@company.co.uk', 'Sarah Jones', 'Common female + surname'],
  ['christopherbrown@firm.com', 'Christopher Brown', 'Long first name + surname'],
  ['michaelclark@business.com', 'Michael Clark', 'Another common combo'],
  ['emmawright@domain.com', 'Emma Wright', 'Short first + surname'],
  ['davidwilson@example.co.uk', 'David Wilson', 'Common UK names'],
  ['alexanderhill@co.com', 'Alexander Hill', 'Long first name'],

  // Should NOT split - known first names used as usernames
  ['rosemary@garden.co.uk', 'Rosemary', 'Rosemary is a real first name, not Rose Mary'],
  ['martin@business.co.uk', 'Martin', 'Martin is a first name, not split'],
  ['peter@bevan.co.uk', 'Peter', 'Simple first name'],
  ['chris@norburyfarm.com', 'Chris', 'Short first name'],
  ['liz@lizkaymortgages.co.uk', 'Liz', 'Short first name'],
  ['derek@4mation-architecture.com', 'Derek', 'First name with separator in domain'],

  // Should NOT split - surnames that happen to start with a first name
  ['markham@company.com', 'Markham', 'Markham is a surname (ham < 4 chars)'],
  ['donaldson@firm.co.uk', 'Donaldson', 'Donaldson (son < 4 chars)'],
  ['robertson@group.com', 'Robertson', 'Robertson (son < 4 chars)'],
  ['williamson@co.uk', 'Williamson', 'Williamson (son < 4 chars)'],

  // Should return null - generic/business emails
  ['info@company.com', null, 'Generic: info@'],
  ['reception@dental.co.uk', null, 'Generic: reception@'],
  ['hello@business.com', null, 'Generic: hello@'],
  ['marketing@firm.co.uk', null, 'Generic: marketing@'],

  // Should return null - location/business words
  ['bramhall@edshair.co.uk', null, 'Location word: bramhall'],
  ['manchester@lmm-ltd.co.uk', null, 'Location word: manchester'],
  ['accounting@firm.com', null, 'Business word: accounting'],

  // Should handle separators normally (existing behavior)
  ['anna.wickham@castletree.co.uk', 'Anna Wickham', 'Dot-separated: works as before'],
  ['warren.lessells@ems-it.co.uk', 'Warren Lessells', 'Dot-separated: works as before'],
  ['carolyn.taylor@abcmortgages.net', 'Carolyn Taylor', 'Dot-separated: works as before'],
];

let passed = 0;
let failed = 0;

for (const [email, expected, description] of tests) {
  const result = extractNameFromEmail(email);
  const ok = result === expected;
  const marker = ok ? 'OK  ' : 'FAIL';

  if (!ok) {
    console.log(`${marker}  ${email.padEnd(45)} expected="${expected}" got="${result}"`);
    console.log(`      ${description}`);
    failed++;
  } else {
    console.log(`${marker}  ${email.padEnd(45)} → ${(result || '(null)').padEnd(20)} ${description}`);
    passed++;
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${tests.length} tests`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (failed > 0) {
  console.log('\nSOME TESTS FAILED!\n');
  process.exit(1);
} else {
  console.log('\nALL TESTS PASSED!\n');
}
