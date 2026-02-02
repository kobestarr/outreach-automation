/**
 * API Integration Test Script
 * Tests each API individually to verify endpoints and functionality
 */

const { getCredential, checkDailyLimit } = require("./shared/outreach-core/credentials-loader");

console.log("🧪 Testing API Integrations\n");
console.log("=" .repeat(50));

// Test 1: Credentials Loader
console.log("\n1. Testing Credentials Loader...");
try {
  const openaiKey = getCredential("openai", "apiKey");
  console.log("   ✅ OpenAI key loaded:", openaiKey ? "Yes" : "No");
  
  const reoonKey = getCredential("reoon", "apiKey");
  console.log("   ✅ Reoon key loaded:", reoonKey ? "Yes" : "No");
  
  const icypeasKey = getCredential("icypeas", "apiKey");
  console.log("   ✅ Icypeas key loaded:", icypeasKey ? "Yes" : "No");
  
  const hasdataKey = getCredential("hasdata", "apiKey");
  console.log("   ✅ HasData key loaded:", hasdataKey ? "Yes" : "No");
  
  const companiesHouseKey = getCredential("companiesHouse", "apiKey");
  console.log("   ✅ Companies House key loaded:", companiesHouseKey ? "Yes" : "No");
} catch (error) {
  console.log("   ❌ Error:", error.message);
}

// Test 2: Usage Tracking
console.log("\n2. Testing Usage Tracking...");
try {
  const reoonLimit = checkDailyLimit("reoon");
  console.log("   ✅ Reoon limit check:", JSON.stringify(reoonLimit, null, 2));
  
  const icypeasLimit = checkDailyLimit("icypeas");
  console.log("   ✅ Icypeas limit check:", JSON.stringify(icypeasLimit, null, 2));
} catch (error) {
  console.log("   ❌ Error:", error.message);
}

// Test 3: Companies House (Free API - safe to test)
console.log("\n3. Testing Companies House API...");
async function testCompaniesHouse() {
  try {
    const { getOwnerName } = require("./ksd/local-outreach/orchestrator/modules/companies-house");
    
    // Test with a known UK business
    console.log("   Testing lookup for: Smith Dental Practice in Bramhall");
    const result = await getOwnerName("Smith Dental Practice", "SK7");
    
    if (result) {
      console.log("   ✅ Found owner:", result.fullName);
      console.log("   Details:", JSON.stringify(result, null, 2));
    } else {
      console.log("   ⚠️  No owner found (might not exist in Companies House)");
    }
  } catch (error) {
    console.log("   ❌ Error:", error.message);
    console.log("   Stack:", error.stack.split("\n")[0]);
  }
}

// Test 4: Email Pattern Generation (No API - safe)
console.log("\n4. Testing Email Pattern Generation...");
try {
  const { generateEmailPatterns } = require("./shared/outreach-core/email-discovery/pattern-generator");
  const patterns = generateEmailPatterns({
    firstName: "John",
    lastName: "Smith",
    domain: "example.com"
  });
  console.log("   ✅ Generated", patterns.length, "patterns");
  console.log("   Sample:", patterns.slice(0, 3).join(", "));
} catch (error) {
  console.log("   ❌ Error:", error.message);
}

// Test 5: Chain Filter (No API - safe)
console.log("\n5. Testing Chain Filter...");
try {
  const { filterChains } = require("./ksd/local-outreach/orchestrator/modules/chain-filter");
  const testBusinesses = [
    { name: "Costa Coffee", reviewCount: 500 },
    { name: "Local Cafe", reviewCount: 50 },
    { name: "Starbucks", reviewCount: 2000 }
  ];
  const filtered = filterChains(testBusinesses);
  console.log("   ✅ Filtered", testBusinesses.length, "→", filtered.length, "businesses");
  console.log("   Removed:", testBusinesses.length - filtered.length, "chains");
} catch (error) {
  console.log("   ❌ Error:", error.message);
}

// Test 6: Tier Assignment (No API - safe)
console.log("\n6. Testing Tier Assignment...");
try {
  const { assignTier } = require("./ksd/local-outreach/orchestrator/modules/tier-assigner");
  const revenues = [50000, 200000, 500000, 1000000];
  revenues.forEach(rev => {
    const tier = assignTier(rev);
    console.log("   £" + rev.toLocaleString() + " →", tier.tierName);
  });
  console.log("   ✅ Tier assignment working");
} catch (error) {
  console.log("   ❌ Error:", error.message);
}

// Run async tests
(async () => {
  await testCompaniesHouse();
  
  console.log("\n" + "=".repeat(50));
  console.log("\n✅ Basic tests complete!");
  console.log("\n⚠️  Next: Test paid APIs (will use credits):");
  console.log("   - Icypeas (email finding)");
  console.log("   - Reoon (email verification)");
  console.log("   - GPT-4 (email generation)");
  console.log("   - HasData (Google Maps scraper)");
})();
