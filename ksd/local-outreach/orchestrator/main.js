const { scrapeGoogleMaps } = require("./modules/google-maps-scraper");
const { scrapeGoogleMapsOutscraper } = require("./modules/google-maps-scraper-outscraper");
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
const logger = require("../../../shared/outreach-core/logger");

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
    const extractDomainSafely = (website) => {
      if (!website || typeof website !== 'string') return null;
      try {
        return new URL(website).hostname.replace(/^www\./, '');
      } catch {
        return null;
      }
    };
    
    const emailResult = await discoverEmail({
      firstName: enriched.ownerFirstName,
      lastName: enriched.ownerLastName,
      domain: extractDomainSafely(business.website),
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
  // Try Outscraper first, fallback to HasData if it fails OR returns 0 results
  logger.info('main', `Scraping businesses in ${location}${postcode ? ` (${postcode})` : ""}...`);

  let businesses = [];
  let scraperUsed = null;

  try {
    logger.info('main', 'Trying Outscraper API...');
    businesses = await scrapeGoogleMapsOutscraper(location, postcode, businessTypes, extractEmails);
    scraperUsed = 'outscraper';
    logger.info('main', `Found ${businesses.length} businesses via Outscraper`);

    // If Outscraper returned 0 results, try HasData as backup
    if (businesses.length === 0) {
      logger.info('main', 'Outscraper returned 0 results, trying HasData as backup...');
      try {
        const hasdataResults = await scrapeGoogleMaps(location, postcode, businessTypes, extractEmails);
        if (hasdataResults.length > 0) {
          businesses = hasdataResults;
          scraperUsed = 'hasdata';
          logger.info('main', `Found ${businesses.length} businesses via HasData`);
        }
      } catch (hasdataError) {
        logger.warn('main', 'HasData also returned 0 or failed', { error: hasdataError.message });
        // Continue with 0 businesses from Outscraper
      }
    }
  } catch (outscraperError) {
    logger.warn('main', 'Outscraper failed, falling back to HasData', { error: outscraperError.message });

    try {
      logger.info('main', 'Trying HasData API...');
      businesses = await scrapeGoogleMaps(location, postcode, businessTypes, extractEmails);
      scraperUsed = 'hasdata';
      logger.info('main', `Found ${businesses.length} businesses via HasData`);
    } catch (hasdataError) {
      logger.error('main', 'Both scrapers failed', {
        outscraperError: outscraperError.message,
        hasdataError: hasdataError.message
      });
      throw new Error(`Both Outscraper and HasData failed. Outscraper: ${outscraperError.message}, HasData: ${hasdataError.message}`);
    }
  }

  logger.info('main', `Scraper used: ${scraperUsed}`);
  
  // Step 2: Filter chains
  const filteredBusinesses = filterChains(businesses);
  logger.info('main', `After filtering chains: ${filteredBusinesses.length} businesses`);
  
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
        logger.error('main', 'Error saving business', { 
          businessName: enriched.name || enriched.businessName,
          error: saveError.message 
        });
        // Continue processing even if save fails
      }
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      logger.error('main', 'Error enriching business', { businessName: business.name, error: error.message });
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
        logger.info('main', `Added ${business.category} email to approval queue`);
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
      logger.error('main', 'Error exporting business', { businessName: business.name, error: error.message });
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

  logger.info('main', `Starting outreach automation for ${location} (${postcode})`);
  logger.info('main', `Business types: ${businessTypes.length > 0 ? businessTypes.join(", ") : "All"}`);
  logger.info('main', `Email extraction: ${extractEmails ? "enabled" : "disabled"}`);
  
  let businessesPromise;
  
  if (loadExisting) {
    // Load existing businesses from storage
    logger.info('main', `Loading existing businesses for ${location} (${postcode})...`);
    const existingBusinesses = loadBusinesses({ location, postcode });
    logger.info('main', `Found ${existingBusinesses.length} existing businesses`);
    businessesPromise = Promise.resolve(existingBusinesses.map(record => record.business));
  } else {
    // Scrape and enrich new businesses
    businessesPromise = processBusinesses(location, postcode, businessTypes, extractEmails);
  }
  
  businessesPromise
    .then(businesses => {
      logger.info('main', `${loadExisting ? "Loaded" : "Enriched"} ${businesses.length} businesses`);
      return generateAndExport(businesses, {
        lemlistCampaignId: process.env.LEMLIST_CAMPAIGN_ID,
        exportLinkedIn: true
      });
    })
    .then(exported => {
      logger.info('main', `Exported ${exported.length} businesses`);
      exported.forEach(e => {
        logger.info('main', `  - ${e.business} (${e.tier})`);
      });
    })
    .catch(error => {
      logger.error('main', 'Fatal error', { error: error.message, stack: error.stack });
      process.exit(1);
    });
}

module.exports = {
  processBusinesses,
  enrichBusiness,
  generateAndExport
};
