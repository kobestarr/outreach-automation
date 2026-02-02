const { scrapeGoogleMaps } = require("./modules/google-maps-scraper");
const { filterChains } = require("./modules/chain-filter");
const { getOwnerName } = require("./modules/companies-house");
const { discoverEmail } = require("../../../shared/outreach-core/email-discovery");
const { enrichLinkedIn } = require("../../../shared/outreach-core/linkedin-enrichment");
const { estimateRevenue } = require("./modules/revenue-estimator");
const { assignTier } = require("./modules/tier-assigner");
const { detectBarterOpportunity } = require("./modules/barter-detector");
const { generateOutreachContent } = require("../../../shared/outreach-core/content-generation");
const { needsApproval, addToApprovalQueue, loadApprovedTemplates } = require("../../../shared/outreach-core/approval-system/approval-manager");
const { exportToLemlist } = require("../../../shared/outreach-core/export-managers/lemlist-exporter");
const { exportToProsp } = require("../../../shared/outreach-core/export-managers/prosp-exporter");
const { saveBusiness, updateBusiness, loadBusinesses } = require("./modules/database");

/**
 * Main enrichment function
 */
async function enrichBusiness(business) {
  const enriched = { ...business };
  
  // Step 1: Get owner name from Companies House
  if (!enriched.ownerFirstName) {
    const owner = await getOwnerName(business.name, business.postcode);
    if (owner) {
      enriched.ownerFirstName = owner.firstName;
      enriched.ownerLastName = owner.lastName;
      enriched.ownerFullName = owner.fullName;
    }
  }
  
  // Step 2: Discover email
  if (!enriched.ownerEmail && enriched.ownerFirstName) {
    const emailResult = await discoverEmail({
      firstName: enriched.ownerFirstName,
      lastName: enriched.ownerLastName,
      domain: business.website ? new URL(business.website).hostname.replace("www.", "") : null,
      website: business.website,
      emailsFromWebsite: business.emailsFromWebsite || [],
      useIcypeas: true
    });
    
    if (emailResult.email) {
      enriched.ownerEmail = emailResult.email;
      enriched.emailSource = emailResult.source;
      enriched.emailVerified = emailResult.verified;
    }
  }
  
  // Step 3: LinkedIn enrichment (conditional)
  if (enriched.ownerFirstName) {
    const linkedInResult = await enrichLinkedIn(enriched);
    if (linkedInResult.enriched) {
      enriched.linkedInUrl = linkedInResult.linkedInUrl;
      enriched.linkedInData = linkedInResult.linkedInData;
    }
  }
  
  // Step 4: Revenue estimation
  const revenueEstimate = await estimateRevenue(enriched);
  enriched.estimatedRevenue = revenueEstimate.estimatedRevenue;
  enriched.revenueBand = revenueEstimate.revenueBand;
  enriched.revenueConfidence = revenueEstimate.confidence;
  
  // Step 5: Tier assignment
  const tier = assignTier(enriched.estimatedRevenue);
  enriched.assignedOfferTier = tier.tierId;
  enriched.setupFee = tier.setupFee;
  enriched.monthlyPrice = tier.monthlyPrice;
  enriched.ghlOffer = tier.ghlOffer;
  enriched.leadMagnet = tier.leadMagnet;
  
  // Step 6: Barter detection
  const barter = detectBarterOpportunity(enriched);
  enriched.barterOpportunity = barter;
  
  return enriched;
}

/**
 * Process businesses from Google Maps
 * @param {string} location - Location name (e.g., "Bramhall")
 * @param {string} postcode - Postcode prefix (e.g., "SK7") to ensure correct location
 * @param {Array<string>} businessTypes - Business type keywords (e.g., ["restaurants", "cafes"])
 * @param {boolean} extractEmails - Whether to extract emails via HasData (default: true)
 * @returns {Promise<Array>} Array of enriched businesses
 */
async function processBusinesses(location, postcode, businessTypes = [], extractEmails = true) {
  const scrapedAt = new Date().toISOString();
  
  // Step 1: Scrape Google Maps (with postcode for accuracy)
  console.log(`Scraping businesses in ${location}${postcode ? ` (${postcode})` : ""}...`);
  const businesses = await scrapeGoogleMaps(location, postcode, businessTypes, extractEmails);
  console.log(`Found ${businesses.length} businesses`);
  
  // Step 2: Filter chains
  const filteredBusinesses = filterChains(businesses);
  console.log(`After filtering chains: ${filteredBusinesses.length} businesses`);
  
  // Step 3: Enrich each business
  const enrichedBusinesses = [];
  
  for (const business of filteredBusinesses) {
    try {
      const enriched = await enrichBusiness(business);
      enrichedBusinesses.push(enriched);
      
      // Save enriched business to storage
      try {
        saveBusiness(enriched, {
          scrapedAt: scrapedAt,
          enrichedAt: new Date().toISOString(),
          location: location,
          postcode: postcode,
          status: "enriched"
        });
      } catch (saveError) {
        console.error("Error saving " + (enriched.name || enriched.businessName || "business") + ":", saveError.message);
        // Continue processing even if save fails
      }
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error("Error enriching " + business.name + ":", error.message);
    }
  }
  
  return enrichedBusinesses;
}

/**
 * Generate content and export
 */
async function generateAndExport(enrichedBusinesses, config = {}) {
  const approvedTemplates = loadApprovedTemplates();
  const exported = [];
  
  for (const business of enrichedBusinesses) {
    try {
      // Generate content
      const content = await generateOutreachContent(business, {
        generateEmail: true,
        generateLinkedIn: !!business.linkedInUrl,
        emailSequence: true
      });
      
      // Check if approval needed
      if (needsApproval(business, approvedTemplates)) {
        addToApprovalQueue(business, content.email || content.emailSequence[0]);
        console.log("Added " + business.category + " email to approval queue");
        continue; // Skip export until approved
      }
      
      const exportedTo = [];
      
      // Export to Lemlist
      if (business.ownerEmail && config.lemlistCampaignId) {
        await exportToLemlist(business, config.lemlistCampaignId, content.emailSequence);
        exportedTo.push("lemlist");
      }
      
      // Export to Prosp
      if (business.linkedInUrl && config.exportLinkedIn) {
        await exportToProsp(business, content.linkedIn);
        exportedTo.push("prosp");
      }
      
      // Update business record with export status
      if (exportedTo.length > 0) {
        const { generateBusinessId } = require("./modules/database");
        const businessId = generateBusinessId(business);
        updateBusiness(businessId, {
          status: "exported",
          exportedTo: exportedTo,
          exportedAt: new Date().toISOString()
        });
      }
      
      exported.push({
        business: business.name,
        email: business.ownerEmail,
        linkedIn: business.linkedInUrl,
        tier: business.assignedOfferTier
      });
    } catch (error) {
      console.error("Error exporting " + business.name + ":", error.message);
    }
  }
  
  return exported;
}

/**
 * Validate location string
 * @param {string} location - Location name to validate
 * @returns {boolean} True if valid
 */
function isValidLocation(location) {
  if (!location || typeof location !== "string") return false;
  // Allow alphanumeric, spaces, hyphens, apostrophes (for places like "Bishop's Stortford")
  const locationPattern = /^[a-zA-Z0-9\s\-']+$/;
  return locationPattern.test(location) && location.length >= 2 && location.length <= 100;
}

/**
 * Validate UK postcode prefix
 * @param {string} postcode - Postcode to validate
 * @returns {boolean} True if valid UK postcode format
 */
function isValidPostcode(postcode) {
  if (!postcode || typeof postcode !== "string") return false;
  // UK postcode prefix pattern (e.g., SK7, M1, SW1A, EC1A)
  const postcodePattern = /^[A-Z]{1,2}[0-9][0-9A-Z]?$/i;
  return postcodePattern.test(postcode.trim());
}

/**
 * Sanitize business types input
 * @param {string} input - Comma-separated business types
 * @returns {Array<string>} Sanitized array of business types
 */
function sanitizeBusinessTypes(input) {
  if (!input || typeof input !== "string") return [];
  return input
    .split(",")
    .map(type => type.trim().toLowerCase())
    .filter(type => type.length > 0 && type.length <= 50 && /^[a-zA-Z0-9\s\-]+$/.test(type));
}

/**
 * Print usage information
 */
function printUsage() {
  console.log(`
Usage: node main.js [location] [postcode] [businessTypes] [options]

Arguments:
  location       Location name (e.g., "Bramhall", "Manchester")
  postcode       UK postcode prefix (e.g., "SK7", "M1")
  businessTypes  Comma-separated list (e.g., "restaurants,cafes")

Options:
  --no-emails    Skip email extraction from websites
  --load         Load existing businesses instead of scraping
  --help         Show this help message

Examples:
  node main.js Bramhall SK7
  node main.js "Manchester" M1 "restaurants,bars" --no-emails
  node main.js --load Bramhall SK7
`);
}

// Main execution (if run directly)
if (require.main === module) {
  // Parse command line arguments
  const args = process.argv.slice(2);

  // Check for help flag
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  let location = "Bramhall";
  let postcode = "SK7";
  let businessTypes = [];
  let extractEmails = true;
  let loadExisting = false;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--no-email-extraction" || arg === "--no-emails") {
      extractEmails = false;
    } else if (arg === "--load-existing" || arg === "--load") {
      loadExisting = true;
      if (args[i + 1] && !args[i + 1].startsWith("--")) location = args[i + 1];
      if (args[i + 2] && !args[i + 2].startsWith("--")) postcode = args[i + 2];
      break;
    } else if (i === 0 && !arg.startsWith("--")) {
      location = arg;
    } else if (i === 1 && !arg.startsWith("--")) {
      postcode = arg;
    } else if (i === 2 && !arg.startsWith("--")) {
      businessTypes = sanitizeBusinessTypes(arg);
    }
  }

  // Validate inputs
  if (!isValidLocation(location)) {
    console.error(`Error: Invalid location "${location}". Must be 2-100 alphanumeric characters.`);
    process.exit(1);
  }

  if (!isValidPostcode(postcode)) {
    console.error(`Error: Invalid postcode "${postcode}". Must be a valid UK postcode prefix (e.g., SK7, M1, SW1A).`);
    process.exit(1);
  }

  console.log(`Starting outreach automation for ${location} (${postcode})`);
  console.log(`Business types: ${businessTypes.length > 0 ? businessTypes.join(", ") : "All"}`);
  console.log(`Email extraction: ${extractEmails ? "enabled" : "disabled"}`);
  console.log("");
  
  let businessesPromise;
  
  if (loadExisting) {
    // Load existing businesses from storage
    console.log(`Loading existing businesses for ${location} (${postcode})...`);
    const existingBusinesses = loadBusinesses({ location, postcode });
    console.log(`Found ${existingBusinesses.length} existing businesses`);
    businessesPromise = Promise.resolve(existingBusinesses.map(record => record.business));
  } else {
    // Scrape and enrich new businesses
    businessesPromise = processBusinesses(location, postcode, businessTypes, extractEmails);
  }
  
  businessesPromise
    .then(businesses => {
      console.log(`\n✅ ${loadExisting ? "Loaded" : "Enriched"} ${businesses.length} businesses`);
      return generateAndExport(businesses, {
        lemlistCampaignId: process.env.LEMLIST_CAMPAIGN_ID,
        exportLinkedIn: true
      });
    })
    .then(exported => {
      console.log(`\n✅ Exported ${exported.length} businesses`);
      console.log("\nExported businesses:");
      exported.forEach(e => {
        console.log(`  - ${e.business} (${e.tier})`);
      });
    })
    .catch(error => {
      console.error("\n❌ Error:", error);
      process.exit(1);
    });
}

module.exports = {
  processBusinesses,
  enrichBusiness,
  generateAndExport
};
