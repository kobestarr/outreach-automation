/**
 * Audit Lemlist Campaign Leads
 *
 * Pulls all leads from a Lemlist campaign and audits:
 * - Email quality (format, domain)
 * - Name quality (real name vs "there" vs team fallback)
 * - Merge variable completeness
 * - Duplicates (same email or same company)
 *
 * Usage:
 *   node audit-lemlist-campaign.js                # Audit only (read-only)
 *   node audit-lemlist-campaign.js --verify       # Audit + verify emails via Reoon + remove invalid
 */

const { getLeadsFromCampaign, unsubscribeLead } = require('./shared/outreach-core/export-managers/lemlist-exporter');
const { isValidEmail, isValidPersonName } = require('./shared/outreach-core/validation/data-quality');
const { verifyEmail } = require('./shared/outreach-core/email-verification/reoon-verifier');

const CAMPAIGN_ID = 'cam_bJYSQ4pqMzasQWsRb';
const VERIFY_MODE = process.argv.includes('--verify');
const REMOVE_INVALID = process.argv.includes('--remove');

// Required merge variables for email template
const REQUIRED_MERGE_VARS = [
  'businessType', 'location', 'microOfferPrice',
  'localIntro', 'observationSignal'
];

async function audit() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              LEMLIST CAMPAIGN AUDIT                               ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Campaign: ${CAMPAIGN_ID}`);
  console.log(`Mode: ${VERIFY_MODE ? 'AUDIT + VERIFY + REMOVE INVALID' : 'AUDIT ONLY (read-only)'}\n`);

  // Step 1: Pull all leads
  console.log('Fetching leads from Lemlist...\n');
  let leads;
  try {
    leads = await getLeadsFromCampaign(CAMPAIGN_ID);
  } catch (err) {
    console.error(`Failed to fetch leads: ${err.message}`);
    process.exit(1);
  }

  if (!leads || leads.length === 0) {
    console.log('No leads found in campaign.\n');
    process.exit(0);
  }

  console.log(`Found ${leads.length} leads\n`);

  // Step 2: Audit each lead
  const issues = [];    // { lead, problems: string[] }
  const byCategory = {};
  const byNameQuality = { named: 0, there: 0, team: 0, missing: 0 };
  const emailsSeen = new Map(); // email -> lead for dupe detection
  const companiesSeen = new Map(); // companyName -> [leads]
  let badEmailCount = 0;
  let missingMergeVarCount = 0;
  let duplicateEmailCount = 0;

  for (const lead of leads) {
    const problems = [];
    const email = lead.email || '';
    const firstName = lead.firstName || '';
    const companyName = lead.companyName || '';
    const category = lead.businessType || lead.category || 'unknown';

    // Category tracking
    byCategory[category] = (byCategory[category] || 0) + 1;

    // Name quality
    if (!firstName || firstName.toLowerCase() === 'there') {
      byNameQuality.there++;
      problems.push('No real name (using "there")');
    } else if (firstName.endsWith(' Team')) {
      byNameQuality.team++;
    } else if (isValidPersonName(firstName)) {
      byNameQuality.named++;
    } else {
      byNameQuality.missing++;
      problems.push(`Invalid/suspicious name: "${firstName}"`);
    }

    // Email quality
    if (!email) {
      problems.push('No email address');
      badEmailCount++;
    } else if (!isValidEmail(email)) {
      problems.push(`Bad email format: ${email}`);
      badEmailCount++;
    }

    // Duplicate email check
    if (email) {
      if (emailsSeen.has(email.toLowerCase())) {
        problems.push(`Duplicate email (also on: ${emailsSeen.get(email.toLowerCase()).companyName})`);
        duplicateEmailCount++;
      } else {
        emailsSeen.set(email.toLowerCase(), lead);
      }
    }

    // Company duplicate tracking (not an issue per se, just info for multi-owner)
    if (companyName) {
      if (!companiesSeen.has(companyName.toLowerCase())) {
        companiesSeen.set(companyName.toLowerCase(), []);
      }
      companiesSeen.get(companyName.toLowerCase()).push(lead);
    }

    // Merge variable completeness
    const missingVars = [];
    for (const varName of REQUIRED_MERGE_VARS) {
      if (!lead[varName] || lead[varName] === '') {
        missingVars.push(varName);
      }
    }
    if (missingVars.length > 0) {
      problems.push(`Missing merge vars: ${missingVars.join(', ')}`);
      missingMergeVarCount++;
    }

    if (problems.length > 0) {
      issues.push({ lead, problems });
    }
  }

  // Step 3: Print quality report
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('QUALITY REPORT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`  Total leads:          ${leads.length}`);
  console.log(`  Clean leads:          ${leads.length - issues.length}`);
  console.log(`  Leads with issues:    ${issues.length}\n`);

  console.log('--- Name Quality ---');
  console.log(`  Real names:           ${byNameQuality.named} (${pct(byNameQuality.named, leads.length)})`);
  console.log(`  Team fallback:        ${byNameQuality.team} (${pct(byNameQuality.team, leads.length)})`);
  console.log(`  "there" fallback:     ${byNameQuality.there} (${pct(byNameQuality.there, leads.length)})`);
  console.log(`  Invalid/missing:      ${byNameQuality.missing} (${pct(byNameQuality.missing, leads.length)})\n`);

  console.log('--- Email Quality ---');
  console.log(`  Bad/missing emails:   ${badEmailCount}`);
  console.log(`  Duplicate emails:     ${duplicateEmailCount}\n`);

  console.log('--- Merge Variables ---');
  console.log(`  Missing vars:         ${missingMergeVarCount} leads\n`);

  console.log('--- By Category ---');
  const sortedCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sortedCategories) {
    console.log(`  ${cat.padEnd(30)} ${count}`);
  }
  console.log();

  // Multi-owner businesses
  const multiOwner = [...companiesSeen.entries()].filter(([, leads]) => leads.length > 1);
  if (multiOwner.length > 0) {
    console.log('--- Multi-Contact Businesses ---');
    for (const [company, companyLeads] of multiOwner) {
      console.log(`  ${company} (${companyLeads.length} contacts):`);
      for (const l of companyLeads) {
        console.log(`    - ${l.firstName} ${l.lastName || ''} <${l.email}>`);
      }
    }
    console.log();
  }

  // Issues detail
  if (issues.length > 0) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('FLAGGED LEADS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    for (const { lead, problems } of issues) {
      console.log(`  ${lead.companyName || '(no company)'} — ${lead.email || '(no email)'}`);
      for (const p of problems) {
        console.log(`    - ${p}`);
      }
      console.log();
    }
  }

  // Step 4: Email verification (if --verify flag)
  if (VERIFY_MODE) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('EMAIL VERIFICATION (via Reoon)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    let valid = 0;
    let risky = 0;
    let invalid = 0;
    let skippedWebsite = 0;
    let errors = 0;
    const invalidLeads = [];

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      const email = lead.email;
      if (!email) continue;

      const label = `[${i + 1}/${leads.length}] ${(lead.companyName || '').substring(0, 35).padEnd(35)}`;

      // Smart verification: website-scraped emails are auto-valid
      // Check if email matches domain of companyDomain (likely scraped from website)
      const emailDomain = email.split('@')[1]?.toLowerCase();
      const companyDomain = (lead.companyDomain || '').toLowerCase();
      const isWebsiteEmail = companyDomain && emailDomain && emailDomain === companyDomain;

      if (isWebsiteEmail) {
        console.log(`  OK    ${label} ${email} (website email — auto-valid)`);
        skippedWebsite++;
        valid++;
        continue;
      }

      // Verify via Reoon
      try {
        const result = await verifyEmail(email, 'quick');

        if (result.isValid) {
          console.log(`  OK    ${label} ${email} (${result.status})`);
          valid++;
        } else if (result.status === 'risky' || result.status === 'unknown') {
          console.log(`  WARN  ${label} ${email} (${result.status})`);
          risky++;
        } else {
          console.log(`  BAD   ${label} ${email} (${result.status})`);
          invalid++;
          invalidLeads.push(lead);
        }

        // Small delay between API calls
        await new Promise(r => setTimeout(r, 250));
      } catch (err) {
        console.log(`  ERR   ${label} ${email} — ${err.message}`);
        errors++;
      }
    }

    console.log('\n--- Verification Summary ---');
    console.log(`  Valid:                ${valid} (${skippedWebsite} auto-valid from website)`);
    console.log(`  Risky:               ${risky}`);
    console.log(`  Invalid:             ${invalid}`);
    console.log(`  Errors:              ${errors}\n`);

    // Remove invalid leads if --remove flag
    if (REMOVE_INVALID && invalidLeads.length > 0) {
      console.log('--- Removing Invalid Leads ---\n');
      let removed = 0;
      for (const lead of invalidLeads) {
        try {
          await unsubscribeLead(CAMPAIGN_ID, lead.email);
          console.log(`  Removed: ${lead.email} (${lead.companyName})`);
          removed++;
          await new Promise(r => setTimeout(r, 300));
        } catch (err) {
          console.log(`  Failed to remove ${lead.email}: ${err.message}`);
        }
      }
      console.log(`\n  Removed ${removed}/${invalidLeads.length} invalid leads\n`);
    } else if (invalidLeads.length > 0) {
      console.log(`  ${invalidLeads.length} invalid leads found. Run with --verify --remove to unsubscribe them.\n`);
    }

    // Final go/no-go
    const sendReady = valid + risky;
    const bounceRisk = invalid / leads.length * 100;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('GO / NO-GO RECOMMENDATION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`  Send-ready leads:    ${sendReady}`);
    console.log(`  Est. bounce risk:    ${bounceRisk.toFixed(1)}%`);

    if (bounceRisk < 5) {
      console.log('\n  >>> GO — Bounce risk is acceptable. Campaign is ready to send.\n');
    } else if (bounceRisk < 10) {
      console.log('\n  >>> CAUTION — Bounce risk is elevated. Consider removing risky leads.\n');
    } else {
      console.log('\n  >>> NO-GO — Bounce risk too high. Remove invalid emails first.\n');
    }
  } else {
    // No verification — print recommendation
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('RECOMMENDATION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (badEmailCount === 0 && duplicateEmailCount === 0 && missingMergeVarCount === 0) {
      console.log('  Data quality looks good. Run with --verify to check email deliverability.\n');
    } else {
      console.log('  Issues found. Review flagged leads above.');
      console.log('  Run with --verify to check email deliverability.\n');
    }
  }

  // Print all leads for reference
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('ALL LEADS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (let i = 0; i < leads.length; i++) {
    const l = leads[i];
    const name = `${l.firstName || ''} ${l.lastName || ''}`.trim() || '(no name)';
    const cat = l.businessType || l.category || '';
    console.log(`  ${String(i + 1).padStart(3)}. ${name.padEnd(25)} ${(l.email || '').padEnd(45)} ${(l.companyName || '').substring(0, 35)}  [${cat}]`);
  }
  console.log();
}

function pct(n, total) {
  if (total === 0) return '0%';
  return `${Math.round(n / total * 100)}%`;
}

audit().catch(err => {
  console.error('Audit failed:', err.message);
  process.exit(1);
});
