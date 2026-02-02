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
 * @returns {Promise<Array>} Array of enriched businesses
 */
async function processBusinesses(location, postcode, businessTypes = []) {
  // Step 1: Scrape Google Maps (with postcode for accuracy)
  console.log(`Scraping businesses in ${location}${postcode ? ` (${postcode})` : ""}...`);
  const businesses = await scrapeGoogleMaps(location, postcode, businessTypes);
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
      
      // Export to Lemlist
      if (business.ownerEmail && config.lemlistCampaignId) {
        await exportToLemlist(business, config.lemlistCampaignId, content.emailSequence);
      }
      
      // Export to Prosp
      if (business.linkedInUrl && config.exportLinkedIn) {
        await exportToProsp(business, content.linkedIn);
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

// Main execution (if run directly)
if (require.main === module) {
  const location = process.argv[2] || "Bramhall";
  const postcode = process.argv[3] || "SK7"; // Default postcode for Bramhall
  const businessTypes = process.argv[4] ? process.argv[4].split(",") : [];
  
  console.log(`Starting outreach automation for ${location} (${postcode})`);
  console.log(`Business types: ${businessTypes.length > 0 ? businessTypes.join(", ") : "All"}`);
  console.log("");
  
  processBusinesses(location, postcode, businessTypes)
    .then(businesses => {
      console.log(`\n✅ Enriched ${businesses.length} businesses`);
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
