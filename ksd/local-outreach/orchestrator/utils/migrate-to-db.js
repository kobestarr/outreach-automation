/**
 * Migration Script: JSON to Database
 * Migrates existing JSON business files to SQLite database
 */

const fs = require("fs");
const path = require("path");
const { saveBusiness, initDatabase } = require("../modules/database");

const JSON_DIR = path.join(__dirname, "../data/businesses");
const ARCHIVE_DIR = path.join(__dirname, "../data/archive");

async function migrate() {
  console.log("🚀 Starting migration from JSON to Database...");
  
  // Initialize database
  initDatabase();
  
  // Ensure directories exist
  if (!fs.existsSync(JSON_DIR)) {
    console.log(`✅ JSON directory does not exist: ${JSON_DIR}`);
    console.log("No migration needed - starting fresh with database.");
    return;
  }
  
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }
  
  // Read all JSON files
  const files = fs.readdirSync(JSON_DIR).filter(f => f.endsWith(".json") && f !== "index.json");
  
  if (files.length === 0) {
    console.log("✅ No JSON files to migrate");
    return;
  }
  
  console.log(`Found ${files.length} business files to migrate`);
  
  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const file of files) {
    try {
      const filePath = path.join(JSON_DIR, file);
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      
      // Extract business and metadata
      const business = data.business || data;
      const metadata = {
        scrapedAt: data.scrapedAt,
        enrichedAt: data.enrichedAt,
        location: data.location,
        postcode: data.postcode,
        status: data.status || "enriched",
        exportedTo: data.exportedTo,
        exportedAt: data.exportedAt
      };
      
      // Save to database (will handle deduplication)
      const businessId = saveBusiness(business, metadata);
      
      // Archive the JSON file
      const archivePath = path.join(ARCHIVE_DIR, file);
      fs.renameSync(filePath, archivePath);
      
      migrated++;
      if (migrated % 10 === 0) {
        process.stdout.write(`\rMigrated: ${migrated}/${files.length}`);
      }
    } catch (error) {
      console.error(`\nError migrating ${file}:`, error.message);
      errors++;
    }
  }
  
  // Archive index.json if it exists
  const indexPath = path.join(JSON_DIR, "index.json");
  if (fs.existsSync(indexPath)) {
    fs.renameSync(indexPath, path.join(ARCHIVE_DIR, "index.json"));
  }
  
  console.log(`\n✅ Migration complete!`);
  console.log(`   Migrated: ${migrated}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Errors: ${errors}`);
}

if (require.main === module) {
  migrate().catch(console.error);
}

module.exports = { migrate };
