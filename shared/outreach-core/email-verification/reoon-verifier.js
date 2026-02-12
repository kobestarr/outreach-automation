/**
 * Reoon Email Verification Module
 * Verifies email addresses using Reoon API with daily limit tracking
 */

const https = require("https");
const { getCredential, checkDailyLimit, recordUsage } = require("../credentials-loader");
const logger = require("../logger");

const REOON_BASE_URL = "emailverifier.reoon.com";

/**
 * Verify a single email address
 * @param {string} email - Email address to verify
 * @param {string} mode - Verification mode: "quick" or "power" (default: "power")
 * @returns {Promise<Object>} Verification result with status and score
 */
async function verifyEmail(email, mode = "power") {
  // Check daily limit first
  const limitCheck = checkDailyLimit("reoon");
  if (!limitCheck.canUse) {
    throw new Error(`Reoon daily limit reached (500/day). Used: ${limitCheck.used}, Remaining: ${limitCheck.remaining}`);
  }
  
  const apiKey = getCredential("reoon", "apiKey");
  
  return new Promise((resolve, reject) => {
    const path = `/api/v1/verify?email=${encodeURIComponent(email)}&key=${apiKey}&mode=${mode}`;
    
    const options = {
      hostname: REOON_BASE_URL,
      path: path,
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    };
    
    const req = https.request(options, (res) => {
      // Use Buffer pattern to prevent memory leak from string concatenation
      const chunks = [];
      let totalLength = 0;
      
      res.on("data", (chunk) => {
        chunks.push(chunk);
        totalLength += chunk.length;
      });
      
      res.on("end", () => {
        try {
          const data = Buffer.concat(chunks, totalLength).toString('utf8');
          const result = JSON.parse(data);
          
          // Record usage (1 verification = 1 credit)
          recordUsage("reoon", 1);
          
          // Parse Reoon response (power mode)
          const verification = {
            email: email,
            isValid: result.status === "safe" || result.status === "valid" || result.is_deliverable === true,
            status: result.status, // safe, valid, invalid, disabled, disposable, etc.
            score: result.overall_score || result.score || null,
            reason: result.reason || null,
            isDeliverable: result.is_deliverable || false,
            isSafeToSend: result.is_safe_to_send || false,
            verifiedAt: new Date().toISOString(),
            mode: mode
          };
          
          resolve(verification);
        } catch (error) {
          reject(new Error(`Failed to parse Reoon response: ${error.message}`));
        }
      });
    });
    
    req.on("error", (error) => {
      reject(new Error(`Reoon API error: ${error.message}`));
    });
    
    req.end();
  });
}

/**
 * Verify multiple email addresses (batch)
 * @param {Array<string>} emails - Array of email addresses
 * @param {string} mode - Verification mode: "quick" or "power" (default: "power")
 * @returns {Promise<Array<Object>>} Array of verification results
 */
async function verifyEmails(emails, mode = "power") {
  const limitCheck = checkDailyLimit("reoon");
  const remaining = limitCheck.remaining;
  
  if (emails.length > remaining) {
    logger.warn('reoon-verifier', `Only ${remaining} verifications remaining. Processing first ${remaining} emails.`, {
      requested: emails.length,
      remaining,
      processing: Math.min(emails.length, remaining)
    });
    emails = emails.slice(0, remaining);
  }
  
  const results = [];
  
  // Process sequentially to respect rate limits
  for (const email of emails) {
    try {
      const result = await verifyEmail(email, mode);
      results.push(result);
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      results.push({
        email: email,
        isValid: false,
        status: "error",
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
  return checkDailyLimit("reoon");
}

/**
 * Get remaining quota for email verification
 * @returns {number} Number of remaining verifications
 */
function getQuotaRemaining() {
  const limitCheck = checkDailyLimit("reoon");
  return limitCheck.remaining;
}

module.exports = {
  verifyEmail,
  verifyEmails,
  checkAvailability,
  getQuotaRemaining
};
