/**
 * Email Improvement Pipeline
 *
 * Three-stage approach to find/upgrade emails for businesses:
 *   1. LLM extraction from website (auto-valid — real published email)
 *   2. Pattern guess + Reoon verify (first@domain, first.last@domain, etc.)
 *   3. Icypeas email finder API (last resort, 100/day limit)
 *
 * Usage:
 *   node improve-emails.js                  # Full pipeline (all 3 stages)
 *   node improve-emails.js --llm-only       # Just LLM extraction
 *   node improve-emails.js --patterns-only  # Just pattern guessing + Reoon
 *   node improve-emails.js --icypeas-only   # Just Icypeas
 *   node improve-emails.js --dry-run        # Show what would be processed
 *   node improve-emails.js --limit=20       # Limit to first N businesses
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const { fetchWebsiteText, llmExtractOwners } = require('./shared/outreach-core/enrichment/llm-owner-extractor');
const { verifyEmail, getQuotaRemaining: getReoonQuota } = require('./shared/outreach-core/email-verification/reoon-verifier');
const { findEmail } = require('./shared/outreach-core/email-discovery/icypeas-finder');
const { closeBrowser } = require('./shared/outreach-core/enrichment/browser-fetcher');

const DB_PATH = './ksd/local-outreach/orchestrator/data/businesses.db';

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LLM_ONLY = args.includes('--llm-only');
const PATTERNS_ONLY = args.includes('--patterns-only');
const ICYPEAS_ONLY = args.includes('--icypeas-only');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1]) : null;

const RUN_LLM = !PATTERNS_ONLY && !ICYPEAS_ONLY;
const RUN_PATTERNS = !LLM_ONLY && !ICYPEAS_ONLY;
const RUN_ICYPEAS = !LLM_ONLY && !PATTERNS_ONLY;

// Stats
const STATS = {
  llm: { processed: 0, emailsFound: 0, upgraded: 0, inputTokens: 0, outputTokens: 0 },
  patterns: { tested: 0, verified: 0, found: 0 },
  icypeas: { searched: 0, found: 0 },
  total: { improved: 0 }
};

// Common email patterns to try
const EMAIL_PATTERNS = [
  (f, l, d) => `${f}@${d}`,                    // john@domain.com
  (f, l, d) => `${f}.${l}@${d}`,               // john.smith@domain.com
  (f, l, d) => `${f[0]}${l}@${d}`,             // jsmith@domain.com
  (f, l, d) => `${f}${l}@${d}`,                // johnsmith@domain.com
  (f, l, d) => `${f[0]}.${l}@${d}`,            // j.smith@domain.com
  (f, l, d) => `${l}@${d}`,                    // smith@domain.com
  (f, l, d) => `${f}_${l}@${d}`,               // john_smith@domain.com
];

/**
 * Extract domain from website URL
 */
function getDomain(url) {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Check if an email is generic (info@, hello@, etc.)
 */
function isGenericEmail(email) {
  if (!email) return true;
  const prefix = email.split('@')[0].toLowerCase();
  const genericPrefixes = ['info', 'hello', 'contact', 'enquiries', 'enquiry', 'admin',
    'office', 'sales', 'mail', 'support', 'team', 'help', 'service', 'bookings',
    'booking', 'appointments', 'reception', 'general'];
  return genericPrefixes.some(g => prefix === g || prefix.startsWith(g + '.'));
}

/**
 * Stage 1: LLM email extraction from websites
 */
async function runLlmExtraction(db, businesses) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STAGE 1: LLM EMAIL EXTRACTION (from website text)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Target: businesses with no email OR only generic email, that have a website
  const targets = businesses.filter(b =>
    b.website && (!b.owner_email || isGenericEmail(b.owner_email)) &&
    !b.website.includes('facebook.com') && !b.website.includes('instagram.com')
  );

  console.log(`  Targets: ${targets.length} businesses (no email or generic email)\n`);
  if (DRY_RUN) return;

  for (const biz of targets) {
    const label = biz.name.substring(0, 40).padEnd(40);
    try {
      const text = await fetchWebsiteText(biz.website);
      if (!text) {
        console.log(`  NOFETCH  ${label}`);
        continue;
      }

      const result = await llmExtractOwners(biz.name, text);
      STATS.llm.processed++;
      STATS.llm.inputTokens += result.inputTokens;
      STATS.llm.outputTokens += result.outputTokens;

      // Check if LLM found any emails
      const allEmails = result.emails || [];
      const personalEmails = allEmails.filter(e => e.type === 'personal' && e.email);
      const anyEmails = allEmails.filter(e => e.email);

      // Also check owner-associated emails
      const ownerEmails = (result.owners || []).filter(o => o.email).map(o => ({
        email: o.email, type: 'personal', person: o.name
      }));

      const combined = [...personalEmails, ...ownerEmails, ...anyEmails];
      // Deduplicate
      const seen = new Set();
      const uniqueEmails = combined.filter(e => {
        const lower = e.email.toLowerCase();
        if (seen.has(lower)) return false;
        seen.add(lower);
        return true;
      });

      if (uniqueEmails.length === 0) {
        console.log(`  ---   ${label} no emails found`);
        continue;
      }

      STATS.llm.emailsFound += uniqueEmails.length;

      // Pick the best email: prefer personal, then any non-generic
      const bestEmail = uniqueEmails.find(e => e.type === 'personal' && !isGenericEmail(e.email))
        || uniqueEmails.find(e => !isGenericEmail(e.email))
        || uniqueEmails[0];

      const currentIsGeneric = isGenericEmail(biz.owner_email);
      const newIsPersonal = !isGenericEmail(bestEmail.email);
      const isUpgrade = !biz.owner_email || (currentIsGeneric && newIsPersonal);

      if (isUpgrade) {
        // Update DB
        const updateFields = { owner_email: bestEmail.email, email_source: 'website-llm', email_verified: 1 };

        // If LLM also found owner names and we don't have one
        if (result.owners.length > 0 && (!biz.owner_first_name || biz.owner_first_name === 'there')) {
          const best = result.owners[0];
          const parts = best.name.trim().split(/\s+/);
          updateFields.owner_first_name = parts[0];
          updateFields.owner_last_name = parts.slice(1).join(' ');
        }

        // Store LLM data in business_data
        let businessData = {};
        try { businessData = biz.business_data ? JSON.parse(biz.business_data) : {}; } catch (e) {}
        businessData.llmExtraction = result;

        db.prepare(`
          UPDATE businesses SET
            owner_email = ?, email_source = ?, email_verified = ?,
            owner_first_name = COALESCE(?, owner_first_name),
            owner_last_name = COALESCE(?, owner_last_name),
            business_data = ?, updated_at = ?
          WHERE id = ?
        `).run(
          updateFields.owner_email, updateFields.email_source, updateFields.email_verified,
          updateFields.owner_first_name || null, updateFields.owner_last_name || null,
          JSON.stringify(businessData), new Date().toISOString(), biz.id
        );

        STATS.llm.upgraded++;
        STATS.total.improved++;
        const tag = currentIsGeneric ? 'UPGRADE' : 'NEW   ';
        console.log(`  ${tag} ${label} ${bestEmail.email} (${bestEmail.type}${bestEmail.person ? ', ' + bestEmail.person : ''})`);
      } else {
        console.log(`  KEEP  ${label} existing: ${biz.owner_email} | found: ${bestEmail.email}`);
      }

      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.log(`  ERR   ${label} ${err.message.substring(0, 60)}`);
    }
  }

  try { await closeBrowser(); } catch (e) {}

  const llmCost = (STATS.llm.inputTokens / 1_000_000) * 0.80 + (STATS.llm.outputTokens / 1_000_000) * 4.00;
  console.log(`\n  LLM: ${STATS.llm.processed} processed, ${STATS.llm.emailsFound} emails found, ${STATS.llm.upgraded} upgraded. Cost: $${llmCost.toFixed(3)}`);
}

/**
 * Stage 2: Pattern guessing + Reoon verification
 */
async function runPatternGuessing(db, businesses) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STAGE 2: PATTERN GUESSING + REOON VERIFICATION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Re-read businesses to get updated state after LLM stage
  const fresh = db.prepare(`
    SELECT * FROM businesses
    WHERE owner_first_name IS NOT NULL AND length(owner_first_name) > 0
      AND owner_first_name != 'there'
      AND website IS NOT NULL AND length(website) > 0
      AND (owner_email IS NULL OR length(owner_email) = 0)
    ORDER BY name
  `).all();

  const reoonRemaining = getReoonQuota();
  console.log(`  Targets: ${fresh.length} businesses (have name + website, no email)`);
  console.log(`  Reoon credits remaining: ${reoonRemaining}`);

  // Each business needs up to 7 pattern checks
  const maxBusinesses = Math.floor(reoonRemaining / 3); // Budget ~3 patterns per business (stop on first valid)
  const toProcess = fresh.slice(0, maxBusinesses);
  console.log(`  Will process: ${toProcess.length} (budgeting ~3 Reoon checks each)\n`);

  if (DRY_RUN) {
    for (const biz of toProcess.slice(0, 10)) {
      const domain = getDomain(biz.website);
      const first = (biz.owner_first_name || '').toLowerCase();
      const last = (biz.owner_last_name || '').toLowerCase();
      if (domain && first) {
        const patterns = EMAIL_PATTERNS.filter(p => !last || p.length <= 3).slice(0, 3).map(p => {
          try { return p(first, last || first, domain); } catch { return null; }
        }).filter(Boolean);
        console.log(`  ${biz.name.substring(0,35).padEnd(35)} ${biz.owner_first_name} ${biz.owner_last_name || ''} → ${patterns.join(', ')}`);
      }
    }
    return;
  }

  for (const biz of toProcess) {
    const label = biz.name.substring(0, 40).padEnd(40);
    const domain = getDomain(biz.website);
    const first = (biz.owner_first_name || '').toLowerCase().replace(/[^a-z]/g, '');
    const last = (biz.owner_last_name || '').toLowerCase().replace(/[^a-z]/g, '');

    if (!domain || !first) {
      console.log(`  SKIP  ${label} (no domain or first name)`);
      continue;
    }

    // Generate candidate emails
    const candidates = EMAIL_PATTERNS
      .map(pattern => {
        try { return pattern(first, last || first, domain); } catch { return null; }
      })
      .filter(Boolean)
      .filter(e => e.includes('@') && e.length > 5);

    // Deduplicate
    const unique = [...new Set(candidates)];

    let found = false;
    for (const candidate of unique) {
      try {
        STATS.patterns.tested++;
        const result = await verifyEmail(candidate, 'quick');
        STATS.patterns.verified++;

        if (result.isValid || result.status === 'safe') {
          // Found a valid personal email
          db.prepare(`
            UPDATE businesses SET
              owner_email = ?, email_source = ?, email_verified = 1, updated_at = ?
            WHERE id = ?
          `).run(candidate, 'pattern-reoon', new Date().toISOString(), biz.id);

          STATS.patterns.found++;
          STATS.total.improved++;
          console.log(`  FOUND ${label} ${candidate} (verified by Reoon)`);
          found = true;
          break;
        }

        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        if (err.message.includes('daily limit')) {
          console.log(`\n  Reoon daily limit reached — stopping pattern stage`);
          return;
        }
        // Individual verification error, try next pattern
      }
    }

    if (!found) {
      console.log(`  ---   ${label} no valid pattern found (tried ${unique.length})`);
    }
  }

  console.log(`\n  Patterns: ${STATS.patterns.tested} tested, ${STATS.patterns.verified} verified, ${STATS.patterns.found} valid emails found`);
}

/**
 * Stage 3: Icypeas email finder
 */
async function runIcypeasFinder(db, businesses) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STAGE 3: ICYPEAS EMAIL FINDER');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Re-read: businesses with name + website but still no email after stages 1-2
  const fresh = db.prepare(`
    SELECT * FROM businesses
    WHERE owner_first_name IS NOT NULL AND length(owner_first_name) > 0
      AND owner_first_name != 'there'
      AND owner_last_name IS NOT NULL AND length(owner_last_name) > 0
      AND website IS NOT NULL AND length(website) > 0
      AND (owner_email IS NULL OR length(owner_email) = 0)
    ORDER BY name
  `).all();

  console.log(`  Targets: ${fresh.length} businesses (have full name + website, still no email)`);
  console.log(`  Icypeas limit: 100/day\n`);

  const toProcess = fresh.slice(0, 100); // Respect daily limit

  if (DRY_RUN) {
    for (const biz of toProcess.slice(0, 10)) {
      const domain = getDomain(biz.website);
      console.log(`  ${biz.name.substring(0,35).padEnd(35)} ${biz.owner_first_name} ${biz.owner_last_name} @ ${domain}`);
    }
    return;
  }

  for (const biz of toProcess) {
    const label = biz.name.substring(0, 40).padEnd(40);
    const domain = getDomain(biz.website);

    if (!domain) {
      console.log(`  SKIP  ${label} (no domain)`);
      continue;
    }

    try {
      STATS.icypeas.searched++;
      const result = await findEmail({
        firstName: biz.owner_first_name,
        lastName: biz.owner_last_name,
        domainOrCompany: domain
      });

      if (result.emails && result.emails.length > 0) {
        const best = result.emails.sort((a, b) => (b.certainty || 0) - (a.certainty || 0))[0];

        db.prepare(`
          UPDATE businesses SET
            owner_email = ?, email_source = ?, email_verified = 0, updated_at = ?
          WHERE id = ?
        `).run(best.email, 'icypeas', new Date().toISOString(), biz.id);

        STATS.icypeas.found++;
        STATS.total.improved++;
        console.log(`  FOUND ${label} ${best.email} (certainty: ${best.certainty || 'unknown'})`);
      } else {
        console.log(`  ---   ${label} not found`);
      }

      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      if (err.message.includes('daily limit')) {
        console.log(`\n  Icypeas daily limit reached — stopping`);
        return;
      }
      console.log(`  ERR   ${label} ${err.message.substring(0, 60)}`);
    }
  }

  console.log(`\n  Icypeas: ${STATS.icypeas.searched} searched, ${STATS.icypeas.found} found`);
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              EMAIL IMPROVEMENT PIPELINE                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');

  const db = new Database(DB_PATH);

  // Get initial state
  let query = `SELECT * FROM businesses WHERE website IS NOT NULL AND length(website) > 0 ORDER BY name`;
  if (LIMIT) query = query.replace('ORDER BY', `ORDER BY`) + ` LIMIT ${LIMIT}`;
  const businesses = db.prepare(query).all();

  const withEmail = businesses.filter(b => b.owner_email && b.owner_email.length > 0);
  const generic = withEmail.filter(b => isGenericEmail(b.owner_email));
  const personal = withEmail.filter(b => !isGenericEmail(b.owner_email));
  const noEmail = businesses.filter(b => !b.owner_email || b.owner_email.length === 0);

  console.log(`\n  BEFORE: ${businesses.length} businesses with websites`);
  console.log(`    Personal email:  ${personal.length}`);
  console.log(`    Generic email:   ${generic.length}`);
  console.log(`    No email:        ${noEmail.length}`);
  if (DRY_RUN) console.log(`\n  (DRY RUN — no changes will be made)`);

  // Run stages
  if (RUN_LLM) await runLlmExtraction(db, businesses);
  if (RUN_PATTERNS) await runPatternGuessing(db, businesses);
  if (RUN_ICYPEAS) await runIcypeasFinder(db, businesses);

  // Final state
  const afterBiz = db.prepare(`SELECT * FROM businesses WHERE website IS NOT NULL AND length(website) > 0`).all();
  const afterPersonal = afterBiz.filter(b => b.owner_email && !isGenericEmail(b.owner_email));
  const afterGeneric = afterBiz.filter(b => b.owner_email && isGenericEmail(b.owner_email));
  const afterNone = afterBiz.filter(b => !b.owner_email || b.owner_email.length === 0);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n  BEFORE → AFTER`);
  console.log(`    Personal email:  ${personal.length} → ${afterPersonal.length} (+${afterPersonal.length - personal.length})`);
  console.log(`    Generic email:   ${generic.length} → ${afterGeneric.length} (${afterGeneric.length - generic.length >= 0 ? '+' : ''}${afterGeneric.length - generic.length})`);
  console.log(`    No email:        ${noEmail.length} → ${afterNone.length} (${afterNone.length - noEmail.length >= 0 ? '+' : ''}${afterNone.length - noEmail.length})`);
  console.log(`\n  Total improved: ${STATS.total.improved}`);

  if (STATS.llm.processed > 0) {
    const llmCost = (STATS.llm.inputTokens / 1_000_000) * 0.80 + (STATS.llm.outputTokens / 1_000_000) * 4.00;
    console.log(`  LLM cost: $${llmCost.toFixed(3)} (${STATS.llm.processed} processed)`);
  }
  if (STATS.patterns.verified > 0) {
    console.log(`  Reoon credits used: ${STATS.patterns.verified}`);
  }
  if (STATS.icypeas.searched > 0) {
    console.log(`  Icypeas credits used: ${STATS.icypeas.searched}`);
  }

  console.log();
  db.close();
}

main().catch(err => {
  console.error('Email improvement failed:', err);
  process.exit(1);
});
