#!/usr/bin/env node
/**
 * View Businesses Utility
 * List and display stored business data
 */

const { loadBusinesses, getBusinessStats } = require("../modules/database");

// Parse command line arguments
const args = process.argv.slice(2);
const filters = {};
let showDetails = false;
let showStats = false;
let limit = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === "--location" || arg === "-l") {
    filters.location = args[++i];
  } else if (arg === "--postcode" || arg === "-p") {
    filters.postcode = args[++i];
  } else if (arg === "--status" || arg === "-s") {
    filters.status = args[++i];
  } else if (arg === "--tier" || arg === "-t") {
    filters.tier = args[++i];
  } else if (arg === "--has-email") {
    filters.hasEmail = true;
  } else if (arg === "--has-linkedin") {
    filters.hasLinkedIn = true;
  } else if (arg === "--details" || arg === "-d") {
    showDetails = true;
  } else if (arg === "--stats") {
    showStats = true;
  } else if (arg === "--limit" || arg === "-n") {
    limit = parseInt(args[++i]);
  } else if (arg === "--help" || arg === "-h") {
    console.log(`
View Businesses Utility

Usage: node view-businesses.js [options]

Options:
  --location, -l <location>    Filter by location
  --postcode, -p <postcode>    Filter by postcode
  --status, -s <status>        Filter by status (scraped, enriched, exported)
  --tier, -t <tier>            Filter by tier (1-5)
  --has-email                  Only show businesses with email
  --has-linkedin               Only show businesses with LinkedIn
  --details, -d                Show detailed business information
  --stats                      Show statistics
  --limit, -n <number>         Limit number of results
  --help, -h                   Show this help

Examples:
  node view-businesses.js --location Bramhall --stats
  node view-businesses.js --postcode SK7 --has-email --limit 10
  node view-businesses.js --status exported --details
`);
    process.exit(0);
  }
}

// Show statistics if requested
if (showStats) {
  const stats = getBusinessStats(filters);
  console.log("\n📊 Business Statistics");
  console.log("=".repeat(50));
  console.log(`Total: ${stats.total}`);
  console.log(`\nBy Status:`);
  Object.entries(stats.byStatus).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`);
  });
  console.log(`\nBy Tier:`);
  Object.entries(stats.byTier).forEach(([tier, count]) => {
    console.log(`  Tier ${tier}: ${count}`);
  });
  console.log(`\nBy Location:`);
  Object.entries(stats.byLocation).forEach(([location, count]) => {
    console.log(`  ${location}: ${count}`);
  });
  console.log(`\nContact Info:`);
  console.log(`  With Email: ${stats.withEmail}`);
  console.log(`  With LinkedIn: ${stats.withLinkedIn}`);
  console.log(`  With Both: ${stats.withBoth}`);
  console.log(`  Exported: ${stats.exported}`);
  if (stats.dateRange.earliest) {
    console.log(`\nDate Range:`);
    console.log(`  Earliest: ${stats.dateRange.earliest}`);
    console.log(`  Latest: ${stats.dateRange.latest}`);
  }
  console.log("");
}

// Load businesses
const businesses = loadBusinesses(filters);
const displayBusinesses = limit ? businesses.slice(0, limit) : businesses;

if (displayBusinesses.length === 0) {
  console.log("No businesses found matching the criteria.");
  process.exit(0);
}

console.log(`\n📋 Found ${businesses.length} businesses${limit ? ` (showing ${displayBusinesses.length})` : ""}`);
console.log("=".repeat(50));

displayBusinesses.forEach((record, index) => {
  const b = record.business;
  
  console.log(`\n${index + 1}. ${b.name || "Unknown"}`);
  console.log(`   Location: ${record.location} (${record.postcode})`);
  console.log(`   Status: ${record.status}`);
  console.log(`   Enriched: ${new Date(record.enrichedAt).toLocaleString()}`);
  
  if (showDetails) {
    console.log(`   Address: ${b.address || "N/A"}`);
    console.log(`   Website: ${b.website || "N/A"}`);
    console.log(`   Phone: ${b.phone || "N/A"}`);
    console.log(`   Category: ${b.category || "N/A"}`);
    console.log(`   Rating: ${b.rating || "N/A"} (${b.reviewCount || 0} reviews)`);
    
    if (b.ownerFirstName) {
      console.log(`   Owner: ${b.ownerFirstName} ${b.ownerLastName || ""}`);
    }
    if (b.ownerEmail) {
      console.log(`   Email: ${b.ownerEmail} (${b.emailSource || "unknown"})`);
    }
    if (b.linkedInUrl) {
      console.log(`   LinkedIn: ${b.linkedInUrl}`);
    }
    
    if (b.estimatedRevenue) {
      console.log(`   Revenue: £${b.estimatedRevenue.toLocaleString()} (${b.revenueBand})`);
    }
    if (b.assignedOfferTier) {
      console.log(`   Tier: ${b.assignedOfferTier} (£${b.setupFee} setup, £${b.monthlyPrice}/mo)`);
    }
    
    if (record.exportedTo && record.exportedTo.length > 0) {
      console.log(`   Exported to: ${record.exportedTo.join(", ")}`);
      if (record.exportedAt) {
        console.log(`   Exported: ${new Date(record.exportedAt).toLocaleString()}`);
      }
    }
  } else {
    // Summary view
    const info = [];
    if (b.ownerEmail) info.push("📧");
    if (b.linkedInUrl) info.push("💼");
    if (b.assignedOfferTier) info.push(`Tier ${b.assignedOfferTier}`);
    if (info.length > 0) {
      console.log(`   ${info.join(" ")}`);
    }
  }
});

console.log("");
