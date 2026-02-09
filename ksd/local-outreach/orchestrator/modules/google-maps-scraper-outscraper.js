/**
 * Outscraper Google Maps Scraper
 * Scrapes businesses from Google Maps using Outscraper API
 * Primary scraper with HasData as fallback
 *
 * @module google-maps-scraper-outscraper
 */

const https = require("https");
const { getCredential } = require("../../../../shared/outreach-core/credentials-loader");
const logger = require("../../../../shared/outreach-core/logger");

const OUTSCRAPER_BASE_URL = "api.outscraper.com";
const OUTSCRAPER_RESULTS_URL = "api.outscraper.cloud";
const REQUEST_TIMEOUT_MS = 60000;
const INITIAL_POLL_DELAY_MS = 2000;
const MAX_POLL_DELAY_MS = 16000;
const MAX_POLL_ATTEMPTS = 30;

/**
 * Calculate delay with exponential backoff
 */
function getBackoffDelay(attempt) {
  const delay = INITIAL_POLL_DELAY_MS * Math.pow(2, Math.min(attempt - 1, 3));
  return Math.min(delay, MAX_POLL_DELAY_MS);
}

/**
 * Scrape Google Maps for businesses using Outscraper API
 */
async function scrapeGoogleMapsOutscraper(location, postcode, businessTypes = [], extractEmails = true) {
  const apiKey = getCredential("outscraper", "apiKey");

  // Build search query
  const queries = businessTypes.map(type => {
    if (postcode) {
      return `${type} in ${location}, ${postcode}`;
    }
    return `${type} in ${location}`;
  });

  logger.info('google-maps-scraper-outscraper', 'Starting Outscraper scrape', {
    location,
    postcode,
    businessTypes,
    queries
  });

  try {
    const results = await Promise.all(queries.map(query => scrapeQuery(query, apiKey, extractEmails)));

    // Flatten results and deduplicate by place_id
    const allBusinesses = results.flat();
    const uniqueBusinesses = deduplicateByPlaceId(allBusinesses);

    logger.info('google-maps-scraper-outscraper', 'Outscraper scrape complete', {
      totalResults: allBusinesses.length,
      uniqueResults: uniqueBusinesses.length
    });

    return uniqueBusinesses;
  } catch (error) {
    logger.error('google-maps-scraper-outscraper', 'Outscraper scrape failed', {
      error: error.message,
      location,
      postcode
    });
    throw error;
  }
}

/**
 * Scrape a single query using Outscraper API (async)
 */
async function scrapeQuery(query, apiKey, extractEmails) {
  // Step 1: Submit the job
  const jobId = await submitOutscraperJob(query, apiKey, extractEmails);

  // Step 2: Poll for results
  const results = await pollOutscraperJob(jobId, apiKey);

  // Step 3: Transform to our format
  const transformed = results.map(transformOutscraperBusiness);

  logger.info('google-maps-scraper-outscraper', 'Query completed', {
    query,
    count: transformed.length
  });

  return transformed;
}

/**
 * Submit a job to Outscraper API
 */
function submitOutscraperJob(query, apiKey, extractEmails) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      query: query,
      limit: '50',
      language: 'en',
      region: 'uk',
      extractEmails: extractEmails ? 'true' : 'false'
    });

    const options = {
      hostname: OUTSCRAPER_BASE_URL,
      path: `/maps/search-v3?${params.toString()}`,
      method: "GET",
      headers: {
        "X-API-KEY": apiKey
      }
    };

    const req = https.request(options, (res) => {
      let data = "";

      if (res.statusCode >= 400) {
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          logger.error('google-maps-scraper-outscraper', 'Outscraper HTTP error', {
            statusCode: res.statusCode,
            preview: data.substring(0, 200)
          });

          try {
            const errorData = JSON.parse(data);
            reject(new Error(`Outscraper API error (${res.statusCode}): ${errorData.errorMessage || errorData.error || errorData.message || "Unknown error"}`));
          } catch {
            reject(new Error(`Outscraper API error: HTTP ${res.statusCode}`));
          }
        });
        return;
      }

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          const result = JSON.parse(data);

          // Outscraper returns job ID for async processing
          if (result.id) {
            logger.info('google-maps-scraper-outscraper', 'Job submitted', {
              jobId: result.id,
              status: result.status
            });
            resolve(result.id);
          } else {
            logger.error('google-maps-scraper-outscraper', 'No job ID in response', {
              responseKeys: Object.keys(result)
            });
            reject(new Error("Outscraper response missing job ID"));
          }

        } catch (error) {
          logger.error('google-maps-scraper-outscraper', 'Failed to parse response', {
            error: error.message,
            dataPreview: data.substring(0, 500)
          });
          reject(new Error(`Failed to parse Outscraper response: ${error.message}`));
        }
      });
    });

    req.on("error", (error) => {
      logger.error('google-maps-scraper-outscraper', 'Request error', { error: error.message });
      reject(new Error(`Outscraper request failed: ${error.message}`));
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error("Outscraper request timeout"));
    });

    req.end();
  });
}

/**
 * Poll Outscraper job until complete
 */
function pollOutscraperJob(jobId, apiKey) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const poll = () => {
      attempts++;

      if (attempts > MAX_POLL_ATTEMPTS) {
        reject(new Error(`Outscraper job polling timeout after ${MAX_POLL_ATTEMPTS} attempts`));
        return;
      }

      const options = {
        hostname: OUTSCRAPER_RESULTS_URL,
        path: `/requests/${jobId}`,
        method: "GET",
        headers: {
          "X-API-KEY": apiKey
        }
      };

      const req = https.request(options, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            const result = JSON.parse(data);

            logger.info('google-maps-scraper-outscraper', 'Poll response', {
              jobId,
              status: result.status,
              attempt: attempts
            });

            if (result.status === "Success" || result.status === "success" || result.status === "completed") {
              // Job complete - extract results
              const businesses = result.data ? (Array.isArray(result.data) ? result.data.flat() : []) : [];

              logger.info('google-maps-scraper-outscraper', 'Job completed', {
                jobId,
                count: businesses.length
              });

              resolve(businesses);

            } else if (result.status === "Pending" || result.status === "pending" || result.status === "in progress") {
              // Still processing - poll again after delay
              const delay = getBackoffDelay(attempts);
              logger.info('google-maps-scraper-outscraper', 'Job pending, retrying', {
                jobId,
                attempt: attempts,
                delayMs: delay
              });
              setTimeout(poll, delay);

            } else if (result.status === "error" || result.status === "Error" || result.status === "failed") {
              reject(new Error(`Outscraper job failed: ${result.error || result.message || "Unknown error"}`));

            } else {
              logger.warn('google-maps-scraper-outscraper', 'Unknown job status', {
                jobId,
                status: result.status
              });
              // Retry anyway
              const delay = getBackoffDelay(attempts);
              setTimeout(poll, delay);
            }

          } catch (error) {
            logger.error('google-maps-scraper-outscraper', 'Failed to parse poll response', {
              error: error.message,
              dataPreview: data.substring(0, 500)
            });
            reject(new Error(`Failed to parse Outscraper poll response: ${error.message}`));
          }
        });
      });

      req.on("error", (error) => {
        logger.error('google-maps-scraper-outscraper', 'Poll request error', { error: error.message });
        reject(new Error(`Outscraper poll request failed: ${error.message}`));
      });

      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error("Outscraper poll request timeout"));
      });

      req.end();
    };

    // Start polling after initial delay
    setTimeout(poll, INITIAL_POLL_DELAY_MS);
  });
}

/**
 * Transform Outscraper business data to our standard format
 */
function transformOutscraperBusiness(business) {
  return {
    name: business.name || "Unknown Business",
    category: business.type || business.category || "General",
    address: business.full_address || business.address || "",
    city: business.city || extractCityFromAddress(business.full_address),
    postcode: business.postal_code || business.postcode || "",
    phone: business.phone || null,
    website: business.site || business.website || null,
    email: business.emails?.[0] || null,
    rating: business.rating || null,
    reviewCount: business.reviews || business.reviews_count || 0,
    latitude: business.latitude || null,
    longitude: business.longitude || null,
    placeId: business.place_id || business.google_id || null,

    // Additional fields
    openingHours: business.working_hours || null,
    description: business.description || null,

    // Social media
    instagramUrl: extractSocialMedia(business, 'instagram'),
    facebookUrl: extractSocialMedia(business, 'facebook'),

    // Metadata
    scrapedAt: new Date().toISOString(),
    source: "outscraper"
  };
}

/**
 * Extract city from full address
 */
function extractCityFromAddress(address) {
  if (!address) return "";

  const parts = address.split(",").map(p => p.trim());
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }

  return "";
}

/**
 * Extract social media URL from business data
 */
function extractSocialMedia(business, platform) {
  if (!business.social_media) return null;

  if (business.social_media[platform]) {
    return business.social_media[platform];
  }

  if (Array.isArray(business.links)) {
    const link = business.links.find(l => l.toLowerCase().includes(platform));
    return link || null;
  }

  return null;
}

/**
 * Deduplicate businesses by place_id
 */
function deduplicateByPlaceId(businesses) {
  const seen = new Set();
  return businesses.filter(business => {
    if (!business.placeId) return true;

    if (seen.has(business.placeId)) {
      return false;
    }

    seen.add(business.placeId);
    return true;
  });
}

module.exports = {
  scrapeGoogleMapsOutscraper
};
