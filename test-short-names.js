const { getShortNameForTeam } = require('./shared/outreach-core/content-generation/company-name-humanizer');

console.log('\n=== SHORT NAME FOR TEAM TEST ===\n');

const testCases = [
  { input: "Montgomery's Artisan Butchers", expected: "Montgomery's" },
  { input: "Paul Granelli Jewellers", expected: "Paul Granelli" },
  { input: "Glo Tanning Bramhall", expected: "Glo Tanning" },
  { input: "KissDental Bramhall", expected: "KissDental" },
  { input: "The Coffee Shop", expected: "Coffee Shop" },
  { input: "Elite Fitness", expected: "Elite Fitness" }, // "Fitness" is business type
  { input: "Main Street Cafe", expected: "Main Street Cafe" }, // "Cafe" is business type
  { input: "Bramhall Pilates", expected: "Bramhall Pilates" }, // "Pilates" is business type
  { input: "Village Hairdresser", expected: "Village Hairdresser" }, // Single descriptor
  { input: "Total Fitness Wilmslow", expected: "Total Fitness" }, // Strip location
  { input: "Life Leisure Bramhall", expected: "Life Leisure" }, // Strip location
  { input: "Business Protect", expected: "Business Protect" },
  { input: "CRO Corporate Services Limited", expected: "CRO" }, // Strip legal suffix
];

console.log('Testing short name generation:\n');

let passed = 0;
let failed = 0;

testCases.forEach((test, i) => {
  const result = getShortNameForTeam(test.input);
  const success = result === test.expected;

  console.log(`${i + 1}. "${test.input}"`);
  console.log(`   → Short: "${result}"`);
  if (success) {
    console.log(`   ✅ PASS (expected: "${test.expected}")`);
    passed++;
  } else {
    console.log(`   ❌ FAIL (expected: "${test.expected}", got: "${result}")`);
    failed++;
  }
  console.log('');
});

console.log(`\n${'='.repeat(60)}`);
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(60)}\n`);

// Show email examples
console.log('Email Greeting Examples:\n');

const examples = [
  "Montgomery's Artisan Butchers",
  "Paul Granelli Jewellers",
  "Glo Tanning Bramhall"
];

examples.forEach(name => {
  const short = getShortNameForTeam(name);
  console.log(`Original: "${name}"`);
  console.log(`Greeting: "Hi ${short} Team,"`);
  console.log('');
});
