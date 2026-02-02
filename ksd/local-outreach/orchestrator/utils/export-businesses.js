#!/usr/bin/env node
/**
 * Export Businesses Utility
 * Export stored business data to CSV or JSON
 */

const fs = require("fs");
const path = require("path");
const { loadBusinesses } = require("../modules/data-storage");

// Parse command line arguments
const args = process.argv.slice(2);
const filters = {};
let format = "json";
let outputFile = null;
let includeFields = null;
let excludeFields = null;

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
  } else if (arg === "--format" || arg === "-f") {
    format = args[++i].toLowerCase();
    if (!["json", "csv"].includes(format)) {
      console.error();
      process.exit(1);
    }
  } else if (arg === "--output" || arg === "-o") {
    outputFile = args[++i];
  } else if (arg === "--include") {
    includeFields = args[++i].split(",").map(f => f.trim());
  } else if (arg === "--exclude") {
    excludeFields = args[++i].split(",").map(f => f.trim());
  } else if (arg === "--help" || arg === "-h") {
    console.log();
    process.exit(0);
  }
}

// Load businesses
const businesses = loadBusinesses(filters);

if (businesses.length === 0) {
  console.error("No businesses found matching the criteria.");
  process.exit(1);
}

// Prepare data for export
function prepareBusinessData(record) {
  const b = record.business;
  const data = {
    id: record.id,
    name: b.name || b.businessName,
    location: record.location,
    postcode: record.postcode,
    address: b.address,
    website: b.website,
    phone: b.phone,
    category: b.category,
    rating: b.rating,
    reviewCount: b.reviewCount,
    ownerFirstName: b.ownerFirstName,
    ownerLastName: b.ownerLastName,
    ownerEmail: b.ownerEmail,
    emailSource: b.emailSource,
    emailVerified: b.emailVerified,
    linkedInUrl: b.linkedInUrl,
    estimatedRevenue: b.estimatedRevenue,
    revenueBand: b.revenueBand,
    assignedOfferTier: b.assignedOfferTier,
    setupFee: b.setupFee,
    monthlyPrice: b.monthlyPrice,
    status: record.status,
    enrichedAt: record.enrichedAt,
    exportedTo: record.exportedTo ? record.exportedTo.join("; ") : null,
    exportedAt: record.exportedAt
  };
  
  // Apply field filters
  if (includeFields) {
    const filtered = {};
    includeFields.forEach(field => {
      if (data.hasOwnProperty(field)) {
        filtered[field] = data[field];
      }
    });
    return filtered;
  }
  
  if (excludeFields) {
    excludeFields.forEach(field => {
      delete data[field];
    });
  }
  
  return data;
}

const exportData = businesses.map(prepareBusinessData);

// Generate output
let output;

if (format === "csv") {
  // Convert to CSV
  if (exportData.length === 0) {
    output = "";
  } else {
    const headers = Object.keys(exportData[0]);
    const rows = exportData.map(row => 
      headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) return "";
        const str = String(value);
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        if (str.includes(",") || str.includes(""") || str.includes("
")) {
          return ;
")) {
          return ;
        }
        return str;
      }).join(",")
    );
    output = [headers.join(","), ...rows].join("
");
  }
} else {
  // JSON format
  output = JSON.stringify(exportData, null, 2);
}

// Write output
if (outputFile) {
  fs.writeFileSync(outputFile, output);
  console.log();
} else {
  // Default filename
  const defaultFile = ;
  fs.writeFileSync(defaultFile, output);
  console.log();
}
