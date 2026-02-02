/**
 * Database Module
 * SQLite database for high-performance business data storage
 *
 * @module database
 */

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// Configurable database path via environment variable
const DEFAULT_DB_DIR = path.join(__dirname, "../data");
const DB_DIR = process.env.OUTREACH_DB_DIR || DEFAULT_DB_DIR;
const DB_PATH = process.env.OUTREACH_DB_PATH || path.join(DB_DIR, "businesses.db");

// Ensure database directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true, mode: 0o700 });
}

let db = null;

/**
 * Initialize the SQLite database with WAL mode and required schema
 * @returns {Database} The initialized better-sqlite3 database instance
 */
function initDatabase() {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL, location TEXT, postcode TEXT, address TEXT, website TEXT, phone TEXT, category TEXT, rating REAL, review_count INTEGER, owner_first_name TEXT, owner_last_name TEXT, owner_email TEXT, email_source TEXT, email_verified INTEGER DEFAULT 0, linkedin_url TEXT, estimated_revenue REAL, revenue_band TEXT, revenue_confidence INTEGER, assigned_tier INTEGER, setup_fee REAL, monthly_price REAL, ghl_offer TEXT, lead_magnet TEXT, barter_opportunity TEXT, status TEXT DEFAULT "scraped", scraped_at TEXT, enriched_at TEXT, exported_to TEXT, exported_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, business_data TEXT); CREATE INDEX IF NOT EXISTS idx_location_postcode ON businesses(location, postcode); CREATE INDEX IF NOT EXISTS idx_status ON businesses(status); CREATE INDEX IF NOT EXISTS idx_tier ON businesses(assigned_tier); CREATE INDEX IF NOT EXISTS idx_email ON businesses(owner_email); CREATE INDEX IF NOT EXISTS idx_exported_at ON businesses(exported_at); CREATE INDEX IF NOT EXISTS idx_created_at ON businesses(created_at); CREATE INDEX IF NOT EXISTS idx_name_postcode ON businesses(name, postcode); CREATE INDEX IF NOT EXISTS idx_website ON businesses(website);`);
  return db;
}

/**
 * Generate a unique business ID from name, postcode, and content hash
 * @param {Object} business - Business object with name, postcode, address
 * @returns {string} Unique business identifier (slug-postcode-hash format)
 */
function generateBusinessId(business) {
  const name = (business.name || business.businessName || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 50);
  const postcode = (business.postcode || "").toLowerCase().replace(/\s+/g, "");
  const hash = crypto.createHash("md5").update(JSON.stringify({ name: business.name, address: business.address })).digest("hex").substring(0, 8);
  return `${name}-${postcode}-${hash}`;
}

/**
 * Check if a business already exists in the database
 * Checks by name+postcode, website domain, or exact address match
 * @param {Object} business - Business object to check for duplicates
 * @returns {string|null} Existing business ID if duplicate found, null otherwise
 */
function checkDuplicate(business) {
  const database = initDatabase();
  const byName = database.prepare(`SELECT id FROM businesses WHERE name = ? AND postcode = ? ORDER BY created_at DESC LIMIT 1`).get(business.name || business.businessName || "Unknown Business" || "Unknown Business", business.postcode || "");
  if (byName) return byName.id;
  if (business.website) {
    try {
      const domain = new URL(business.website).hostname.replace("www.", "");
      const byWebsite = database.prepare(`SELECT id FROM businesses WHERE website LIKE ? ORDER BY created_at DESC LIMIT 1`).get(`%${domain}%`);
      if (byWebsite) return byWebsite.id;
    } catch (e) {}
  }
  if (business.address) {
    const byAddress = database.prepare(`SELECT id FROM businesses WHERE address = ? ORDER BY created_at DESC LIMIT 1`).get(business.address);
    if (byAddress) return byAddress.id;
  }
  return null;
}

function saveBusiness(business, metadata = {}) {
  const database = initDatabase();
  const businessId = generateBusinessId(business);
  const existingId = checkDuplicate(business);
  const finalId = existingId || businessId;
  const stmt = database.prepare(`INSERT INTO businesses (id, name, location, postcode, address, website, phone, category, rating, review_count, owner_first_name, owner_last_name, owner_email, email_source, email_verified, linkedin_url, estimated_revenue, revenue_band, revenue_confidence, assigned_tier, setup_fee, monthly_price, ghl_offer, lead_magnet, barter_opportunity, status, scraped_at, enriched_at, exported_to, exported_at, business_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, location = excluded.location, postcode = excluded.postcode, address = excluded.address, website = excluded.website, phone = excluded.phone, category = excluded.category, rating = excluded.rating, review_count = excluded.review_count, owner_first_name = excluded.owner_first_name, owner_last_name = excluded.owner_last_name, owner_email = excluded.owner_email, email_source = excluded.email_source, email_verified = excluded.email_verified, linkedin_url = excluded.linkedin_url, estimated_revenue = excluded.estimated_revenue, revenue_band = excluded.revenue_band, revenue_confidence = excluded.revenue_confidence, assigned_tier = excluded.assigned_tier, setup_fee = excluded.setup_fee, monthly_price = excluded.monthly_price, ghl_offer = excluded.ghl_offer, lead_magnet = excluded.lead_magnet, barter_opportunity = excluded.barter_opportunity, status = excluded.status, enriched_at = excluded.enriched_at, exported_to = excluded.exported_to, exported_at = excluded.exported_at, business_data = excluded.business_data, updated_at = CURRENT_TIMESTAMP`);
  stmt.run(finalId, business.name || business.businessName || "Unknown Business" || "Unknown Business", metadata.location || business.location, business.postcode || metadata.postcode, business.address, business.website, business.phone, business.category, business.rating, business.reviewCount || 0, business.ownerFirstName, business.ownerLastName, business.ownerEmail, business.emailSource, business.emailVerified ? 1 : 0, business.linkedInUrl, business.estimatedRevenue, business.revenueBand, business.revenueConfidence, business.assignedOfferTier, business.setupFee, business.monthlyPrice, business.ghlOffer, business.leadMagnet, business.barterOpportunity ? JSON.stringify(business.barterOpportunity) : null, metadata.status || "enriched", metadata.scrapedAt || new Date().toISOString(), metadata.enrichedAt || new Date().toISOString(), metadata.exportedTo ? JSON.stringify(metadata.exportedTo) : null, metadata.exportedAt || null, JSON.stringify(business));
  return finalId;
}

function batchSaveBusinesses(businesses, metadata = {}) {
  const database = initDatabase();
  const transaction = database.transaction((businesses, metadata) => { for (const business of businesses) { saveBusiness(business, metadata); } });
  transaction(businesses, metadata);
  return businesses.length;
}

function loadBusinesses(filters = {}) {
  const database = initDatabase();
  let query = "SELECT * FROM businesses WHERE 1=1";
  const params = [];
  if (filters.location) { query += " AND location = ?"; params.push(filters.location); }
  if (filters.postcode) { query += " AND postcode = ?"; params.push(filters.postcode); }
  if (filters.status) { query += " AND status = ?"; params.push(filters.status); }
  if (filters.tier) { query += " AND assigned_tier = ?"; params.push(filters.tier); }
  if (filters.hasEmail !== undefined) { query += filters.hasEmail ? " AND owner_email IS NOT NULL" : " AND owner_email IS NULL"; }
  if (filters.hasLinkedIn !== undefined) { query += filters.hasLinkedIn ? " AND linkedin_url IS NOT NULL" : " AND linkedin_url IS NULL"; }
  if (filters.enrichedAfter) { query += " AND enriched_at >= ?"; params.push(filters.enrichedAfter); }
  if (filters.enrichedBefore) { query += " AND enriched_at <= ?"; params.push(filters.enrichedBefore); }
  query += " ORDER BY enriched_at DESC";
  if (filters.limit) { query += " LIMIT ?"; params.push(filters.limit); }
  const rows = database.prepare(query).all(...params);
  return rows.map(row => {
    const business = row.business_data ? JSON.parse(row.business_data) : { name: row.name, postcode: row.postcode, address: row.address, website: row.website, phone: row.phone, category: row.category, rating: row.rating, reviewCount: row.review_count, ownerFirstName: row.owner_first_name, ownerLastName: row.owner_last_name, ownerEmail: row.owner_email, emailSource: row.email_source, emailVerified: !!row.email_verified, linkedInUrl: row.linkedin_url, estimatedRevenue: row.estimated_revenue, revenueBand: row.revenue_band, assignedOfferTier: row.assigned_tier, setupFee: row.setup_fee, monthlyPrice: row.monthly_price };
    return { id: row.id, scrapedAt: row.scraped_at, enrichedAt: row.enriched_at, location: row.location, postcode: row.postcode, business: business, exportedTo: row.exported_to ? JSON.parse(row.exported_to) : [], exportedAt: row.exported_at, status: row.status };
  });
}

function updateBusiness(businessId, updates) {
  const database = initDatabase();
  const setClauses = [];
  const params = [];
  if (updates.status) { setClauses.push("status = ?"); params.push(updates.status); }
  if (updates.exportedTo) { setClauses.push("exported_to = ?"); params.push(JSON.stringify(updates.exportedTo)); }
  if (updates.exportedAt) { setClauses.push("exported_at = ?"); params.push(updates.exportedAt); }
  if (updates.business) {
    const b = updates.business;
    if (b.ownerEmail !== undefined) { setClauses.push("owner_email = ?"); params.push(b.ownerEmail); }
    if (b.linkedInUrl !== undefined) { setClauses.push("linkedin_url = ?"); params.push(b.linkedInUrl); }
    if (b.assignedOfferTier !== undefined) { setClauses.push("assigned_tier = ?"); params.push(b.assignedOfferTier); }
    const current = database.prepare("SELECT business_data FROM businesses WHERE id = ?").get(businessId);
    if (current && current.business_data) {
      const currentBusiness = JSON.parse(current.business_data);
      const updatedBusiness = { ...currentBusiness, ...b };
      setClauses.push("business_data = ?");
      params.push(JSON.stringify(updatedBusiness));
    }
  }
  if (setClauses.length === 0) return null;
  setClauses.push("updated_at = CURRENT_TIMESTAMP");
  params.push(businessId);
  database.prepare(`UPDATE businesses SET ${setClauses.join(", ")} WHERE id = ?`).run(...params);
  return getBusiness(businessId);
}

function getBusiness(businessId) {
  const database = initDatabase();
  const row = database.prepare("SELECT * FROM businesses WHERE id = ?").get(businessId);
  if (!row) return null;
  const business = row.business_data ? JSON.parse(row.business_data) : { name: row.name, postcode: row.postcode, address: row.address, website: row.website, phone: row.phone, category: row.category, rating: row.rating, reviewCount: row.review_count, ownerFirstName: row.owner_first_name, ownerLastName: row.owner_last_name, ownerEmail: row.owner_email, emailSource: row.email_source, emailVerified: !!row.email_verified, linkedInUrl: row.linkedin_url, estimatedRevenue: row.estimated_revenue, revenueBand: row.revenue_band, assignedOfferTier: row.assigned_tier };
  return { id: row.id, scrapedAt: row.scraped_at, enrichedAt: row.enriched_at, location: row.location, postcode: row.postcode, business: business, exportedTo: row.exported_to ? JSON.parse(row.exported_to) : [], exportedAt: row.exported_at, status: row.status };
}

function getBusinessStats(filters = {}) {
  const database = initDatabase();
  let whereClause = "WHERE 1=1";
  const params = [];
  if (filters.location) { whereClause += " AND location = ?"; params.push(filters.location); }
  if (filters.postcode) { whereClause += " AND postcode = ?"; params.push(filters.postcode); }
  if (filters.status) { whereClause += " AND status = ?"; params.push(filters.status); }
  const stats = { total: database.prepare(`SELECT COUNT(*) as count FROM businesses ${whereClause}`).get(...params).count, byStatus: {}, byTier: {}, byLocation: {}, withEmail: 0, withLinkedIn: 0, withBoth: 0, exported: 0, dateRange: { earliest: null, latest: null } };
  const statusRows = database.prepare(`SELECT status, COUNT(*) as count FROM businesses ${whereClause} GROUP BY status`).all(...params);
  statusRows.forEach(row => { stats.byStatus[row.status] = row.count; });
  const tierRows = database.prepare(`SELECT assigned_tier, COUNT(*) as count FROM businesses ${whereClause} GROUP BY assigned_tier`).all(...params);
  tierRows.forEach(row => { const tier = row.assigned_tier || "unknown"; stats.byTier[tier] = row.count; });
  const locationRows = database.prepare(`SELECT location, COUNT(*) as count FROM businesses ${whereClause} GROUP BY location`).all(...params);
  locationRows.forEach(row => { stats.byLocation[row.location || "unknown"] = row.count; });
  stats.withEmail = database.prepare(`SELECT COUNT(*) as count FROM businesses ${whereClause} AND owner_email IS NOT NULL`).get(...params).count;
  stats.withLinkedIn = database.prepare(`SELECT COUNT(*) as count FROM businesses ${whereClause} AND linkedin_url IS NOT NULL`).get(...params).count;
  stats.withBoth = database.prepare(`SELECT COUNT(*) as count FROM businesses ${whereClause} AND owner_email IS NOT NULL AND linkedin_url IS NOT NULL`).get(...params).count;
  stats.exported = database.prepare(`SELECT COUNT(*) as count FROM businesses ${whereClause} AND exported_to IS NOT NULL`).get(...params).count;
  const dateRange = database.prepare(`SELECT MIN(enriched_at) as earliest, MAX(enriched_at) as latest FROM businesses ${whereClause}`).get(...params);
  if (dateRange.earliest) stats.dateRange.earliest = dateRange.earliest;
  if (dateRange.latest) stats.dateRange.latest = dateRange.latest;
  return stats;
}

function batchUpdateBusinesses(updates) {
  const database = initDatabase();
  const transaction = database.transaction((updates) => { for (const update of updates) { updateBusiness(update.id, update.updates); } });
  transaction(updates);
  return updates.length;
}

function closeDatabase() {
  if (db) { db.close(); db = null; }
}

module.exports = { initDatabase, saveBusiness, batchSaveBusinesses, loadBusinesses, updateBusiness, batchUpdateBusinesses, getBusiness, getBusinessStats, checkDuplicate, generateBusinessId, closeDatabase };
