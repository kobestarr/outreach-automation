#!/usr/bin/env node

/**
 * Universal Campaign Export Script
 *
 * Export businesses filtered by campaign to CSV or Lemlist.
 *
 * Usage:
 *   node export-campaign.js --list                          # List all campaigns
 *   node export-campaign.js --campaign=ufh-football-clubs   # Export as CSV (default)
 *   node export-campaign.js --campaign=ksd-bramhall-SK7 --format=csv
 *   node export-campaign.js --campaign=ksd-bramhall-SK7 --format=lemlist --campaign-id=cam_xxx
 *   node export-campaign.js --campaign=ufh-football-clubs --has-email   # Only with emails
 *   node export-campaign.js --campaign=ufh-football-clubs --has-phone   # Only with phones
 */

const path = require('path');
const fs = require('fs');
const { initDatabase, loadBusinesses, listCampaigns, getBusinessStats, closeDatabase } = require('./ksd/local-outreach/orchestrator/modules/database');

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const LIST_MODE = hasFlag('list');
const CAMPAIGN = getArg('campaign');
const FORMAT = getArg('format') || 'csv';
const LEMLIST_CAMPAIGN_ID = getArg('campaign-id');
const HAS_EMAIL = hasFlag('has-email');
const HAS_PHONE = hasFlag('has-phone');
const CATEGORY = getArg('category');

async function main() {
  initDatabase();

  // List mode — show all campaigns with counts
  if (LIST_MODE) {
    const campaigns = listCampaigns();
    console.log('\n=== Campaigns in Database ===\n');
    if (campaigns.length === 0) {
      console.log('  No campaigns found.');
    } else {
      for (const campaign of campaigns) {
        const stats = getBusinessStats({ campaign });
        console.log(`  ${campaign}`);
        console.log(`    Total: ${stats.total} | Email: ${stats.withEmail} | Exported: ${stats.exported}`);
      }
    }
    console.log('');
    closeDatabase();
    return;
  }

  if (!CAMPAIGN) {
    console.error('ERROR: --campaign=<name> is required. Use --list to see available campaigns.');
    process.exit(1);
  }

  // Load businesses for this campaign
  const filters = { campaign: CAMPAIGN };
  if (HAS_EMAIL) filters.hasEmail = true;
  const allBusinesses = loadBusinesses(filters);

  // Apply additional filters
  let businesses = allBusinesses;
  if (HAS_PHONE) {
    businesses = businesses.filter(b => b.business?.phone);
  }
  if (CATEGORY) {
    businesses = businesses.filter(b => (b.business?.category || '').toLowerCase().includes(CATEGORY.toLowerCase()));
  }

  console.log(`\n=== Export: ${CAMPAIGN} ===`);
  console.log(`  Records: ${businesses.length} (of ${allBusinesses.length} in campaign)`);
  console.log(`  Format: ${FORMAT}`);
  if (HAS_EMAIL) console.log('  Filter: has email');
  if (HAS_PHONE) console.log('  Filter: has phone');
  if (CATEGORY) console.log(`  Filter: category contains "${CATEGORY}"`);
  console.log('');

  if (businesses.length === 0) {
    console.log('No businesses match the filters.');
    closeDatabase();
    return;
  }

  if (FORMAT === 'csv') {
    exportCSV(businesses);
  } else if (FORMAT === 'lemlist') {
    if (!LEMLIST_CAMPAIGN_ID) {
      console.error('ERROR: --campaign-id=<lemlist_campaign_id> required for Lemlist export.');
      process.exit(1);
    }
    await exportLemlist(businesses);
  } else {
    console.error(`ERROR: Unknown format "${FORMAT}". Use csv or lemlist.`);
    process.exit(1);
  }

  closeDatabase();
}

function exportCSV(businesses) {
  const headers = [
    'name', 'category', 'address', 'postcode', 'phone', 'website',
    'email', 'email_source', 'email_verified',
    'contact_first_name', 'contact_last_name',
    'rating', 'reviews',
    'revenue_band', 'tier',
    'campaigns'
  ];

  const rows = businesses.map(b => {
    const biz = b.business || {};
    return [
      escapeCsv(biz.name || biz.businessName || ''),
      escapeCsv(biz.category || ''),
      escapeCsv(biz.address || b.postcode || ''),
      escapeCsv(biz.postcode || b.postcode || ''),
      escapeCsv(biz.phone || ''),
      escapeCsv(biz.website || ''),
      escapeCsv(biz.ownerEmail || biz.email || ''),
      escapeCsv(biz.emailSource || ''),
      biz.emailVerified ? 'yes' : 'no',
      escapeCsv(biz.ownerFirstName || ''),
      escapeCsv(biz.ownerLastName || ''),
      biz.rating || '',
      biz.reviewCount || '',
      escapeCsv(biz.revenueBand || ''),
      biz.assignedOfferTier || '',
      escapeCsv(Array.isArray(biz.campaigns) ? biz.campaigns.join(';') : (CAMPAIGN || '')),
    ];
  });

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `${CAMPAIGN}-${timestamp}.csv`;
  const outputPath = path.join(__dirname, 'exports', filename);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, csv);

  console.log(`CSV exported: exports/${filename}`);
  console.log(`  ${businesses.length} rows, ${headers.length} columns`);

  // Quick stats
  const withEmail = businesses.filter(b => b.business?.ownerEmail || b.business?.email).length;
  const withPhone = businesses.filter(b => b.business?.phone).length;
  const withName = businesses.filter(b => b.business?.ownerFirstName).length;
  console.log(`  With email: ${withEmail} | With phone: ${withPhone} | With contact name: ${withName}`);
}

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function exportLemlist(businesses) {
  // Dynamic import of lemlist exporter
  const { addLeadToCampaign } = require('./shared/outreach-core/export-managers/lemlist-exporter');

  let exported = 0;
  let skipped = 0;
  let errors = 0;

  for (const b of businesses) {
    const biz = b.business || {};
    const email = biz.ownerEmail || biz.email;
    if (!email) { skipped++; continue; }

    try {
      const lead = {
        email,
        firstName: biz.ownerFirstName || '',
        lastName: biz.ownerLastName || '',
        companyName: biz.name || biz.businessName || '',
        phone: biz.phone || '',
      };

      // Add merge variables if they exist
      if (biz.mergeVariables) {
        Object.assign(lead, biz.mergeVariables);
      }

      await addLeadToCampaign(LEMLIST_CAMPAIGN_ID, lead);
      exported++;
    } catch (err) {
      if (err.message?.includes('DUPLICATE')) {
        skipped++;
      } else {
        errors++;
        console.error(`  Error exporting ${biz.name}: ${err.message}`);
      }
    }
  }

  console.log(`Lemlist export complete: ${exported} exported, ${skipped} skipped, ${errors} errors`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
