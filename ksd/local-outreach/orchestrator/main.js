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

async function enrichBusiness(business) {
  const enriched = { ...business };
  
  if (!enriched.ownerFirstName) {
    const owner = await getOwnerName(business.name, business.postcode);
    if (owner) {
      enriched.ownerFirstName = owner.firstName;
      enriched.ownerLastName = owner.lastName;
      enriched.ownerFullName = owner.fullName;
    }
  }
  
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
  
  if (enriched.ownerFirstName) {
    const linkedInResult = await enrichLinkedIn(enriched);
    if (linkedInResult.enriched) {
      enriched.linkedInUrl = linkedInResult.linkedInUrl;
      enriched.linkedInData = linkedInResult.linkedInData;
    }
  }
  
  const revenueEstimate = await estimateRevenue(enriched);
  enriched.estimatedRevenue = revenueEstimate.estimatedRevenue;
  enriched.revenueBand = revenueEstimate.revenueBand;
  enriched.revenueConfidence = revenueEstimate.confidence;
  
  const tier = assignTier(enriched.estimatedRevenue);
  enriched.assignedOfferTier = tier.tierId;
  enriched.setupFee = tier.setupFee;
  enriched.monthlyPrice = tier.monthlyPrice;
  enriched.ghlOffer = tier.ghlOffer;
  enriched.leadMagnet = tier.leadMagnet;
  
  const barter = detectBarterOpportunity(enriched);
  enriched.barterOpportunity = barter;
  
  return enriched;
}

async function processBusinesses(location, businessTypes = []) {
  const businesses = await scrapeGoogleMaps(location, businessTypes);
  const filteredBusinesses = filterChains(businesses);
  const enrichedBusinesses = [];
  
  for (const business of filteredBusinesses) {
    try {
      const enriched = await enrichBusiness(business);
      enrichedBusinesses.push(enriched);
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error("Error enriching " + business.name + ":", error.message);
    }
  }
  
  return enrichedBusinesses;
}

async function generateAndExport(enrichedBusinesses, config = {}) {
  const approvedTemplates = loadApprovedTemplates();
  const exported = [];
  
  for (const business of enrichedBusinesses) {
    try {
      const content = await generateOutreachContent(business, {
        generateEmail: true,
        generateLinkedIn: !!business.linkedInUrl,
        emailSequence: true
      });
      
      if (needsApproval(business, approvedTemplates)) {
        addToApprovalQueue(business, content.email || content.emailSequence[0]);
        console.log("Added " + business.category + " email to approval queue");
        continue;
      }
      
      if (business.ownerEmail && config.lemlistCampaignId) {
        await exportToLemlist(business, config.lemlistCampaignId, content.emailSequence);
      }
      
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

if (require.main === module) {
  const location = process.argv[2] || "Bramhall";
  const businessTypes = process.argv[3] ? process.argv[3].split(",") : [];
  
  processBusinesses(location, businessTypes)
    .then(businesses => {
      console.log("Enriched " + businesses.length + " businesses");
      return generateAndExport(businesses, {
        lemlistCampaignId: process.env.LEMLIST_CAMPAIGN_ID,
        exportLinkedIn: true
      });
    })
    .then(exported => {
      console.log("Exported " + exported.length + " businesses");
    })
    .catch(error => {
      console.error("Error:", error);
      process.exit(1);
    });
}

module.exports = {
  processBusinesses,
  enrichBusiness,
  generateAndExport
};
