const { scrapeGoogleMaps } = require("./modules/google-maps-scraper");
const { scrapeGoogleMapsOutscraper } = require("./modules/google-maps-scraper-outscraper");
const { filterChains } = require("./modules/chain-filter");
const { getOwnerName, getAllOwnersByRegistrationNumber, getAllOwnersByName, getOwnerByRegistrationNumber } = require("./modules/companies-house");
const { discoverEmail } = require("../../../shared/outreach-core/email-discovery");
const { enrichLinkedIn } = require("../../../shared/outreach-core/linkedin-enrichment");
const { estimateRevenue } = require("./modules/revenue-estimator");
const { assignTier } = require("./modules/tier-assigner");
const { detectBarterOpportunity } = require("./modules/barter-detector");
const { generateOutreachContent } = require("../../../shared/outreach-core/content-generation");
const { needsApproval, addToApprovalQueue, loadApprovedTemplates } = require("../../../shared/outreach-core/approval-system/approval-manager");
const { exportToLemlist } = require("../../../shared/outreach-core/export-managers/lemlist-exporter");
const { exportToProsp } = require("../../../shared/outreach-core/export-managers/prosp-exporter");
const { saveBusiness, updateBusiness, loadBusinesses } = require("./modules/database");
const logger = require("../../../shared/outreach-core/logger");
const { scrapeWebsite, parseName } = require("../../../shared/outreach-core/enrichment/website-scraper");
const { extractEmailsFromWebsite } = require('../../../shared/outreach-core/email-discovery/website-email-extractor');
const { extractEmailsFromSocialMedia } = require('../../../shared/outreach-core/email-discovery/social-media-email-extractor');
const { generateEmailPatterns, verifyEmailExists } = require('../../../shared/outreach-core/email-discovery/email-pattern-matcher');
const { isValidPersonName } = require('../../../shared/outreach-core/validation/data-quality');

/**
 * Main enrichment function - now supports multiple owners
 */
async function enrichBusiness(business) {
  const enriched = { ...business };
  const MAX_OWNERS = 5;

  // Step 0: Scrape website for company registration number and owner names
  let websiteData = null;
  if (business.website) {
    try {
      websiteData = await scrapeWebsite(business.website);

      // Store scraped data for debugging
      if (websiteData.registrationNumber) {
        enriched.companyRegistrationNumber = websiteData.registrationNumber;
      }
      if (websiteData.registeredAddress) {
        enriched.registeredAddress = websiteData.registeredAddress;
      }
    } catch (error) {
      logger.error('main', 'Website scraping failed', {
        business: business.name,
        error: error.message
      });
    }
  }

  // Step 1: Collect ALL owners (up to 5) from all sources
  let allOwners = [];

  // Step 1a: Registration number → Companies House (get ALL officers)
  if (websiteData && websiteData.registrationNumber) {
    logger.info('main', 'Using registration number for Companies House lookup (multi-owner)', {
      business: business.name,
      registrationNumber: websiteData.registrationNumber
    });

    const owners = await getAllOwnersByRegistrationNumber(websiteData.registrationNumber, MAX_OWNERS);
    if (owners && owners.length > 0) {
      allOwners = owners;
      logger.info('main', 'Found owners via registration number', {
        business: business.name,
        count: owners.length,
        owners: owners.map(o => o.fullName)
      });
    }
  }

  // Step 1b: If no owners from registration number, try website scraping
  if (allOwners.length === 0 && websiteData && websiteData.ownerNames && websiteData.ownerNames.length > 0) {
    const websiteOwners = websiteData.ownerNames.slice(0, MAX_OWNERS).map(ownerData => {
      const { firstName, lastName } = parseName(ownerData.name);
      return {
        firstName: firstName,
        lastName: lastName,
        fullName: ownerData.name,
        title: ownerData.title,
        source: 'website-scraping'
      };
    }).filter(owner => owner.firstName); // Only keep owners with firstName

    if (websiteOwners.length > 0) {
      allOwners = websiteOwners;
      logger.info('main', 'Found owners via website scraping', {
        business: business.name,
        count: websiteOwners.length,
        owners: websiteOwners.map(o => o.fullName)
      });
    }
  }

  // Step 1c: Fall back to Companies House name search (get ALL officers)
  if (allOwners.length === 0) {
    const owners = await getAllOwnersByName(business.name, business.postcode, MAX_OWNERS);
    if (owners && owners.length > 0) {
      allOwners = owners;
      logger.info('main', 'Found owners via Companies House name search', {
        business: business.name,
        count: owners.length,
        owners: owners.map(o => o.fullName)
      });
    }
  }

  // If still no owners, use company name as fallback
  if (allOwners.length === 0 || !allOwners[0].firstName) {
    logger.warn('main', 'No owner firstName found - using company name as fallback', {
      business: business.name,
      website: business.website
    });

    // Create fallback owner using short company name
    const { getShortNameForTeam } = require('../../../shared/outreach-core/content-generation/company-name-humanizer');
    const companyName = business.businessName || business.name || "Business";
    const shortName = getShortNameForTeam(companyName);

    allOwners = [{
      firstName: `${shortName} Team`, // Include "Team" in firstName for email greeting
      lastName: "", // Empty since full name already in firstName
      fullName: `${shortName} Team`,
      title: null,
      source: 'fallback'
    }];

    enriched.usedFallbackName = true; // Flag for email template

    logger.info('main', 'Using short name for fallback', {
      original: companyName,
      short: shortName,
      fullFallback: `${shortName} Team`
    });
  }

  // Step 2: Set backward-compatible single-owner fields (first owner)
  const firstOwner = allOwners[0];
  enriched.ownerFirstName = firstOwner.firstName;
  enriched.ownerLastName = firstOwner.lastName;
  enriched.ownerFullName = firstOwner.fullName;
  enriched.ownerTitle = firstOwner.title;
  enriched.ownerSource = firstOwner.source;

  // PHASE 1.5: Email Extraction (NEW)
  // Extract emails from website and social media BEFORE owner discovery
  // This ensures we have fallback emails even if owner discovery fails

  // QUOTA PRE-CHECK: Verify sufficient quota before batch operations
  // This prevents partial failures and wasted API calls
  const MIN_REQUIRED_QUOTA = 5; // Minimum credits needed for email verification
  try {
    const { getQuotaRemaining } = require('../../../shared/outreach-core/email-verification/reoon-verifier');
    const quotaRemaining = await getQuotaRemaining();

    if (quotaRemaining < MIN_REQUIRED_QUOTA) {
      logger.warn('main', 'Insufficient Reoon quota - skipping email extraction', {
        business: business.name,
        quotaRemaining,
        minRequired: MIN_REQUIRED_QUOTA
      });
      // Skip email extraction but continue with owner discovery
      enriched.extractedEmails = [];
      enriched._quotaError = {
        code: 'INSUFFICIENT_QUOTA',
        service: 'reoon',
        quotaRemaining,
        minRequired: MIN_REQUIRED_QUOTA
      };
      // Continue with enrichment instead of returning early - other steps may still succeed
    }

    logger.debug('main', 'Quota check passed', {
      business: business.name,
      quotaRemaining
    });
  } catch (error) {
    logger.warn('main', 'Quota check failed - continuing anyway', {
      business: business.name,
      error: error.message
    });
  }

  logger.info('main', 'Starting email extraction phase', {
    business: business.name,
    hasWebsite: !!business.website,
    hasInstagram: !!business.instagramUrl,
    hasFacebook: !!business.facebookUrl
  });

  const discoveredEmails = [];

  // Step 1: Extract from website
  if (business.website) {
    try {
      const websiteEmails = await extractEmailsFromWebsite(business.website);
      discoveredEmails.push(...websiteEmails);

      logger.info('main', 'Website email extraction complete', {
        business: business.name,
        count: websiteEmails.length
        // emails removed for PII compliance - use debug logs if needed
      });
    } catch (error) {
      logger.error('main', 'Website email extraction failed', {
        business: business.name,
        error: error.message
      });
    }
  }

  // Step 2: Extract from social media (DEPRECATED - ToS violations)
  if (discoveredEmails.length === 0 && (business.instagramUrl || business.facebookUrl || business.linkedInUrl)) {
    try {
      // DEPRECATED: Social media scraping disabled due to ToS violations
      // const socialEmails = await extractEmailsFromSocialMedia(business);
      // discoveredEmails.push(...socialEmails);
      const socialEmails = [];

      logger.info('main', 'Skipping social media extraction (deprecated - ToS violations)', {
        business: business.name,
        reason: 'Instagram/Facebook/LinkedIn scraping violates Terms of Service'
      });
    } catch (error) {
      logger.error('main', 'Social media email extraction failed', {
        business: business.name,
        error: error.message
      });
    }
  }

  // Step 3: Pattern matching (if still no emails and have domain)
  if (discoveredEmails.length === 0 && business.website) {
    try {
      const domain = new URL(business.website).hostname;
      const patterns = generateEmailPatterns(domain);

      // Verify patterns with DNS check
      for (const pattern of patterns) {
        const exists = await verifyEmailExists(pattern);
        if (exists) {
          discoveredEmails.push(pattern);
          logger.info('main', 'Pattern-matched email verified', {
            business: business.name,
            email: pattern
          });
          break; // Only take first valid pattern
        }
      }
    } catch (error) {
      logger.error('main', 'Pattern matching failed', {
        business: business.name,
        error: error.message
      });
    }
  }

  // Step 4: Verify all discovered emails with Reoon
  if (discoveredEmails.length > 0) {
    const { verifyEmails } = require('../../../shared/outreach-core/email-verification/reoon-verifier');

    try {
      const verifiedResults = await verifyEmails(discoveredEmails, 'power');

      // Store verified emails in business object for later use
      business.extractedEmails = verifiedResults
        .filter(result => result.isValid)
        .map(result => ({
          email: result.email,
          source: 'website-extraction',
          verified: true,
          verifiedAt: result.verifiedAt
        }));

      logger.info('main', 'Email extraction and verification complete', {
        business: business.name,
        discovered: discoveredEmails.length,
        verified: business.extractedEmails.length
      });

    } catch (error) {
      logger.error('main', 'Email verification failed', {
        business: business.name,
        error: error.message
      });
      business.extractedEmails = [];
    }
  } else {
    business.extractedEmails = [];

    logger.warn('main', 'No emails discovered from website/social media', {
      business: business.name
    });
  }

  // Add 500ms delay to avoid rate limiting
  await new Promise(resolve => setTimeout(resolve, 500));

  // Step 3: Discover emails for ALL owners (Icypeas for first 2, pattern-match for rest)
  const extractDomainSafely = (website) => {
    if (!website || typeof website !== 'string') return null;
    try {
      return new URL(website).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  };

  const domain = extractDomainSafely(business.website);
  const enrichedOwners = [];

  for (let i = 0; i < allOwners.length; i++) {
    // Clone owner object to prevent race conditions during async operations
    const owner = { ...allOwners[i] };
    const useIcypeas = i < 2; // Only use Icypeas for first 2 owners

    logger.info('main', 'Discovering email for owner', {
      business: business.name,
      owner: owner.fullName,
      ownerIndex: i + 1,
      useIcypeas: useIcypeas
    });

    const emailResult = await discoverEmail({
      firstName: owner.firstName,
      lastName: owner.lastName,
      domain: domain,
      website: business.website,
      emailsFromWebsite: business.emailsFromWebsite || [],
      useIcypeas: useIcypeas
    });

    const enrichedOwner = {
      ...owner,
      email: emailResult.email || null,
      emailSource: emailResult.source || null,
      emailVerified: emailResult.verified || false
    };

    enrichedOwners.push(enrichedOwner);

    // CRITICAL FIX: Update business.ownerFirstName with Icypeas data if needed
    // This fixes the "there" fallback issue when Icypeas has the real name
    if (i === 0 && emailResult.icypeasFirstName) {
      // Only update for first owner (backward compatibility)

      // Check if current name is invalid or empty
      const currentNameInvalid = !enriched.ownerFirstName ||
                                 !isValidPersonName(enriched.ownerFirstName);

      if (currentNameInvalid) {
        const oldFirstName = enriched.ownerFirstName;
        enriched.ownerFirstName = emailResult.icypeasFirstName;
        enriched.ownerLastName = emailResult.icypeasLastName || '';
        enriched.ownerFullName = emailResult.icypeasFullName ||
                                `${emailResult.icypeasFirstName} ${emailResult.icypeasLastName || ''}`.trim();

        logger.info('main', 'Updated business names from Icypeas', {
          business: business.name,
          oldFirstName: oldFirstName,
          newFirstName: enriched.ownerFirstName,
          newLastName: enriched.ownerLastName,
          source: 'icypeas'
        });
      } else {
        logger.debug('main', 'Keeping existing valid name over Icypeas name', {
          business: business.name,
          existingName: enriched.ownerFirstName,
          icypeasName: emailResult.icypeasFirstName
        });
      }
    }

    // Log result
    if (emailResult.email) {
      logger.info('main', 'Found email for owner', {
        business: business.name,
        owner: owner.fullName,
        email: emailResult.email,
        source: emailResult.source
      });
    } else {
      logger.warn('main', 'No email found for owner', {
        business: business.name,
        owner: owner.fullName
      });
    }

    // Small delay between email discoveries
    if (i < allOwners.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  // Step 4: Store all owners in enriched business
  enriched.owners = enrichedOwners;

  // Step 5: Set primary email (first owner's email for backward compatibility)
  const firstOwnerWithEmail = enrichedOwners.find(o => o.email);

  if (firstOwnerWithEmail) {
    enriched.ownerEmail = firstOwnerWithEmail.email;
    enriched.emailSource = firstOwnerWithEmail.emailSource;
    enriched.emailVerified = firstOwnerWithEmail.emailVerified;

  } else if (business.extractedEmails && business.extractedEmails.length > 0) {
    // NEW: Use website/social media extracted email
    enriched.ownerEmail = business.extractedEmails[0].email;
    enriched.emailSource = 'website-extraction';
    enriched.emailVerified = business.extractedEmails[0].verified;

    logger.info('main', 'Using extracted email from website/social media', {
      business: business.name,
      email: enriched.ownerEmail
    });

  } else if (business.email) {
    // Fallback to business email from Outscraper (Phase 1)
    enriched.ownerEmail = business.email;
    enriched.emailSource = 'outscraper-business';
    enriched.emailVerified = false; // Outscraper doesn't verify emails

    logger.info('main', 'Using business email from Outscraper as fallback', {
      business: business.name,
      email: business.email
    });

  } else {
    // STILL SKIP if no email at all (neither owner email nor business email)
    logger.warn('main', 'No email found (neither owner email nor business email) - skipping business', {
      business: business.name
    });
    return null; // Signal to skip this business
  }

  // Step 6: LinkedIn enrichment (conditional - for first owner only)
  if (enriched.ownerFirstName) {
    const linkedInResult = await enrichLinkedIn(enriched);
    if (linkedInResult.enriched) {
      enriched.linkedInUrl = linkedInResult.linkedInUrl;
      enriched.linkedInData = linkedInResult.linkedInData;
    }
  }

  // Step 7: Revenue estimation (using Claude/Anthropic)
  const revenueEstimate = await estimateRevenue(enriched);
  enriched.estimatedRevenue = revenueEstimate.estimatedRevenue;
  enriched.revenueBand = revenueEstimate.revenueBand;
  enriched.revenueConfidence = revenueEstimate.confidence;

  // Step 8: Tier assignment
  const tier = assignTier(enriched.estimatedRevenue);
  enriched.assignedOfferTier = tier.tierId;
  enriched.setupFee = tier.setupFee;
  enriched.monthlyPrice = tier.monthlyPrice;
  enriched.ghlOffer = tier.ghlOffer;
  enriched.leadMagnet = tier.leadMagnet;

  // Step 9: Barter detection
  const barter = detectBarterOpportunity(enriched);
  enriched.barterOpportunity = barter;

  return enriched;
}

/**
 * Process businesses from Google Maps
 * @param {string} location - Location name (e.g., "Bramhall")
 * @param {string} postcode - Postcode prefix (e.g., "SK7") to ensure correct location
 * @param {Array<string>} businessTypes - Business type keywords (e.g., ["restaurants", "cafes"])
 * @param {boolean} extractEmails - Whether to extract emails via HasData (default: true)
 * @returns {Promise<Array>} Array of enriched businesses
 */
async function processBusinesses(location, postcode, businessTypes = [], extractEmails = true) {
  const scrapedAt = new Date().toISOString();
  
  // Step 1: Scrape Google Maps (with postcode for accuracy)
  // Try Outscraper first, fallback to HasData if it fails OR returns 0 results
  logger.info('main', `Scraping businesses in ${location}${postcode ? ` (${postcode})` : ""}...`);

  let businesses = [];
  let scraperUsed = null;

  try {
    logger.info('main', 'Trying Outscraper API...');
    businesses = await scrapeGoogleMapsOutscraper(location, postcode, businessTypes, extractEmails);
    scraperUsed = 'outscraper';
    logger.info('main', `Found ${businesses.length} businesses via Outscraper`);

    // If Outscraper returned 0 results, try HasData as backup
    if (businesses.length === 0) {
      logger.info('main', 'Outscraper returned 0 results, trying HasData as backup...');
      try {
        const hasdataResults = await scrapeGoogleMaps(location, postcode, businessTypes, extractEmails);
        if (hasdataResults.length > 0) {
          businesses = hasdataResults;
          scraperUsed = 'hasdata';
          logger.info('main', `Found ${businesses.length} businesses via HasData`);
        }
      } catch (hasdataError) {
        logger.warn('main', 'HasData also returned 0 or failed', { error: hasdataError.message });
        // Continue with 0 businesses from Outscraper
      }
    }
  } catch (outscraperError) {
    logger.warn('main', 'Outscraper failed, falling back to HasData', { error: outscraperError.message });

    try {
      logger.info('main', 'Trying HasData API...');
      businesses = await scrapeGoogleMaps(location, postcode, businessTypes, extractEmails);
      scraperUsed = 'hasdata';
      logger.info('main', `Found ${businesses.length} businesses via HasData`);
    } catch (hasdataError) {
      logger.error('main', 'Both scrapers failed', {
        outscraperError: outscraperError.message,
        hasdataError: hasdataError.message
      });
      throw new Error(`Both Outscraper and HasData failed. Outscraper: ${outscraperError.message}, HasData: ${hasdataError.message}`);
    }
  }

  logger.info('main', `Scraper used: ${scraperUsed}`);
  
  // Step 2: Filter chains
  const filteredBusinesses = filterChains(businesses);
  logger.info('main', `After filtering chains: ${filteredBusinesses.length} businesses`);
  
  // Step 3: Enrich each business
  const enrichedBusinesses = [];
  let skippedCount = 0;

  for (const business of filteredBusinesses) {
    try {
      const enriched = await enrichBusiness(business);

      // Skip if enrichBusiness returned null (no firstName found)
      if (!enriched) {
        logger.warn('main', 'Skipping business - no firstName found', {
          business: business.name
        });
        skippedCount++;
        continue;
      }

      enrichedBusinesses.push(enriched);

      // Save enriched business to storage
      try {
        saveBusiness(enriched, {
          scrapedAt: scrapedAt,
          enrichedAt: new Date().toISOString(),
          location: location,
          postcode: postcode,
          status: "enriched"
        });
      } catch (saveError) {
        logger.error('main', 'Error saving business', {
          businessName: enriched.name || enriched.businessName,
          error: saveError.message
        });
        // Continue processing even if save fails
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      logger.error('main', 'Error enriching business', { businessName: business.name, error: error.message });
    }
  }

  logger.info('main', 'Enrichment complete', {
    total: filteredBusinesses.length,
    enriched: enrichedBusinesses.length,
    skipped: skippedCount
  });

  return enrichedBusinesses;
}

/**
 * Generate content and export
 */
async function generateAndExport(enrichedBusinesses, config = {}) {
  const approvedTemplates = loadApprovedTemplates();
  const exported = [];
  
  for (const business of enrichedBusinesses) {
    try {
      // Generate content
      const content = await generateOutreachContent(business, {
        provider: process.env.CONTENT_PROVIDER || 'claude', // Use Claude by default
        generateEmail: true,
        generateLinkedIn: !!business.linkedInUrl,
        emailSequence: true
      });
      
      // Check if approval needed
      if (needsApproval(business, approvedTemplates)) {
        addToApprovalQueue(business, content.email || content.emailSequence[0]);
        logger.info('main', `Added ${business.category} email to approval queue`);
        continue; // Skip export until approved
      }
      
      const exportedTo = [];
      
      // Export to Lemlist
      if (business.ownerEmail && config.lemlistCampaignId) {
        await exportToLemlist(business, config.lemlistCampaignId, content.emailSequence);
        exportedTo.push("lemlist");
      }
      
      // Export to Prosp
      if (business.linkedInUrl && config.exportLinkedIn) {
        await exportToProsp(business, content.linkedIn);
        exportedTo.push("prosp");
      }
      
      // Update business record with export status
      if (exportedTo.length > 0) {
        const { generateBusinessId } = require("./modules/database");
        const businessId = generateBusinessId(business);
        updateBusiness(businessId, {
          status: "exported",
          exportedTo: exportedTo,
          exportedAt: new Date().toISOString()
        });
      }
      
      exported.push({
        business: business.name,
        email: business.ownerEmail,
        linkedIn: business.linkedInUrl,
        tier: business.assignedOfferTier
      });
    } catch (error) {
      logger.error('main', 'Error exporting business', { businessName: business.name, error: error.message });
    }
  }
  
  return exported;
}

/**
 * Validate location string
 * @param {string} location - Location name to validate
 * @returns {boolean} True if valid
 */
function isValidLocation(location) {
  if (!location || typeof location !== "string") return false;
  // Allow alphanumeric, spaces, hyphens, apostrophes (for places like "Bishop's Stortford")
  const locationPattern = /^[a-zA-Z0-9\s\-']+$/;
  return locationPattern.test(location) && location.length >= 2 && location.length <= 100;
}

/**
 * Validate UK postcode prefix
 * @param {string} postcode - Postcode to validate
 * @returns {boolean} True if valid UK postcode format
 */
function isValidPostcode(postcode) {
  if (!postcode || typeof postcode !== "string") return false;
  // UK postcode prefix pattern (e.g., SK7, M1, SW1A, EC1A)
  const postcodePattern = /^[A-Z]{1,2}[0-9][0-9A-Z]?$/i;
  return postcodePattern.test(postcode.trim());
}

/**
 * Sanitize business types input
 * @param {string} input - Comma-separated business types
 * @returns {Array<string>} Sanitized array of business types
 */
function sanitizeBusinessTypes(input) {
  if (!input || typeof input !== "string") return [];
  return input
    .split(",")
    .map(type => type.trim().toLowerCase())
    .filter(type => type.length > 0 && type.length <= 50 && /^[a-zA-Z0-9\s\-]+$/.test(type));
}

/**
 * Print usage information
 */
function printUsage() {
  console.log(`
Usage: node main.js [location] [postcode] [businessTypes] [options]

Arguments:
  location       Location name (e.g., "Bramhall", "Manchester")
  postcode       UK postcode prefix (e.g., "SK7", "M1")
  businessTypes  Comma-separated list (e.g., "restaurants,cafes")

Options:
  --no-emails    Skip email extraction from websites
  --load         Load existing businesses instead of scraping
  --help         Show this help message

Examples:
  node main.js Bramhall SK7
  node main.js "Manchester" M1 "restaurants,bars" --no-emails
  node main.js --load Bramhall SK7
`);
}

// Main execution (if run directly)
if (require.main === module) {
  // Parse command line arguments
  const args = process.argv.slice(2);

  // Check for help flag
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  let location = "Bramhall";
  let postcode = "SK7";
  let businessTypes = [];
  let extractEmails = true;
  let loadExisting = false;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--no-email-extraction" || arg === "--no-emails") {
      extractEmails = false;
    } else if (arg === "--load-existing" || arg === "--load") {
      loadExisting = true;
      if (args[i + 1] && !args[i + 1].startsWith("--")) location = args[i + 1];
      if (args[i + 2] && !args[i + 2].startsWith("--")) postcode = args[i + 2];
      break;
    } else if (i === 0 && !arg.startsWith("--")) {
      location = arg;
    } else if (i === 1 && !arg.startsWith("--")) {
      postcode = arg;
    } else if (i === 2 && !arg.startsWith("--")) {
      businessTypes = sanitizeBusinessTypes(arg);
    }
  }

  // Validate inputs
  if (!isValidLocation(location)) {
    logger.error('main', 'Invalid location', { location, reason: 'Must be 2-100 alphanumeric characters' });
    process.exit(1);
  }

  if (!isValidPostcode(postcode)) {
    logger.error('main', 'Invalid postcode', { postcode, reason: 'Must be a valid UK postcode prefix (e.g., SK7, M1, SW1A)' });
    process.exit(1);
  }

  logger.info('main', `Starting outreach automation for ${location} (${postcode})`);
  logger.info('main', `Business types: ${businessTypes.length > 0 ? businessTypes.join(", ") : "All"}`);
  logger.info('main', `Email extraction: ${extractEmails ? "enabled" : "disabled"}`);
  
  let businessesPromise;
  
  if (loadExisting) {
    // Load existing businesses from storage
    logger.info('main', `Loading existing businesses for ${location} (${postcode})...`);
    const existingBusinesses = loadBusinesses({ location, postcode });
    logger.info('main', `Found ${existingBusinesses.length} existing businesses`);
    businessesPromise = Promise.resolve(existingBusinesses.map(record => record.business));
  } else {
    // Scrape and enrich new businesses
    businessesPromise = processBusinesses(location, postcode, businessTypes, extractEmails);
  }
  
  businessesPromise
    .then(businesses => {
      logger.info('main', `${loadExisting ? "Loaded" : "Enriched"} ${businesses.length} businesses`);
      return generateAndExport(businesses, {
        lemlistCampaignId: process.env.LEMLIST_CAMPAIGN_ID,
        exportLinkedIn: true
      });
    })
    .then(exported => {
      logger.info('main', `Exported ${exported.length} businesses`);
      exported.forEach(e => {
        logger.info('main', `  - ${e.business} (${e.tier})`);
      });
    })
    .catch(error => {
      logger.error('main', 'Fatal error', { error: error.message, stack: error.stack });
      process.exit(1);
    });
}

module.exports = {
  processBusinesses,
  enrichBusiness,
  generateAndExport
};
