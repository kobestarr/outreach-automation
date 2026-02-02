#!/usr/bin/env node
/**
 * Business Statistics Utility
 * Show detailed statistics about stored businesses
 */

const { getBusinessStats, loadBusinesses } = require("../modules/data-storage");

// Parse command line arguments
const args = process.argv.slice(2);
const filters = {};
let detailed = false;

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
  } else if (arg === "--detailed" || arg === "-d") {
    detailed = true;
  } else if (arg === "--help" || arg === "-h") {
    console.log(`
Business Statistics Utility

Usage: node business-stats.js [options]

Options:
  --location, -l <location>    Filter by location
  --postcode, -p <postcode>    Filter by postcode
  --status, -s <status>        Filter by status
  --tier, -t <tier>            Filter by tier
  --detailed, -d               Show detailed breakdown
  --help, -h                   Show this help

Examples:
  node business-stats.js
  node business-stats.js --location Bramhall --detailed
  node business-stats.js --status exported
`);
    process.exit(0);
  }
}

const stats = getBusinessStats(filters);
const businesses = loadBusinesses(filters);

console.log("\n📊 Business Statistics");
console.log("=".repeat(60));

if (Object.keys(filters).length > 0) {
  console.log("Filters:", JSON.stringify(filters, null, 2));
  console.log("");
}

console.log(`Total Businesses: ${stats.total}`);
console.log("");

// Status breakdown
console.log("Status Breakdown:");
if (Object.keys(stats.byStatus).length === 0) {
  console.log("  (none)");
} else {
  Object.entries(stats.byStatus)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => {
      const percentage = ((count / stats.total) * 100).toFixed(1);
      console.log(`  ${status.padEnd(15)} ${count.toString().padStart(4)} (${percentage}%)`);
    });
}
console.log("");

// Tier breakdown
console.log("Tier Breakdown:");
if (Object.keys(stats.byTier).length === 0) {
  console.log("  (none)");
} else {
  Object.entries(stats.byTier)
    .sort((a, b) => {
      if (a[0] === "unknown") return 1;
      if (b[0] === "unknown") return -1;
      return parseInt(a[0]) - parseInt(b[0]);
    })
    .forEach(([tier, count]) => {
      const percentage = ((count / stats.total) * 100).toFixed(1);
      console.log(`  Tier ${tier.toString().padEnd(12)} ${count.toString().padStart(4)} (${percentage}%)`);
    });
}
console.log("");

// Location breakdown
console.log("Location Breakdown:");
if (Object.keys(stats.byLocation).length === 0) {
  console.log("  (none)");
} else {
  Object.entries(stats.byLocation)
    .sort((a, b) => b[1] - a[1])
    .forEach(([location, count]) => {
      const percentage = ((count / stats.total) * 100).toFixed(1);
      console.log(`  ${location.padEnd(20)} ${count.toString().padStart(4)} (${percentage}%)`);
    });
}
console.log("");

// Contact information
console.log("Contact Information:");
const emailRate = stats.total > 0 ? ((stats.withEmail / stats.total) * 100).toFixed(1) : 0;
const linkedInRate = stats.total > 0 ? ((stats.withLinkedIn / stats.total) * 100).toFixed(1) : 0;
const bothRate = stats.total > 0 ? ((stats.withBoth / stats.total) * 100).toFixed(1) : 0;
const exportRate = stats.total > 0 ? ((stats.exported / stats.total) * 100).toFixed(1) : 0;

console.log(`  With Email:        ${stats.withEmail.toString().padStart(4)} (${emailRate}%)`);
console.log(`  With LinkedIn:     ${stats.withLinkedIn.toString().padStart(4)} (${linkedInRate}%)`);
console.log(`  With Both:         ${stats.withBoth.toString().padStart(4)} (${bothRate}%)`);
console.log(`  Exported:          ${stats.exported.toString().padStart(4)} (${exportRate}%)`);
console.log("");

// Date range
if (stats.dateRange.earliest) {
  console.log("Date Range:");
  console.log(`  Earliest: ${stats.dateRange.earliest}`);
  console.log(`  Latest:   ${stats.dateRange.latest}`);
  console.log("");
}

// Detailed breakdown if requested
if (detailed && businesses.length > 0) {
  console.log("Detailed Breakdown:");
  console.log("-".repeat(60));
  
  // Email sources
  const emailSources = {};
  businesses.forEach(record => {
    if (record.business.emailSource) {
      emailSources[record.business.emailSource] = (emailSources[record.business.emailSource] || 0) + 1;
    }
  });
  
  if (Object.keys(emailSources).length > 0) {
    console.log("\nEmail Sources:");
    Object.entries(emailSources)
      .sort((a, b) => b[1] - a[1])
      .forEach(([source, count]) => {
        console.log(`  ${source.padEnd(20)} ${count}`);
      });
  }
  
  // Export destinations
  const exportDestinations = {};
  businesses.forEach(record => {
    if (record.exportedTo && record.exportedTo.length > 0) {
      record.exportedTo.forEach(dest => {
        exportDestinations[dest] = (exportDestinations[dest] || 0) + 1;
      });
    }
  });
  
  if (Object.keys(exportDestinations).length > 0) {
    console.log("\nExport Destinations:");
    Object.entries(exportDestinations)
      .sort((a, b) => b[1] - a[1])
      .forEach(([dest, count]) => {
        console.log(`  ${dest.padEnd(20)} ${count}`);
      });
  }
  
  // Revenue bands
  const revenueBands = {};
  businesses.forEach(record => {
    if (record.business.revenueBand) {
      revenueBands[record.business.revenueBand] = (revenueBands[record.business.revenueBand] || 0) + 1;
    }
  });
  
  if (Object.keys(revenueBands).length > 0) {
    console.log("\nRevenue Bands:");
    Object.entries(revenueBands)
      .sort((a, b) => b[1] - a[1])
      .forEach(([band, count]) => {
        console.log(`  ${band.padEnd(20)} ${count}`);
      });
  }
  
  console.log("");
}

console.log("=".repeat(60));
