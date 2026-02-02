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
 * Validate input parameters
 * @param {string} location - Location name
 * @param {string} postcode - Postcode prefix
 * @param {Array} businessTypes - Business type keywords
 * @throws {Error} If validation fails
 */
function validateInputs(location, postcode, businessTypes) {
  if (!location || typeof location !== 'string' || location.trim().length === 0) {
    throw new Error('Location must be a non-empty string');
  }
  
  if (postcode && typeof postcode === 'string') {
    const prefix = postcode.split(' ')[0];
    if (!/^[A-Z]{1,2}\d{1,2}[A-Z]?$/i.test(prefix)) {
      throw new Error(`Invalid postcode format: ${postcode}. Expected format: SK7, M1, SW1A, etc.`);
    }
  }
  
  if (businessTypes && !Array.isArray(businessTypes)) {
    throw new Error('businessTypes must be an array');
  }
  
  return true;
}

/**
 * Retry wrapper for async operations
 * @param {Function} operation - Async function to retry
 * @param {number} [maxRetries=3] - Maximum retry attempts
 * @param {number} [delayMs=1000] - Initial delay in milliseconds
 * @returns {Promise} Result of operation
 */
async function retryOperation(operation, maxRetries = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const backoffDelay = delayMs * Math.pow(2, attempt - 1);
      console.warn(`Attempt ${attempt} failed, retrying in ${backoffDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }
  }
}

/**
 * Timeout wrapper for async operations
 * @param {Promise} promise - Promise to wrap
 * @param {number} [timeoutMs=30000] - Timeout in milliseconds
 * @returns {Promise} Promise that rejects on timeout
 */
function withTimeout(promise, timeoutMs = 30000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}



/**
 * Main enrichment function
 */
/**
 * Enrich business with owner info, email, LinkedIn, revenue, tier, barter
 * @param {Object} business - Business object to enrich
 * @returns {Promise<Object>} Enriched business object
 * @throws {Error} If enrichment fails
 */
async function enrichBusiness(business) {
  const enriched = { ...business };
  
  // Step 1: Get owner name from Companies House
  if (!enriched.ownerFirstName) {
    const owner = await retryOperation(() => withTimeout(getOwnerName(business.name, business.postcode)));
    if (owner) {
      enriched.ownerFirstName = owner.firstName;
      enriched.ownerLastName = owner.lastName;
      enriched.ownerFullName = owner.fullName;
    }
  }
  
  // Step 2: Discover email
  if (!enriched.ownerEmail && enriched.ownerFirstName) {
    const emailResult = await retryOperation(() => withTimeout(discoverEmail({
      firstName: enriched.ownerFirstName,
      lastName: enriched.ownerLastName,
      domain: (() => {
        try {
          return business.website ? new URL(business.website).hostname.replace("www.", "") : null;
        } catch (e) {
          console.warn(`Invalid website URL: ${business.website}`);
          return null;
        }
      })(),
      website: business.website,
      emailsFromWebsite: business.emailsFromWebsite || [],
      useIcypeas: true
    })));
    
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
/**
 * Process businesses from Google Maps scraping and enrichment
 * @param {string} location - Location name (e.g., Bramhall)
 * @param {string} postcode - Postcode prefix (e.g., SK7) for validation
 * @param {Array<string>} [businessTypes=[]] - Business type keywords
 * @param {boolean} [extractEmails=true] - Whether to extract emails via HasData
 * @returns {Promise<Array>} Array of enriched businesses
 * @throws {Error} If validation fails or processing fails
 */
async function processBusinesses(location, postcode, businessTypes = [], extractEmails = true) {
  validateInputs(location, postcode, businessTypes);
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
        console.error(`Error saving ${enriched.name || enriched.businessName || "business"}: ${saveError.constructor.name} - ${saveError.message}`);
        // Continue processing even if save fails
      }
      
      // Small delay to avoid rate limits
      const DELAY_MS = parseInt(process.env.ENRICHMENT_DELAY_MS || 500, 10);
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    } catch (error) {
      console.error(`Error enriching ${business.name}: ${error.constructor.name} - ${error.message}${error.stack ? "\n" + error.stack : ""}`);
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
      console.error(`Error exporting ${business.name}: ${error.constructor.name} - ${error.message}`);
    }
  }
  
  return exported;
}

// Main execution (if run directly)
if (require.main === module) {
  // Parse command line arguments
  const args = process.argv.slice(2);
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
      if (args[i + 1]) location = args[i + 1];
      if (args[i + 2]) postcode = args[i + 2];
      break;
    } else if (i === 0 && !arg.startsWith("--")) {
      location = arg;
    } else if (i === 1 && !arg.startsWith("--")) {
      postcode = arg;
    } else if (i === 2 && !arg.startsWith("--")) {
      businessTypes = arg.split(",");
    }
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
