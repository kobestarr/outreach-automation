/**
 * Database Module
 * SQLite database for high-performance business data storage
 *
 * Includes automatic backup system:
 * - Creates timestamped backup before every init (if DB has data)
 * - Keeps last 10 backups, rotates older ones
 * - Validates SQLite integrity on startup
 * - WAL checkpoint on close
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
const BACKUP_DIR = path.join(DB_DIR, "backups");
const MAX_BACKUPS = 10;

// Ensure database and backup directories exist
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true, mode: 0o700 });
}
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
}

let db = null;

/**
 * Check if a file is a valid SQLite database (has the magic header bytes)
 */
function isValidSQLiteFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < 100) return false; // SQLite header is 100 bytes
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return buf.toString('ascii', 0, 15) === 'SQLite format 3';
  } catch (e) {
    return false;
  }
}

/**
 * Create a timestamped backup of the database file.
 * Only backs up if the file exists and contains actual data (valid SQLite).
 */
function backupDatabase() {
  if (!fs.existsSync(DB_PATH)) return null;
  if (!isValidSQLiteFile(DB_PATH)) return null;

  const stat = fs.statSync(DB_PATH);
  if (stat.size === 0) return null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `businesses-${timestamp}.db`;
  const backupPath = path.join(BACKUP_DIR, backupName);

  try {
    fs.copyFileSync(DB_PATH, backupPath);

    // Also backup WAL if it exists (contains uncommitted data)
    const walPath = DB_PATH + '-wal';
    if (fs.existsSync(walPath) && fs.statSync(walPath).size > 0) {
      fs.copyFileSync(walPath, backupPath + '-wal');
    }

    rotateBackups();
    return backupPath;
  } catch (e) {
    console.error(`[DB] Backup failed: ${e.message}`);
    return null;
  }
}

/**
 * Keep only the most recent MAX_BACKUPS backups, delete older ones.
 */
function rotateBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('businesses-') && f.endsWith('.db'))
      .sort()
      .reverse();

    // Remove old backups beyond MAX_BACKUPS
    for (let i = MAX_BACKUPS; i < files.length; i++) {
      const toDelete = path.join(BACKUP_DIR, files[i]);
      fs.unlinkSync(toDelete);
      // Also clean up associated WAL file
      const walFile = toDelete + '-wal';
      if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
    }
  } catch (e) {
    // Non-fatal — don't block database operations for cleanup failures
  }
}

/**
 * Restore the most recent valid backup.
 * @returns {string|null} Path to the restored backup, or null if no valid backup found
 */
function restoreLatestBackup() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('businesses-') && f.endsWith('.db') && !f.endsWith('-wal'))
      .sort()
      .reverse();

    for (const file of files) {
      const backupPath = path.join(BACKUP_DIR, file);
      if (isValidSQLiteFile(backupPath)) {
        fs.copyFileSync(backupPath, DB_PATH);
        // Restore WAL if it exists
        const walBackup = backupPath + '-wal';
        const walPath = DB_PATH + '-wal';
        if (fs.existsSync(walBackup)) {
          fs.copyFileSync(walBackup, walPath);
        } else if (fs.existsSync(walPath)) {
          fs.unlinkSync(walPath); // Remove stale WAL
        }
        console.log(`[DB] Restored from backup: ${file}`);
        return backupPath;
      }
    }
  } catch (e) {
    console.error(`[DB] Restore failed: ${e.message}`);
  }
  return null;
}

// SQL Schema - defined as array for readability
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    location TEXT,
    postcode TEXT,
    address TEXT,
    website TEXT,
    phone TEXT,
    category TEXT,
    rating REAL,
    review_count INTEGER,
    owner_first_name TEXT,
    owner_last_name TEXT,
    owner_email TEXT,
    email_source TEXT,
    email_verified INTEGER DEFAULT 0,
    linkedin_url TEXT,
    estimated_revenue REAL,
    revenue_band TEXT,
    revenue_confidence INTEGER,
    assigned_tier INTEGER,
    setup_fee REAL,
    monthly_price REAL,
    ghl_offer TEXT,
    lead_magnet TEXT,
    barter_opportunity TEXT,
    status TEXT DEFAULT "scraped",
    scraped_at TEXT,
    enriched_at TEXT,
    exported_to TEXT,
    exported_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    business_data TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_location_postcode ON businesses(location, postcode)`,
  `CREATE INDEX IF NOT EXISTS idx_status ON businesses(status)`,
  `CREATE INDEX IF NOT EXISTS idx_tier ON businesses(assigned_tier)`,
  `CREATE INDEX IF NOT EXISTS idx_email ON businesses(owner_email)`,
  `CREATE INDEX IF NOT EXISTS idx_exported_at ON businesses(exported_at)`,
  `CREATE INDEX IF NOT EXISTS idx_created_at ON businesses(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_name_postcode ON businesses(name, postcode)`,
  `CREATE INDEX IF NOT EXISTS idx_website ON businesses(website)`
];

/**
 * Initialize the SQLite database with WAL mode and required schema.
 * Creates a backup of existing data before opening.
 * If the DB file is 0 bytes or corrupt, attempts to restore from backup.
 * @returns {Database} The initialized better-sqlite3 database instance
 */
function initDatabase() {
  if (db) return db;

  // If DB file exists but is 0 bytes or corrupt, try to restore from backup
  if (fs.existsSync(DB_PATH)) {
    const stat = fs.statSync(DB_PATH);
    if (stat.size === 0 || !isValidSQLiteFile(DB_PATH)) {
      console.warn(`[DB] WARNING: Database file is ${stat.size === 0 ? 'empty (0 bytes)' : 'corrupt'}!`);
      const restored = restoreLatestBackup();
      if (restored) {
        console.log('[DB] Successfully restored from backup.');
      } else {
        console.warn('[DB] No valid backup found. Creating fresh database.');
      }
    }
  }

  // Backup existing database before opening (if it has data)
  const backupPath = backupDatabase();
  if (backupPath) {
    console.log(`[DB] Backup created: ${path.basename(backupPath)}`);
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // Execute schema statements
  for (const statement of SCHEMA_STATEMENTS) {
    db.exec(statement);
  }

  // Log database stats on init
  try {
    const count = db.prepare("SELECT COUNT(*) as count FROM businesses").get();
    console.log(`[DB] Initialized with ${count.count} businesses (${path.basename(DB_PATH)})`);
  } catch (e) {
    // Table might not exist yet on first run — that's fine
  }

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
  const byName = database.prepare(`SELECT id FROM businesses WHERE name = ? AND postcode = ? ORDER BY created_at DESC LIMIT 1`).get(business.name || business.businessName || "Unknown Business", business.postcode || "");
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
    return { id: row.id, scrapedAt: row.scraped_at, enrichedAt: row.enriched_at, location: row.location, postcode: row.postcode, business: business, exportedTo: (() => { try { return row.exported_to ? JSON.parse(row.exported_to) : []; } catch(e) { return [row.exported_to]; } })(), exportedAt: row.exported_at, status: row.status };
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
  return { id: row.id, scrapedAt: row.scraped_at, enrichedAt: row.enriched_at, location: row.location, postcode: row.postcode, business: business, exportedTo: (() => { try { return row.exported_to ? JSON.parse(row.exported_to) : []; } catch(e) { return [row.exported_to]; } })(), exportedAt: row.exported_at, status: row.status };
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
  if (db) {
    try {
      // Checkpoint WAL to ensure all data is written to the main database file
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch (e) {
      // Non-fatal — database may already be in a non-WAL mode
    }
    db.close();
    db = null;
  }
}

/**
 * List available backups with their sizes and dates.
 * @returns {Array<{file: string, size: number, date: string}>}
 */
function listBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('businesses-') && f.endsWith('.db') && !f.endsWith('-wal'))
      .sort()
      .reverse()
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { file: f, size: stat.size, date: stat.mtime.toISOString() };
      });
  } catch (e) {
    return [];
  }
}

module.exports = { initDatabase, saveBusiness, batchSaveBusinesses, loadBusinesses, updateBusiness, batchUpdateBusinesses, getBusiness, getBusinessStats, checkDuplicate, generateBusinessId, closeDatabase, backupDatabase, restoreLatestBackup, listBackups, isValidSQLiteFile, DB_PATH, BACKUP_DIR };
