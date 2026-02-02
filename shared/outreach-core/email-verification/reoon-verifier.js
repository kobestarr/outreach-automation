/**
 * Reoon Email Verification Module
 * Verifies email addresses using Reoon API with daily limit tracking
 */

const https = require('https');
const { getCredential, checkDailyLimit, recordUsage } = require('../credentials-loader');

const REOON_BASE_URL = 'https://api.reoon.com';

/**
 * Verify a single email address
 * @param {string} email - Email address to verify
 * @returns {Promise<Object>} Verification result with status and score
 */
async function verifyEmail(email) {
  // Check daily limit first
  const limitCheck = checkDailyLimit('reoon');
  if (!limitCheck.canUse) {
    throw new Error(`Reoon daily limit reached (500/day). Used: ${limitCheck.used}, Remaining: ${limitCheck.remaining}`);
  }
  
  const apiKey = getCredential('reoon', 'apiKey');
  
  return new Promise((resolve, reject) => {
    const url = `${REOON_BASE_URL}/v2/verify?email=${encodeURIComponent(email)}&key=${apiKey}`;
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          
          // Record usage (1 verification = 1 credit)
          recordUsage('reoon', 1);
          
          // Parse Reoon response
          const verification = {
            email: email,
            isValid: result.status === 'valid' || result.status === 'accept_all',
            status: result.status, // valid, invalid, accept_all, unknown, etc.
            score: result.score || null,
            reason: result.reason || null,
            verifiedAt: new Date().toISOString()
          };
          
          resolve(verification);
        } catch (error) {
          reject(new Error(`Failed to parse Reoon response: ${error.message}`));
        }
      });
    }).on('error', (error) => {
      reject(new Error(`Reoon API error: ${error.message}`));
    });
  });
}

/**
 * Verify multiple email addresses (batch)
 * @param {Array<string>} emails - Array of email addresses
 * @returns {Promise<Array<Object>>} Array of verification results
 */
async function verifyEmails(emails) {
  const limitCheck = checkDailyLimit('reoon');
  const remaining = limitCheck.remaining;
  
  if (emails.length > remaining) {
    console.warn(`Only ${remaining} verifications remaining. Processing first ${remaining} emails.`);
    emails = emails.slice(0, remaining);
  }
  
  const results = [];
  
  // Process sequentially to respect rate limits
  for (const email of emails) {
    try {
      const result = await verifyEmail(email);
      results.push(result);
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      results.push({
        email: email,
        isValid: false,
        status: 'error',
        error: error.message,
        verifiedAt: new Date().toISOString()
      });
    }
  }
  
  return results;
}

/**
 * Check if email verification is available (daily limit not reached)
 * @returns {Object} Availability status
 */
function checkAvailability() {
  return checkDailyLimit('reoon');
}

module.exports = {
  verifyEmail,
  verifyEmails,
  checkAvailability
};
