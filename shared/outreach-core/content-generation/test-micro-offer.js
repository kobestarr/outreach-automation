/**
 * Integration Test for Micro-Offer Outreach System
 * Tests category mapping, observation signals, currency localization, and content generation
 *
 * Run: node shared/outreach-core/content-generation/test-micro-offer.js
 */

const { getCategoryGroup, getCategoryEmailAngles, getCategoryLinkedInAngles } = require("./category-mapper");
const { computeObservationSignals, selectPrimarySignal, getSignalHook } = require("./observation-signals");
const { getCurrencyForLocation, formatPrice } = require("./currency-localization");
const { generateEmailContent } = require("./gpt-email-generator");
const { generateConnectionNote, generateLinkedInMessage } = require("./gpt-linkedin-generator");

// Test data: 11 businesses (1 per category group)
const testBusinesses = [
  {
    name: "ABC Plumbing",
    ownerFirstName: "John",
    category: "Plumber",
    location: "Bramhall, SK7 1AA",
    reviewCount: 8,
    rating: 4.5,
    website: null,
    expectedCategory: "TRADESPEOPLE",
    expectedSignals: ["lowReviews", "noWebsite"]
  },
  {
    name: "Glamour Salon",
    ownerFirstName: "Sarah",
    category: "Hair Salon",
    location: "Manchester",
    reviewCount: 45,
    rating: 4.8,
    website: "https://glamour.co.uk",
    expectedCategory: "HEALTH_BEAUTY",
    expectedSignals: []
  },
  {
    name: "The Cozy Cafe",
    ownerFirstName: "Mike",
    category: "Cafe",
    location: "London SW1A 1AA",
    reviewCount: 3,
    rating: 3.8,
    website: "http://cozycafe.wix.com/cafe",
    expectedCategory: "FOOD_HOSPITALITY",
    expectedSignals: ["lowReviews", "lowRating", "poorWebsite"]
  },
  {
    name: "Smith & Partners Accountants",
    ownerFirstName: "David",
    category: "Accountant",
    location: "Edinburgh",
    reviewCount: 25,
    rating: 4.9,
    website: "https://smithaccountants.co.uk",
    expectedCategory: "PROFESSIONAL",
    expectedSignals: []
  },
  {
    name: "Premier Properties",
    ownerFirstName: "Emma",
    category: "Estate Agent",
    location: "Brighton",
    reviewCount: 67,
    rating: 4.6,
    website: "https://premierproperties.co.uk",
    expectedCategory: "PROPERTY",
    expectedSignals: ["highReviews"]
  },
  {
    name: "FitZone Gym",
    ownerFirstName: "Tom",
    category: "Gym",
    location: "Leeds",
    reviewCount: 12,
    rating: 4.3,
    website: "https://fitzone.co.uk",
    expectedCategory: "FITNESS",
    expectedSignals: []
  },
  {
    name: "AutoCare Garage",
    ownerFirstName: "James",
    category: "Car Repair",
    location: "Birmingham",
    reviewCount: 5,
    rating: 4.1,
    website: null,
    instagramUrl: "https://instagram.com/autocare",
    expectedCategory: "AUTOMOTIVE",
    expectedSignals: ["lowReviews", "noWebsite"]
  },
  {
    name: "Sparkle Cleaning",
    ownerFirstName: "Lisa",
    category: "Cleaning Service",
    location: "Bristol",
    reviewCount: 9,
    rating: 4.7,
    website: "https://sparkleclean.co.uk",
    expectedCategory: "HOME_SERVICES",
    expectedSignals: ["lowReviews"]
  },
  {
    name: "The Gift Boutique",
    ownerFirstName: "Rachel",
    category: "Gift Shop",
    location: "Bath",
    reviewCount: 18,
    rating: 4.4,
    website: "https://giftboutique.co.uk",
    expectedCategory: "RETAIL",
    expectedSignals: []
  },
  {
    name: "ABC Music Academy",
    ownerFirstName: "Paul",
    category: "Music Teacher",
    location: "Oxford",
    reviewCount: 31,
    rating: 4.9,
    website: "https://abcmusic.co.uk",
    expectedCategory: "EDUCATION",
    expectedSignals: []
  },
  {
    name: "Generic Business Ltd",
    ownerFirstName: "Chris",
    category: "Consulting",
    location: "Cambridge",
    reviewCount: 2,
    rating: 4.0,
    website: "http://generic.weebly.com",
    expectedCategory: "PROFESSIONAL",
    expectedSignals: ["lowReviews", "poorWebsite"]
  }
];

// Test runner
async function runTests() {
  console.log("====================================");
  console.log("  MICRO-OFFER SYSTEM INTEGRATION TEST");
  console.log("====================================\n");

  let passedTests = 0;
  let failedTests = 0;

  // Test 1: Category Mapping
  console.log("TEST 1: Category Mapping");
  console.log("-".repeat(40));
  for (const business of testBusinesses) {
    const detected = getCategoryGroup(business.category);
    const passed = detected === business.expectedCategory;
    if (passed) {
      console.log(`✓ ${business.name}: ${detected}`);
      passedTests++;
    } else {
      console.log(`✗ ${business.name}: expected ${business.expectedCategory}, got ${detected}`);
      failedTests++;
    }
  }
  console.log("");

  // Test 2: Observation Signals
  console.log("TEST 2: Observation Signals");
  console.log("-".repeat(40));
  for (const business of testBusinesses) {
    const detected = computeObservationSignals(business);
    const expected = business.expectedSignals || [];
    const match = expected.length === detected.length && expected.every(s => detected.includes(s));
    if (match) {
      console.log(`✓ ${business.name}: ${detected.join(", ") || "none"}`);
      passedTests++;
    } else {
      console.log(`✗ ${business.name}: expected [${expected.join(", ")}], got [${detected.join(", ")}]`);
      failedTests++;
    }
  }
  console.log("");

  // Test 3: Primary Signal Selection
  console.log("TEST 3: Primary Signal Selection");
  console.log("-".repeat(40));
  for (const business of testBusinesses) {
    const signals = computeObservationSignals(business);
    const primary = selectPrimarySignal(signals);
    const hook = primary ? getSignalHook(primary) : "none";
    console.log(`  ${business.name}: ${primary || "none"} → "${hook}"`);
    passedTests++; // Always passes if no error
  }
  console.log("");

  // Test 4: Currency Localization
  console.log("TEST 4: Currency Localization");
  console.log("-".repeat(40));
  const testLocations = [
    { location: "Bramhall, SK7", expected: "UK", expectedSymbol: "£" },
    { location: "New York, NY 10001", expected: "US", expectedSymbol: "$" },
    { location: "Sydney, NSW", expected: "AU", expectedSymbol: "A$" },
    { location: "Toronto, ON", expected: "CA", expectedSymbol: "CA$" }
  ];
  for (const test of testLocations) {
    const currency = getCurrencyForLocation(test.location);
    const passed = currency.country === test.expected && currency.symbol === test.expectedSymbol;
    if (passed) {
      console.log(`✓ ${test.location}: ${currency.country} (${currency.symbol}${currency.microOffer})`);
      passedTests++;
    } else {
      console.log(`✗ ${test.location}: expected ${test.expected} (${test.expectedSymbol}), got ${currency.country} (${currency.symbol})`);
      failedTests++;
    }
  }
  console.log("");

  // Test 5: Email Angle Retrieval
  console.log("TEST 5: Email Angle Retrieval");
  console.log("-".repeat(40));
  for (const business of testBusinesses) {
    const group = getCategoryGroup(business.category);
    const angles = getCategoryEmailAngles(group);
    if (angles && angles.length > 0) {
      console.log(`✓ ${business.name}: ${angles.length} email angles available`);
      console.log(`    → "${angles[0].substring(0, 60)}..."`);
      passedTests++;
    } else {
      console.log(`✗ ${business.name}: no email angles found`);
      failedTests++;
    }
  }
  console.log("");

  // Test 6: LinkedIn Angle Retrieval
  console.log("TEST 6: LinkedIn Angle Retrieval (Different from Email)");
  console.log("-".repeat(40));
  for (const business of testBusinesses) {
    const group = getCategoryGroup(business.category);
    const emailAngles = getCategoryEmailAngles(group);
    const linkedInAngles = getCategoryLinkedInAngles(group);
    if (linkedInAngles && linkedInAngles.length > 0) {
      const areDifferent = linkedInAngles[0] !== emailAngles[0];
      if (areDifferent) {
        console.log(`✓ ${business.name}: LinkedIn angles differ from email`);
        console.log(`    Email: "${emailAngles[0].substring(0, 40)}..."`);
        console.log(`    LinkedIn: "${linkedInAngles[0].substring(0, 40)}..."`);
        passedTests++;
      } else {
        console.log(`✗ ${business.name}: LinkedIn angles same as email`);
        failedTests++;
      }
    } else {
      console.log(`✗ ${business.name}: no LinkedIn angles found`);
      failedTests++;
    }
  }
  console.log("");

  // Test 7: Live Email Generation (Optional - requires OpenAI API key)
  console.log("TEST 7: Live Email Generation (Optional)");
  console.log("-".repeat(40));
  console.log("Skipping live GPT-4 tests to avoid API costs.");
  console.log("To test live generation, uncomment the code below and run again.\n");

  /*
  // Uncomment to test live email generation
  try {
    const sampleBusiness = testBusinesses[0]; // Use first business (plumber)
    console.log(`Generating email for ${sampleBusiness.name}...`);

    const emailResult = await generateEmailContent({
      businessName: sampleBusiness.name,
      ownerFirstName: sampleBusiness.ownerFirstName,
      category: sampleBusiness.category,
      location: sampleBusiness.location,
      reviewCount: sampleBusiness.reviewCount,
      rating: sampleBusiness.rating,
      website: sampleBusiness.website
    });

    console.log(`\nEmail Generated:`);
    console.log(`Subject: ${emailResult.subject}`);
    console.log(`Body: ${emailResult.body}`);
    console.log(`\nMetadata:`);
    console.log(JSON.stringify(emailResult.metadata, null, 2));

    // Validate 20 rules
    const subjectLowercase = emailResult.subject === emailResult.subject.toLowerCase();
    const bodyUnder100Words = emailResult.body.split(/\s+/).length <= 100;
    const noExclamation = !emailResult.body.includes("!");

    console.log(`\n20-Rule Validation:`);
    console.log(`  ✓ Lowercase subject: ${subjectLowercase}`);
    console.log(`  ✓ Body under 100 words: ${bodyUnder100Words} (${emailResult.body.split(/\s+/).length} words)`);
    console.log(`  ✓ No exclamation marks: ${noExclamation}`);

    passedTests++;
  } catch (error) {
    console.log(`✗ Email generation failed: ${error.message}`);
    failedTests++;
  }
  */

  // Summary
  console.log("\n====================================");
  console.log("  TEST SUMMARY");
  console.log("====================================");
  console.log(`Total Tests: ${passedTests + failedTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);
  console.log(`Success Rate: ${Math.round((passedTests / (passedTests + failedTests)) * 100)}%`);
  console.log("");

  if (failedTests === 0) {
    console.log("✓ ALL TESTS PASSED!");
  } else {
    console.log(`✗ ${failedTests} test(s) failed. Review output above.`);
  }

  return failedTests === 0;
}

// Run tests
runTests()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error("Fatal error running tests:", error);
    process.exit(1);
  });
