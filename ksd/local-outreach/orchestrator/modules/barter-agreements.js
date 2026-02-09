/**
 * Barter Agreements Tracker
 * Tracks existing barter agreements to avoid duplicate offers
 */

const fs = require("fs");
const path = require("path");
const logger = require("../../../../shared/outreach-core/logger");

const AGREEMENTS_FILE = path.join(__dirname, "../data/barter-agreements.json");

/**
 * Load existing barter agreements
 */
function loadAgreements() {
  try {
    if (fs.existsSync(AGREEMENTS_FILE)) {
      const data = fs.readFileSync(AGREEMENTS_FILE, "utf8");
      return JSON.parse(data);
    }
    return {};
  } catch (error) {
    logger.warn('barter-agreements', 'Failed to load barter agreements', { error: error.message });
    return {};
  }
}

/**
 * Save barter agreements
 */
function saveAgreements(agreements) {
  const dir = path.dirname(AGREEMENTS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(AGREEMENTS_FILE, JSON.stringify(agreements, null, 2));
}

/**
 * Check if category already has a barter agreement
 */
function hasAgreement(category) {
  const agreements = loadAgreements();
  const categoryKey = (category || "").toLowerCase();
  return agreements[categoryKey] && agreements[categoryKey].length > 0;
}

/**
 * Get all agreements for a category
 */
function getAgreements(category) {
  const agreements = loadAgreements();
  const categoryKey = (category || "").toLowerCase();
  return agreements[categoryKey] || [];
}

/**
 * Add a barter agreement
 */
function addAgreement(category, businessName) {
  const agreements = loadAgreements();
  const categoryKey = (category || "").toLowerCase();
  
  if (!agreements[categoryKey]) {
    agreements[categoryKey] = [];
  }
  
  // Avoid duplicates
  if (!agreements[categoryKey].includes(businessName)) {
    agreements[categoryKey].push(businessName);
    saveAgreements(agreements);
    return true;
  }
  
  return false;
}

/**
 * Remove a barter agreement
 */
function removeAgreement(category, businessName) {
  const agreements = loadAgreements();
  const categoryKey = (category || "").toLowerCase();
  
  if (agreements[categoryKey]) {
    agreements[categoryKey] = agreements[categoryKey].filter(
      name => name !== businessName
    );
    
    // Remove category if empty
    if (agreements[categoryKey].length === 0) {
      delete agreements[categoryKey];
    }
    
    saveAgreements(agreements);
    return true;
  }
  
  return false;
}

/**
 * Get all agreements (for admin/debugging)
 */
function getAllAgreements() {
  return loadAgreements();
}

module.exports = {
  hasAgreement,
  getAgreements,
  addAgreement,
  removeAgreement,
  getAllAgreements
};
