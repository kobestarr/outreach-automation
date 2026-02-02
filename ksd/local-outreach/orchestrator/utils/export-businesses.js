#!/usr/bin/env node
const fs = require('fs');
const { loadBusinesses } = require('../modules/data-storage');

const args = process.argv.slice(2);
const filters = {};
let format = 'json';
let outputFile = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--location' || arg === '-l') filters.location = args[++i];
  else if (arg === '--postcode' || arg === '-p') filters.postcode = args[++i];
  else if (arg === '--status' || arg === '-s') filters.status = args[++i];
  else if (arg === '--tier' || arg === '-t') filters.tier = args[++i];
  else if (arg === '--has-email') filters.hasEmail = true;
  else if (arg === '--has-linkedin') filters.hasLinkedIn = true;
  else if (arg === '--format' || arg === '-f') format = args[++i].toLowerCase();
  else if (arg === '--output' || arg === '-o') outputFile = args[++i];
  else if (arg === '--help' || arg === '-h') {
    console.log('Export Businesses Utility - Usage: node export-businesses.js [options]');
    process.exit(0);
  }
}

const businesses = loadBusinesses(filters);
if (businesses.length === 0) {
  console.error('No businesses found');
  process.exit(1);
}

function prepareData(record) {
  const b = record.business;
  return {
    id: record.id,
    name: b.name || b.businessName,
    location: record.location,
    postcode: record.postcode,
    address: b.address,
    website: b.website,
    phone: b.phone,
    category: b.category,
    ownerEmail: b.ownerEmail,
    linkedInUrl: b.linkedInUrl,
    estimatedRevenue: b.estimatedRevenue,
    assignedOfferTier: b.assignedOfferTier,
    status: record.status
  };
}

const exportData = businesses.map(prepareData);
let output;

if (format === 'csv') {
  const headers = Object.keys(exportData[0]);
  const rows = exportData.map(row => headers.map(h => {
    const val = row[h];
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }).join(','));
  output = [headers.join(','), ...rows].join('\n');
} else {
  output = JSON.stringify(exportData, null, 2);
}

const filename = outputFile || 'businesses-' + new Date().toISOString().split('T')[0] + '.' + format;
fs.writeFileSync(filename, output);
console.log('Exported ' + exportData.length + ' businesses to ' + filename);
