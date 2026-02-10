/**
 * Email Template Comparison
 * Shows original vs. fixed template with real merge variable output
 */

const { getAllMergeVariables } = require('../shared/outreach-core/content-generation/email-merge-variables');

// Sample business data (from Bramhall integration test)
const sampleBusinesses = [
  {
    // Example 1: Nearby salon with known owner
    name: "Francesco Hair Salon",
    businessName: "Francesco Hair Salon",
    postcode: "SK7 1AL",
    location: "Bramhall, Stockport",
    category: "Hair Salon",
    ownerFirstName: "Sarah",
    ownerLastName: "Johnson",
    assignedOfferTier: "tier2",
    rating: 4.8,
    reviewCount: 89,
    owners: [{ firstName: "Sarah", fullName: "Sarah Johnson", email: "sarah@francescohair.salon" }]
  },
  {
    // Example 2: Multiple owners
    name: "Bramhall Dental Practice",
    businessName: "Bramhall Dental Practice",
    postcode: "SK7 2NA",
    location: "Bramhall, Stockport",
    category: "Dentist",
    ownerFirstName: "Dr. Smith",
    ownerLastName: "Smith",
    assignedOfferTier: "tier1",
    rating: 4.2,
    reviewCount: 15,
    owners: [
      { firstName: "Dr. Smith", fullName: "Dr. John Smith", email: "j.smith@bramhalldental.co.uk" },
      { firstName: "Dr. Jones", fullName: "Dr. Emma Jones", email: "e.jones@bramhalldental.co.uk" }
    ]
  },
  {
    // Example 3: No owner name found
    name: "Village Coffee Shop",
    businessName: "Village Coffee Shop",
    postcode: "SK7 1AZ",
    location: "Bramhall, Stockport",
    category: "Cafe",
    ownerFirstName: "there", // Fallback
    ownerLastName: "",
    usedFallbackName: true,
    assignedOfferTier: "tier5",
    rating: 4.5,
    reviewCount: 42,
    website: null,
    owners: []
  }
];

function renderTemplate(template, variables) {
  let rendered = template;

  // Replace all merge variables
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    rendered = rendered.replace(regex, value || '');
  }

  return rendered;
}

console.log('\n╔════════════════════════════════════════════════════════════════════╗');
console.log('║           EMAIL TEMPLATE COMPARISON                                ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');

// Original template (user's current version)
const originalTemplate = `Hi {{firstName}},

{{multiOwnerNote}}{{localIntro}} I noticed {{companyName}} and {{observationSignal}}.

I help with things like keeping clients coming back, managing bookings, and getting your online presence sorted. I've worked with some interesting clients over the years (including Twiggy, yes the 60s fashion icon!), but I keep my prices pretty reasonable because I don't have the agency overheads.

From just {{microOfferPrice}} to get started – happy to {{meetingOption}} or I can share links to my work and we can have a chat on the phone.

Just reply to this email if you're interested.

Cheers,
Kobi

Sent from my iPhone`;

// Fixed template (recommended version)
const fixedTemplate = `Hi {{firstName}},

{{multiOwnerNote}}{{noNameNote}}{{localIntro}}

I {{observationSignal}} at {{companyName}} and thought I'd reach out.

I help with things like keeping clients coming back, managing bookings, and getting your online presence sorted. I've worked with some interesting clients over the years (including Twiggy, yes the 60s fashion icon!), but I keep my prices pretty reasonable because I don't have the agency overheads.

From just {{microOfferPrice}} to get started – happy to {{meetingOption}} or I can share links to my work and we can have a chat on the phone.

Just reply to this email if you're interested.

Cheers,
Kobi

Sent from my iPhone`;

// Process each example
for (let i = 0; i < sampleBusinesses.length; i++) {
  const business = sampleBusinesses[i];
  const variables = getAllMergeVariables(business);

  console.log(`${'='.repeat(70)}`);
  console.log(`EXAMPLE ${i + 1}: ${business.name}`);
  console.log(`${'='.repeat(70)}\n`);

  console.log(`📊 Business Data:`);
  console.log(`   - Owner: ${business.ownerFirstName} ${business.ownerLastName}`);
  console.log(`   - Location: ${business.postcode}`);
  console.log(`   - Tier: ${business.assignedOfferTier}`);
  console.log(`   - Multiple owners: ${business.owners.length > 1 ? 'Yes' : 'No'}`);
  console.log(`   - Used fallback name: ${business.usedFallbackName ? 'Yes' : 'No'}\n`);

  // Render original
  console.log(`━━━ ORIGINAL TEMPLATE OUTPUT ━━━\n`);
  const originalOutput = renderTemplate(originalTemplate, variables);
  console.log(originalOutput);
  console.log();

  // Highlight issues
  console.log(`⚠️  ISSUES IN ORIGINAL:`);
  if (variables.multiOwnerNote) {
    console.log(`   - Two "I" sentences back-to-back (choppy flow)`);
  }
  console.log(`   - Grammar error: "I noticed X and saw Y" is incorrect`);
  if (business.usedFallbackName) {
    console.log(`   - Missing explanation for why no name (no {{noNameNote}})`);
  }
  console.log();

  // Render fixed
  console.log(`━━━ FIXED TEMPLATE OUTPUT ━━━\n`);
  const fixedOutput = renderTemplate(fixedTemplate, variables);
  console.log(fixedOutput);
  console.log();

  // Highlight improvements
  console.log(`✅ IMPROVEMENTS IN FIXED:`);
  if (variables.multiOwnerNote) {
    console.log(`   - Smooth flow: multi-owner note flows into intro`);
  }
  console.log(`   - Clean grammar: "I saw X at Y and thought I'd reach out"`);
  if (business.usedFallbackName) {
    console.log(`   - Transparency: explains why no name was found`);
  }
  console.log(`   - Natural reading: flows like a real conversation`);
  console.log('\n\n');
}

console.log('╔════════════════════════════════════════════════════════════════════╗');
console.log('║                    COMPARISON COMPLETE                             ║');
console.log('║                                                                    ║');
console.log('║  Recommendation: Use the FIXED template for better grammar and     ║');
console.log('║  natural flow. Update your Lemlist sequence accordingly.           ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');
