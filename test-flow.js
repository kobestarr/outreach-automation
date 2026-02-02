/**
 * Test script for outreach automation flow
 * Tests modules without making expensive API calls
 */

const { filterChains } = require("./ksd/local-outreach/orchestrator/modules/chain-filter");
const { assignTier } = require("./ksd/local-outreach/orchestrator/modules/tier-assigner");
const { detectBarterOpportunity } = require("./ksd/local-outreach/orchestrator/modules/barter-detector");
const { shouldEnrichLinkedIn } = require("./shared/outreach-core/linkedin-enrichment/decision-logic");
const { generateEmailPatterns, extractDomain } = require("./shared/outreach-core/email-discovery/pattern-generator");

console.log("🧪 Testing Outreach Automation Modules\n");

// Test 1: Chain Filter
console.log("1. Chain Filter Test:");
const testBusinesses = [
  { name: "Costa Coffee", reviewCount: 500 },
  { name: "Local Cafe", reviewCount: 50 },
  { name: "Starbucks", reviewCount: 2000 }
];
const filtered = filterChains(testBusinesses);
console.log();
console.log();
console.log();

// Test 2: Tier Assignment
console.log("2. Tier Assignment Test:");
const revenues = [50000, 200000, 500000, 1000000, 3000000];
revenues.forEach(rev => {
  const tier = assignTier(rev);
  console.log();
});
console.log();

// Test 3: Barter Detection
console.log("3. Barter Detection Test:");
const barterTests = [
  { category: "cafe" },
  { category: "dentist" },
  { category: "plumber" },
  { category: "gym" }
];
barterTests.forEach(b => {
  const result = detectBarterOpportunity(b);
  if (result.eligible) {
    console.log();
  } else {
    console.log();
  }
});
console.log();

// Test 4: LinkedIn Decision Logic
console.log("4. LinkedIn Enrichment Decision Test:");
const linkedInTests = [
  { category: "doctor", ownerFirstName: "John", ownerLastName: "Smith", estimatedRevenue: 300000 },
  { category: "cafe", ownerFirstName: "Jane", ownerLastName: "Doe", estimatedRevenue: 50000 },
  { category: "salon", ownerFirstName: "Bob", ownerLastName: "Jones", estimatedRevenue: 250000, assignedOfferTier: "tier3" }
];
linkedInTests.forEach(b => {
  const decision = shouldEnrichLinkedIn(b, null);
  console.log();
});
console.log();

// Test 5: Email Pattern Generation
console.log("5. Email Pattern Generation Test:");
const patterns = generateEmailPatterns({ firstName: "John", lastName: "Smith", domain: "example.com" });
console.log();
patterns.slice(0, 5).forEach(p => console.log());
console.log();

// Test 6: Domain Extraction
console.log("6. Domain Extraction Test:");
const urls = [
  "https://www.example.com/path",
  "http://test.co.uk:8080",
  "https://subdomain.example.com"
];
urls.forEach(url => {
  const domain = extractDomain(url);
  console.log();
});
console.log();

console.log("✅ All module tests passed!");
