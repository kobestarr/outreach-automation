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
 *   node export-campaign.js --campaign=ufh-football-clubs --has-email --clean  # Filter junk emails + non-relevant businesses
 *   node export-campaign.js --campaign=ufh-football-clubs --format=mailead --has-email --clean  # Mailead-ready CSV
 */

const path = require('path');
const fs = require('fs');
const { initDatabase, loadBusinesses, listCampaigns, getBusinessStats, closeDatabase } = require('./ksd/local-outreach/orchestrator/modules/database');

// --- Junk email / data quality filters ---

const JUNK_EMAIL_PATTERNS = [
  /@sentry-next\.wixpress\.com$/i,
  /@sentry\.io$/i,
  /@ingest\.\w+\.sentry\.io$/i,
  /@group\.calendar\.google\.com$/i,
  /^example@/i,
  /\[emailprotected\]/i,
  /@sentry\.wixpress\.com$/i,
  /^noreply@/i,
  /^no-reply@/i,
  /^donotreply@/i,
  /^skipped@/i,
  /^6AEMail/i,  // broken Cloudflare email obfuscation
  /^email@email\.com$/i,
  /^test@/i,
];

const JUNK_NAME_PATTERNS = [
  /^club app pitchero$/i,
  /^wix get$/i,
  /^official tyre$/i,
  /^holiday courses$/i,
  /^with powerleague$/i,
  /^golf societies$/i,
  /^club welfare$/i,
  /pitchero/i,
  /^smith welfare$/i,
  /^lewis fox behind$/i,
];

// Keywords in business name that indicate non-football businesses
const NON_FOOTBALL_NAME_KEYWORDS = [
  'golf', 'cricket', 'rugby', 'chess', 'netball', 'cheer gym', 'cheerleading',
  'gymnastics', 'miniature railway', 'leisure centre', 'leisure center',
  'high school', 'performing arts college', 'workmen\'s club',
  'chess challenge', 'coaching manual', 'argos', 'jd sports', 'sports direct',
  'adidas', 'nike store', 'premier inn', 'marriott', 'travelodge',
  'wetherspoon', 'bowling club', 'boxing', 'karate', 'judo', 'taekwondo',
  'swimming', 'tennis club', 'basketball', 'padel', 'pickleball',
];

// Google Maps categories that are clearly not football clubs
const NON_FOOTBALL_CATEGORIES = [
  'primary school', 'secondary school', 'high school', 'middle school',
  'college', 'university', 'community school', 'catholic school', 'general education',
  'pub', 'restaurant', 'bar', 'sports bar', 'live music venue', 'pool hall',
  'bed & breakfast', 'self-catering', 'hotel', 'guest house', 'serviced accommodation',
  'sportswear store', 'sporting goods store', 'uniform store', 'clothing store',
  'soccer store', 'golf shop', 'sports memorabilia',
  'park', 'playground', 'zoo', 'tourist attraction', 'historical landmark',
  'indoor playground', 'video arcade', 'shopping mall', 'print shop',
  'rugby club', 'rugby league club', 'cricket club', 'bowling club',
  'boxing club', 'martial arts school', 'martial arts club', 'gymnastics club',
  'tennis club', 'basketball club', 'padel club', 'dance school',
  'mosque', 'church', 'council', 'civic center',
  'software company', 'corporate office', 'consultant', 'recruiter',
  'physical therapist', 'sports injury clinic', 'fitness center',
  'conservative club', 'social club', 'function room',
  'event management', 'event venue', 'arena', 'stadium',
  'store', 'shop', 'training provider', 'preschool',
  'sportwear manufacturer', 'baseball',
  'hockey club', 'miniature golf', 'equestrian', 'golf club',
  'podiatrist', 'e-commerce', 'psychologist', 'entertainment agency',
  'tennis instructor', 'sport tour agency', 'children\'s cafe',
];

function isJunkEmail(email) {
  if (!email) return false;
  return JUNK_EMAIL_PATTERNS.some(p => p.test(email));
}

function isJunkContactName(firstName, lastName) {
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (!fullName) return false;
  return JUNK_NAME_PATTERNS.some(p => p.test(fullName));
}

function isNonFootballBusiness(name, category) {
  const lowerName = (name || '').toLowerCase();
  const lowerCat = (category || '').toLowerCase();

  // Check name keywords
  if (NON_FOOTBALL_NAME_KEYWORDS.some(kw => lowerName.includes(kw))) return true;

  // Check category
  if (NON_FOOTBALL_CATEGORIES.some(kw => lowerCat.includes(kw))) return true;

  return false;
}

function cleanBusiness(b) {
  const biz = b.business || {};
  const email = biz.ownerEmail || biz.email || '';
  const name = biz.name || biz.businessName || '';
  const category = biz.category || '';

  // Check for junk email
  if (isJunkEmail(email)) return null;

  // Check for non-football business
  if (isNonFootballBusiness(name, category)) return null;

  // Clean garbage contact names (blank them out rather than reject the business)
  if (isJunkContactName(biz.ownerFirstName, biz.ownerLastName)) {
    biz.ownerFirstName = '';
    biz.ownerLastName = '';
  }

  return b;
}

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
const CLEAN = hasFlag('clean');

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

  // Apply data quality cleanup
  let cleanedCount = 0;
  let junkEmailCount = 0;
  let nonRelevantCount = 0;
  if (CLEAN) {
    const beforeCount = businesses.length;
    businesses = businesses.map(b => {
      const biz = b.business || {};
      const email = biz.ownerEmail || biz.email || '';
      const name = biz.name || biz.businessName || '';
      const category = biz.category || '';

      if (isJunkEmail(email)) { junkEmailCount++; return null; }
      if (isNonFootballBusiness(name, category)) { nonRelevantCount++; return null; }

      // Clean garbage contact names
      if (isJunkContactName(biz.ownerFirstName, biz.ownerLastName)) {
        biz.ownerFirstName = '';
        biz.ownerLastName = '';
        cleanedCount++;
      }
      return b;
    }).filter(Boolean);
  }

  console.log(`\n=== Export: ${CAMPAIGN} ===`);
  console.log(`  Records: ${businesses.length} (of ${allBusinesses.length} in campaign)`);
  console.log(`  Format: ${FORMAT}`);
  if (HAS_EMAIL) console.log('  Filter: has email');
  if (HAS_PHONE) console.log('  Filter: has phone');
  if (CATEGORY) console.log(`  Filter: category contains "${CATEGORY}"`);
  if (CLEAN) {
    console.log(`  Clean mode: removed ${junkEmailCount} junk emails, ${nonRelevantCount} non-relevant businesses, blanked ${cleanedCount} garbage names`);
  }
  console.log('');

  if (businesses.length === 0) {
    console.log('No businesses match the filters.');
    closeDatabase();
    return;
  }

  if (FORMAT === 'csv') {
    exportCSV(businesses);
  } else if (FORMAT === 'mailead') {
    exportMailead(businesses);
  } else if (FORMAT === 'lemlist') {
    if (!LEMLIST_CAMPAIGN_ID) {
      console.error('ERROR: --campaign-id=<lemlist_campaign_id> required for Lemlist export.');
      process.exit(1);
    }
    await exportLemlist(businesses);
  } else {
    console.error(`ERROR: Unknown format "${FORMAT}". Use csv, mailead, or lemlist.`);
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

function exportMailead(businesses) {
  // Mailead uses simple CSV: email, first_name, last_name, company_name, custom fields
  const headers = [
    'email', 'first_name', 'last_name', 'company_name', 'phone', 'website', 'category', 'postcode'
  ];

  const rows = businesses.map(b => {
    const biz = b.business || {};
    return [
      escapeCsv(biz.ownerEmail || biz.email || ''),
      escapeCsv(biz.ownerFirstName || ''),
      escapeCsv(biz.ownerLastName || ''),
      escapeCsv(biz.name || biz.businessName || ''),
      escapeCsv(biz.phone || ''),
      escapeCsv(biz.website || ''),
      escapeCsv(biz.category || ''),
      escapeCsv(biz.postcode || b.postcode || ''),
    ];
  });

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `${CAMPAIGN}-mailead-${timestamp}.csv`;
  const outputPath = path.join(__dirname, 'exports', filename);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, csv);

  console.log(`Mailead CSV exported: exports/${filename}`);
  console.log(`  ${businesses.length} rows`);

  // Quick stats
  const withName = businesses.filter(b => b.business?.ownerFirstName).length;
  const withPhone = businesses.filter(b => b.business?.phone).length;
  console.log(`  With contact name: ${withName} | With phone: ${withPhone}`);
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
