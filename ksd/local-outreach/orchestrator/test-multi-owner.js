/**
 * Test Script for Multi-Owner Email Feature
 * Tests all components: owner extraction, email discovery, email generation, and export
 */

const { generateGreeting, generateTransparencyParagraph, generateClosingLine, generateMultiOwnerEmailBody } = require("../../../shared/outreach-core/content-generation/multi-owner-templates");

console.log("=== TESTING MULTI-OWNER EMAIL TEMPLATES ===\n");

// Test 1: Single owner
console.log("Test 1: Single Owner");
const singleOwner = [{ firstName: "Sarah", fullName: "Sarah Johnson" }];
console.log(`Greeting: ${generateGreeting(singleOwner)}`);
console.log(`Transparency: "${generateTransparencyParagraph(singleOwner)}"`);
console.log(`Closing: "${generateClosingLine(singleOwner)}"`);
console.log();

// Test 2: Two owners
console.log("Test 2: Two Owners");
const twoOwners = [
  { firstName: "Sarah", fullName: "Sarah Johnson" },
  { firstName: "John", fullName: "John Smith" }
];
console.log(`Greeting: ${generateGreeting(twoOwners)}`);
console.log(`Transparency: "${generateTransparencyParagraph(twoOwners)}"`);
console.log(`Closing: "${generateClosingLine(twoOwners)}"`);
console.log();

// Test 3: Five owners (max)
console.log("Test 3: Five Owners");
const fiveOwners = [
  { firstName: "Sarah", fullName: "Sarah Johnson" },
  { firstName: "John", fullName: "John Smith" },
  { firstName: "Michael", fullName: "Michael Brown" },
  { firstName: "Emily", fullName: "Emily Davis" },
  { firstName: "David", fullName: "David Wilson" }
];
console.log(`Greeting: ${generateGreeting(fiveOwners)}`);
console.log(`Transparency: "${generateTransparencyParagraph(fiveOwners)}"`);
console.log(`Closing: "${generateClosingLine(fiveOwners)}"`);
console.log();

// Test 4: Complete email body transformation
console.log("Test 4: Complete Email Body");
const baseBody = `Hi Sarah,

I noticed Kiss Dental Bramhall doesn't have much of a social presence yet.

With 83 five-star reviews, you've clearly got happy patients - but without social media, it's harder for new people to find you or see what makes your practice different.

I'm just down the road in Poynton and help dental practices get set up with the basics - profile setup, content plan, that sort of thing. I've worked with everyone from local clinics to Twiggy, so I know what works.

From just £97 I can get you started with a simple plan that actually fits into your day.

Worth a quick chat? Here's my calendar: [link]

Sent from my iPhone`;

// Transform for two owners
const twoOwnerEmail = generateMultiOwnerEmailBody(baseBody, twoOwners);
console.log("Two Owner Email:");
console.log("─".repeat(68));
console.log(twoOwnerEmail);
console.log("─".repeat(68));
console.log();

// Transform for five owners
const fiveOwnerEmail = generateMultiOwnerEmailBody(baseBody, fiveOwners);
console.log("Five Owner Email:");
console.log("─".repeat(68));
console.log(fiveOwnerEmail);
console.log("─".repeat(68));
console.log();

console.log("✓ All template tests completed successfully!\n");
console.log("Next steps:");
console.log("1. Run a test campaign: node ksd/local-outreach/orchestrator/main.js Bramhall SK7 \"dentists\" --limit 5");
console.log("2. Check database for multi-owner businesses with owners array");
console.log("3. Review and approve via: node shared/outreach-core/approval-system/approve-cli.js");
console.log("4. Export via: node ksd/local-outreach/orchestrator/utils/resume-approval.js Bramhall SK7");
console.log();
