/**
 * Icypeas Email Finder Module
 * Finds email addresses using firstname + lastname + domain
 *
 * @module icypeas-finder
 */

const https = require('https');
const { getCredential, checkDailyLimit, recordUsage } = require('../credentials-loader');

const ICYPEAS_BASE_URL = 'app.icypeas.com';
const REQUEST_TIMEOUT_MS = 30000;
const INITIAL_POLL_DELAY_MS = 2000;
const MAX_POLL_DELAY_MS = 16000;
const MAX_POLL_ATTEMPTS = 10;

/**
 * Find email address using name and domain
 * @param {Object} params - Search parameters
 * @param {string} params.firstName - First name
 * @param {string} params.lastName - Last name
 * @param {string} params.domainOrCompany - Domain or company name
 * @returns {Promise<Object>} Search result with email and certainty
 * @throws {Error} If daily limit reached, API error, or timeout
 */
async function findEmail({ firstName, lastName, domainOrCompany }) {
  // Validate required parameter
  if (!domainOrCompany || typeof domainOrCompany !== 'string') {
    throw new Error('domainOrCompany is required and must be a non-empty string');
  }

  // Check daily limit
  const limitCheck = checkDailyLimit('icypeas');
  if (!limitCheck.canUse) {
    throw new Error(`Icypeas daily limit reached (500/day). Used: ${limitCheck.used}, Remaining: ${limitCheck.remaining}`);
  }

  const apiKey = getCredential('icypeas', 'apiKey');

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      firstname: firstName || '',
      lastname: lastName || '',
      domainOrCompany: domainOrCompany
    });

    const options = {
      hostname: ICYPEAS_BASE_URL,
      path: '/api/email-search',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);

          if (!result.success) {
            console.error('[Icypeas] API error response:', JSON.stringify(result, null, 2));
            reject(new Error(`Icypeas API error: ${result.error || 'Unknown error'}`));
            return;
          }

          if (!result.item || !result.item._id) {
            console.error('[Icypeas] Unexpected response structure:', JSON.stringify(result, null, 2));
            reject(new Error('Icypeas API returned unexpected response structure'));
            return;
          }

          // Poll for results using the returned _id
          pollIcypeasResult(result.item._id, apiKey)
            .then((emailResult) => {
              // Record usage (1 credit per found email)
              if (emailResult && emailResult.emails && emailResult.emails.length > 0) {
                recordUsage('icypeas', emailResult.emails.length);
              }
              resolve(emailResult);
            })
            .catch(reject);
        } catch (error) {
          console.error('[Icypeas] Failed to parse response. Raw data:', data.substring(0, 500));
          reject(new Error(`Failed to parse Icypeas response: ${error.message}`));
        }
      });
    });

    // Set request timeout
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`Icypeas API request timeout after ${REQUEST_TIMEOUT_MS}ms`));
    });

    req.on('error', (error) => {
      if (error.code === 'ECONNRESET') {
        reject(new Error('Icypeas API connection reset - request may have timed out'));
      } else {
        reject(new Error(`Icypeas API request error: ${error.message}`));
      }
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Calculate delay with exponential backoff
 * @param {number} attempt - Current attempt number (1-indexed)
 * @returns {number} Delay in milliseconds
 */
function getBackoffDelay(attempt) {
  const delay = INITIAL_POLL_DELAY_MS * Math.pow(2, attempt - 1);
  return Math.min(delay, MAX_POLL_DELAY_MS);
}

/**
 * Poll Icypeas for search results with exponential backoff
 * @param {string} searchId - Search ID from initial request
 * @param {string} apiKey - API key
 * @returns {Promise<Object>} Search results with emails array
 * @throws {Error} If polling times out or API returns error
 */
function pollIcypeasResult(searchId, apiKey) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const poll = () => {
      attempts++;

      const postData = JSON.stringify({ id: searchId });

      const options = {
        hostname: ICYPEAS_BASE_URL,
        path: '/api/bulk-single-searchs/read',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': apiKey,
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const result = JSON.parse(data);

            if (result.items && result.items.length > 0) {
              const item = result.items[0];

              // Check status
              if (item.status === 'DEBITED' || item.status === 'FOUND') {
                // Search complete
                const emails = item.results?.emails || [];
                resolve({
                  emails: emails.map(e => ({
                    email: e.email,
                    certainty: e.certainty,
                    mxRecords: e.mxRecords,
                    mxProvider: e.mxProvider
                  })),
                  fullName: item.results?.fullname,
                  firstName: item.results?.firstname,
                  lastName: item.results?.lastname
                });
              } else if (item.status === 'NONE' || item.status === 'SCHEDULED' || item.status === 'IN_PROGRESS') {
                // Still processing, wait and retry with exponential backoff
                if (attempts < MAX_POLL_ATTEMPTS) {
                  const delay = getBackoffDelay(attempts);
                  setTimeout(poll, delay);
                } else {
                  reject(new Error(`Icypeas search timeout after ${MAX_POLL_ATTEMPTS} attempts (searchId: ${searchId})`));
                }
              } else {
                // No email found or error status
                resolve({
                  emails: [],
                  fullName: item.results?.fullname || null,
                  firstName: item.results?.firstname || null,
                  lastName: item.results?.lastname || null
                });
              }
            } else {
              // No results
              resolve({
                emails: [],
                fullName: null,
                firstName: null,
                lastName: null
              });
            }
          } catch (error) {
            console.error('[Icypeas] Failed to parse poll response. Raw data:', data.substring(0, 500));
            reject(new Error(`Failed to parse Icypeas poll response: ${error.message}`));
          }
        });
      });

      // Set request timeout
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error(`Icypeas poll request timeout after ${REQUEST_TIMEOUT_MS}ms`));
      });

      req.on('error', (error) => {
        reject(new Error(`Icypeas poll request error: ${error.message}`));
      });

      req.write(postData);
      req.end();
    };

    poll();
  });
}

module.exports = {
  findEmail
};
