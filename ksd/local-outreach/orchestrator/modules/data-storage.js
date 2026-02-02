/**
 * Data Storage Module
 * Handles persistent storage of enriched business data
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "../data/businesses");
const ARCHIVE_DIR = path.join(__dirname, "../data/archive");
const INDEX_FILE = path.join(DATA_DIR, "index.json");

// Ensure directories exist
[DATA_DIR, ARCHIVE_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/**
 * Generate business ID from business data
 */
function generateBusinessId(business) {
  const name = (business.name || business.businessName || "unknown").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .substring(0, 50);
  const postcode = (business.postcode || "").toLowerCase().replace(/\s+/g, "");
  const hash = crypto.createHash("md5")
    .update(JSON.stringify({ name: business.name, address: business.address }))
    .digest("hex")
    .substring(0, 8);
  
  return `${name}-${postcode}-${hash}`;
}

/**
 * Load index file
 */
function loadIndex() {
  if (!fs.existsSync(INDEX_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  } catch (error) {
    return {};
  }
}

/**
 * Save index file
 */
function saveIndex(index) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

/**
 * Save enriched business data
 */
function saveBusiness(business, metadata = {}) {
  const businessId = generateBusinessId(business);
  const filePath = path.join(DATA_DIR, `${businessId}.json`);
  
  const record = {
    id: businessId,
    scrapedAt: metadata.scrapedAt || new Date().toISOString(),
    enrichedAt: metadata.enrichedAt || new Date().toISOString(),
    location: metadata.location || business.location,
    postcode: business.postcode || metadata.postcode,
    business: business,
    exportedTo: metadata.exportedTo || [],
    exportedAt: metadata.exportedAt || null,
    status: metadata.status || "enriched"
  };
  
  // Save business file
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
  
  // Update index
  const index = loadIndex();
  index[businessId] = {
    id: businessId,
    name: business.name || business.businessName,
    location: record.location,
    postcode: record.postcode,
    status: record.status,
    enrichedAt: record.enrichedAt,
    exportedAt: record.exportedAt,
    hasEmail: !!(business.ownerEmail),
    hasLinkedIn: !!(business.linkedInUrl),
    tier: business.assignedOfferTier || null
  };
  saveIndex(index);
  
  return businessId;
}

/**
 * Load businesses with optional filters
 */
function loadBusinesses(filters = {}) {
  const index = loadIndex();
  const businesses = [];
  
  for (const [businessId, indexData] of Object.entries(index)) {
    // Apply filters
    if (filters.location && indexData.location !== filters.location) continue;
    if (filters.postcode && indexData.postcode !== filters.postcode) continue;
    if (filters.status && indexData.status !== filters.status) continue;
    if (filters.tier && indexData.tier !== filters.tier) continue;
    if (filters.hasEmail !== undefined && indexData.hasEmail !== filters.hasEmail) continue;
    if (filters.hasLinkedIn !== undefined && indexData.hasLinkedIn !== filters.hasLinkedIn) continue;
    
    // Date filters
    if (filters.enrichedAfter && indexData.enrichedAt < filters.enrichedAfter) continue;
    if (filters.enrichedBefore && indexData.enrichedAt > filters.enrichedBefore) continue;
    
    // Load full business data
    const filePath = path.join(DATA_DIR, `${businessId}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
        businesses.push(record);
      } catch (error) {
        console.error(`Error loading business ${businessId}:`, error.message);
      }
    }
  }
  
  // Sort by enrichedAt (newest first)
  businesses.sort((a, b) => new Date(b.enrichedAt) - new Date(a.enrichedAt));
  
  return businesses;
}

/**
 * Update existing business record
 */
function updateBusiness(businessId, updates) {
  const filePath = path.join(DATA_DIR, `${businessId}.json`);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`Business ${businessId} not found`);
  }
  
  const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
  
  // Update fields
  Object.assign(record, updates);
  if (updates.business) {
    record.business = { ...record.business, ...updates.business };
  }
  
  // Update timestamps
  if (updates.status) {
    record.status = updates.status;
    if (updates.status === "exported" && !record.exportedAt) {
      record.exportedAt = new Date().toISOString();
    }
  }
  
  // Save updated record
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
  
  // Update index
  const index = loadIndex();
  if (index[businessId]) {
    if (updates.status) index[businessId].status = updates.status;
    if (updates.exportedTo) index[businessId].exportedTo = updates.exportedTo;
    if (record.exportedAt) index[businessId].exportedAt = record.exportedAt;
    if (updates.business) {
      index[businessId].hasEmail = !!(updates.business.ownerEmail);
      index[businessId].hasLinkedIn = !!(updates.business.linkedInUrl);
      index[businessId].tier = updates.business.assignedOfferTier || index[businessId].tier;
    }
    saveIndex(index);
  }
  
  return record;
}

/**
 * Archive business (move to archive directory)
 */
function archiveBusiness(businessId) {
  const filePath = path.join(DATA_DIR, `${businessId}.json`);
  const archivePath = path.join(ARCHIVE_DIR, `${businessId}.json`);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`Business ${businessId} not found`);
  }
  
  // Move file
  fs.renameSync(filePath, archivePath);
  
  // Remove from index
  const index = loadIndex();
  delete index[businessId];
  saveIndex(index);
  
  return true;
}

/**
 * Get statistics about stored businesses
 */
function getBusinessStats(filters = {}) {
  const businesses = loadBusinesses(filters);
  const index = loadIndex();
  
  const stats = {
    total: businesses.length,
    byStatus: {},
    byTier: {},
    byLocation: {},
    withEmail: 0,
    withLinkedIn: 0,
    withBoth: 0,
    exported: 0,
    dateRange: {
      earliest: null,
      latest: null
    }
  };
  
  let earliestDate = null;
  let latestDate = null;
  
  businesses.forEach(record => {
    // Status breakdown
    stats.byStatus[record.status] = (stats.byStatus[record.status] || 0) + 1;
    
    // Tier breakdown
    const tier = record.business.assignedOfferTier || "unknown";
    stats.byTier[tier] = (stats.byTier[tier] || 0) + 1;
    
    // Location breakdown
    const location = record.location || "unknown";
    stats.byLocation[location] = (stats.byLocation[location] || 0) + 1;
    
    // Email/LinkedIn stats
    if (record.business.ownerEmail) stats.withEmail++;
    if (record.business.linkedInUrl) stats.withLinkedIn++;
    if (record.business.ownerEmail && record.business.linkedInUrl) stats.withBoth++;
    
    // Export stats
    if (record.exportedTo && record.exportedTo.length > 0) stats.exported++;
    
    // Date range
    const enrichedDate = new Date(record.enrichedAt);
    if (!earliestDate || enrichedDate < earliestDate) earliestDate = enrichedDate;
    if (!latestDate || enrichedDate > latestDate) latestDate = enrichedDate;
  });
  
  if (earliestDate) stats.dateRange.earliest = earliestDate.toISOString();
  if (latestDate) stats.dateRange.latest = latestDate.toISOString();
  
  return stats;
}

/**
 * Get business by ID
 */
function getBusiness(businessId) {
  const filePath = path.join(DATA_DIR, `${businessId}.json`);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

module.exports = {
  saveBusiness,
  loadBusinesses,
  updateBusiness,
  archiveBusiness,
  getBusinessStats,
  getBusiness,
  generateBusinessId
};
