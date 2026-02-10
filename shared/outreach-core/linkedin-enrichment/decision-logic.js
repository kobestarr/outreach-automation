/**
 * LinkedIn Enrichment Decision Logic
 * Determines whether to enrich LinkedIn based on business type, tier, and success rates
 */

const fs = require("fs");
const path = require("path");

const ENRICHMENT_STATS_PATH = path.join(__dirname, "../data/enrichment-stats.json");

/**
 * Load enrichment statistics
 */
function loadEnrichmentStats() {
  try {
    if (fs.existsSync(ENRICHMENT_STATS_PATH)) {
      const data = fs.readFileSync(ENRICHMENT_STATS_PATH, "utf8");
      return JSON.parse(data);
    }
    return { linkedInSuccessRate: {} };
  } catch (error) {
    return { linkedInSuccessRate: {} };
  }
}

/**
 * Save enrichment statistics
 */
function saveEnrichmentStats(stats) {
  const dir = path.dirname(ENRICHMENT_STATS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(ENRICHMENT_STATS_PATH, JSON.stringify(stats, null, 2));
}

/**
 * Record LinkedIn enrichment result
 */
function recordLinkedInResult(business, found) {
  const stats = loadEnrichmentStats();
  const category = (business.category || "unknown").toLowerCase();
  
  if (!stats.linkedInSuccessRate[category]) {
    stats.linkedInSuccessRate[category] = {
      attempts: 0,
      successes: 0,
      rate: null
    };
  }
  
  const categoryStats = stats.linkedInSuccessRate[category];
  categoryStats.attempts++;
  if (found) categoryStats.successes++;
  categoryStats.rate = categoryStats.successes / categoryStats.attempts;
  
  saveEnrichmentStats(stats);
  return categoryStats;
}

/**
 * Determine if LinkedIn enrichment should be performed
 */
function shouldEnrichLinkedIn(business, creditLimits) {
  // Prerequisites
  if (!business.ownerFirstName || !business.ownerLastName) {
    return {
      enrich: false,
      reason: "no_owner_name",
      priority: "skip"
    };
  }
  
  if (creditLimits && creditLimits.icypeas && creditLimits.icypeas.remaining < 1) {
    return {
      enrich: false,
      reason: "insufficient_credits",
      priority: "skip"
    };
  }
  
  // Category classification
  const category = (business.category || "").toLowerCase();
  const professionalCategories = [
    "doctor", "dentist", "solicitor", "lawyer", "accountant",
    "consultant", "financial advisor", "architect", "engineer",
    "veterinarian", "optometrist", "chiropractor"
  ];
  
  const healthBeautyCategories = [
    "salon", "gym", "physio", "physiotherapist", "personal trainer",
    "spa", "wellness", "nutritionist", "dietitian"
  ];
  
  const lowValueCategories = [
    "cafe", "restaurant", "bakery", "retail", "shop", "boutique",
    "plumber", "electrician", "landscaper", "builder", "handyman",
    "dry cleaner", "car wash", "pet groomer"
  ];
  
  // Load success rates
  const stats = loadEnrichmentStats();
  const categorySuccessRate = stats.linkedInSuccessRate?.[category]?.rate || null;
  const minSuccessRate = 0.5;
  
  // Revenue and tier
  const revenue = business.estimatedRevenue || 0;
  const offerTier = business.assignedOfferTier || "tier1";
  const highValueTiers = ["tier4", "tier5"];
  const isHighValueTier = highValueTiers.includes(offerTier);
  
  // Professionals: Always enrich (unless success rate terrible)
  if (professionalCategories.some(prof => category.includes(prof))) {
    if (categorySuccessRate !== null && categorySuccessRate < 0.3) {
      return {
        enrich: false,
        reason: "low_success_rate",
        category: category,
        successRate: categorySuccessRate,
        priority: "skip"
      };
    }
    
    return {
      enrich: true,
      reason: "professional_category",
      priority: "high",
      expectedSuccessRate: 0.8
    };
  }
  
  // Health/Beauty: Conditional
  if (healthBeautyCategories.some(hb => category.includes(hb))) {
    const shouldEnrich = 
      revenue >= 200000 ||
      ["tier3", "tier4", "tier5"].includes(offerTier) ||
      (categorySuccessRate !== null && categorySuccessRate >= minSuccessRate);
    
    if (!shouldEnrich) {
      return {
        enrich: false,
        reason: "health_beauty_criteria_not_met",
        revenue: revenue,
        tier: offerTier,
        successRate: categorySuccessRate,
        priority: "skip"
      };
    }
    
    if (categorySuccessRate !== null && categorySuccessRate < minSuccessRate) {
      return {
        enrich: false,
        reason: "low_success_rate",
        category: category,
        successRate: categorySuccessRate,
        priority: "skip"
      };
    }
    
    return {
      enrich: true,
      reason: "health_beauty_qualified",
      priority: "medium",
      expectedSuccessRate: 0.5
    };
  }
  
  // Low value categories: Skip by default
  if (lowValueCategories.some(lv => category.includes(lv))) {
    if (isHighValueTier && business.ownerEmail) {
      return {
        enrich: true,
        reason: "high_tier_exception",
        priority: "low",
        expectedSuccessRate: 0.2,
        note: "Email available as fallback"
      };
    }
    
    return {
      enrich: false,
      reason: "low_value_category",
      category: category,
      priority: "skip"
    };
  }
  
  // Unknown categories: Skip unless high tier + no email + established
  const reviewCount = business.reviewCount || 0;
  const isEstablished = reviewCount > 50;
  const hasEmail = !!business.ownerEmail && business.emailVerified;
  
  if (isHighValueTier && !hasEmail && isEstablished) {
    return {
      enrich: true,
      reason: "unknown_category_high_value",
      priority: "medium",
      expectedSuccessRate: 0.4,
      note: "Testing new category"
    };
  }
  
  return {
    enrich: false,
    reason: "unknown_category",
    category: category,
    priority: "skip"
  };
}

module.exports = {
  shouldEnrichLinkedIn,
  recordLinkedInResult,
  loadEnrichmentStats
};
