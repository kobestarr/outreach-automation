/**
 * Paid API Test Script
 * Tests APIs that use credits - run individually to verify endpoints
 */

const { getCredential, checkDailyLimit } = require("./shared/outreach-core/credentials-loader");

console.log("💰 Testing Paid APIs (Will Use Credits)\n");
console.log("=".repeat(50));

// Test which API to run (set via command line: node test-paid-apis.js reoon)
const testApi = process.argv[2] || "all";

// Test 1: Reoon Email Verification
async function testReoon() {
  console.log("\n1. Testing Reoon Email Verification...");
  try {
    const { verifyEmail } = require("./shared/outreach-core/email-verification/reoon-verifier");
    
    const limit = checkDailyLimit("reoon");
    console.log("   Credits remaining:", limit.remaining);
    
    if (limit.remaining < 1) {
      console.log("   ⚠️  No credits remaining, skipping test");
      return;
    }
    
    console.log("   Testing verification for: test@example.com");
    const result = await verifyEmail("test@example.com");
    
    console.log("   ✅ Result:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.log("   ❌ Error:", error.message);
    if (error.stack) {
      console.log("   Stack:", error.stack.split("\n").slice(0, 3).join("\n"));
    }
  }
}

// Test 2: Icypeas Email Finding
async function testIcypeas() {
  console.log("\n2. Testing Icypeas Email Finding...");
  try {
    const { findEmail } = require("./shared/outreach-core/email-discovery/icypeas-finder");
    
    const limit = checkDailyLimit("icypeas");
    console.log("   Credits remaining:", limit.remaining);
    
    if (limit.remaining < 1) {
      console.log("   ⚠️  No credits remaining, skipping test");
      return;
    }
    
    console.log("   Testing email find for: John Smith @ example.com");
    const result = await findEmail({
      firstName: "John",
      lastName: "Smith",
      domainOrCompany: "example.com"
    });
    
    console.log("   ✅ Result:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.log("   ❌ Error:", error.message);
    if (error.stack) {
      console.log("   Stack:", error.stack.split("\n").slice(0, 3).join("\n"));
    }
  }
}

// Test 3: GPT-4 Email Generation
async function testGPT4() {
  console.log("\n3. Testing GPT-4 Email Generation...");
  try {
    const { generateEmailContent } = require("./shared/outreach-core/content-generation/gpt-email-generator");
    
    console.log("   Generating email for test business...");
    const result = await generateEmailContent({
      businessName: "Test Cafe",
      ownerFirstName: "John",
      category: "cafe",
      location: "Bramhall",
      reviewCount: 50,
      rating: 4.5,
      offerTier: "tier1"
    });
    
    console.log("   ✅ Subject:", result.subject);
    console.log("   ✅ Body preview:", result.body.substring(0, 100) + "...");
  } catch (error) {
    console.log("   ❌ Error:", error.message);
    if (error.stack) {
      console.log("   Stack:", error.stack.split("\n").slice(0, 3).join("\n"));
    }
  }
}

// Test 4: HasData Google Maps (structure test - may not have real endpoint)
async function testHasData() {
  console.log("\n4. Testing HasData Google Maps Scraper...");
  try {
    const { scrapeGoogleMaps } = require("./ksd/local-outreach/orchestrator/modules/google-maps-scraper");
    
    console.log("   Testing scrape for: Bramhall");
    const result = await scrapeGoogleMaps("Bramhall", []);
    
    console.log("   ✅ Result:", result.length, "businesses found");
    if (result.length > 0) {
      console.log("   Sample:", JSON.stringify(result[0], null, 2));
    }
  } catch (error) {
    console.log("   ❌ Error:", error.message);
    console.log("   ⚠️  This might need endpoint verification from HasData docs");
    if (error.stack) {
      console.log("   Stack:", error.stack.split("\n").slice(0, 3).join("\n"));
    }
  }
}

// Run tests
(async () => {
  if (testApi === "reoon" || testApi === "all") {
    await testReoon();
  }
  
  if (testApi === "icypeas" || testApi === "all") {
    await testIcypeas();
  }
  
  if (testApi === "gpt4" || testApi === "all") {
    await testGPT4();
  }
  
  if (testApi === "hasdata" || testApi === "all") {
    await testHasData();
  }
  
  console.log("\n" + "=".repeat(50));
  console.log("\n✅ Paid API tests complete!");
  console.log("\n💡 Tip: Test individually with:");
  console.log("   node test-paid-apis.js reoon");
  console.log("   node test-paid-apis.js icypeas");
  console.log("   node test-paid-apis.js gpt4");
  console.log("   node test-paid-apis.js hasdata");
})();
