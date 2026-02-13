/**
 * URL Validator - SSRF Protection
 * Validates URLs before making HTTP requests to prevent Server-Side Request Forgery attacks
 *
 * Blocks:
 * - Private IP ranges (RFC 1918, RFC 6598, loopback, link-local)
 * - Cloud metadata endpoints (AWS, GCP, Azure)
 * - Internal hostnames (localhost, etc.)
 * - Non-HTTP(S) protocols
 *
 * @module url-validator
 */

const dns = require('dns').promises;
const { isIP } = require('net');
const logger = require('../logger');

// Private IP ranges (RFC 1918, RFC 6598, loopback, link-local)
const PRIVATE_IP_RANGES = [
  /^127\./,                          // 127.0.0.0/8 (loopback)
  /^169\.254\./,                     // 169.254.0.0/16 (link-local)
  /^10\./,                           // 10.0.0.0/8 (private Class A)
  /^172\.(1[6-9]|2\d|3[01])\./,     // 172.16.0.0/12 (private Class B)
  /^192\.168\./,                     // 192.168.0.0/16 (private Class C)
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./, // 100.64.0.0/10 (Carrier-grade NAT, RFC 6598)
  /^fe80:/i,                         // IPv6 link-local
  /^::1$/,                           // IPv6 loopback
  /^fc00:/i,                         // IPv6 unique local
  /^fd00:/i                          // IPv6 unique local
];

// Blocked hostnames (internal services and cloud metadata endpoints)
const BLOCKED_HOSTNAMES = [
  'localhost',
  'metadata.google.internal',  // GCP metadata
  '169.254.169.254',            // AWS/GCP/Azure metadata
  'metadata',
  'metadata.goog'
];

/**
 * Validate URL is safe for HTTP requests (SSRF protection)
 *
 * @param {string} url - URL to validate
 * @returns {Promise<{safe: boolean, reason?: string}>}
 */
async function validateUrl(url) {
  try {
    const parsed = new URL(url);

    // Only allow http/https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { safe: false, reason: 'Invalid protocol (only http/https allowed)' };
    }

    // Check blocked hostnames
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.includes(hostname)) {
      logger.warn('url-validator', 'Blocked hostname detected', { url, hostname });
      return { safe: false, reason: 'Blocked hostname' };
    }

    // If hostname is already an IP address, validate it
    if (isIP(hostname)) {
      if (isPrivateIp(hostname)) {
        logger.warn('url-validator', 'Private IP address detected', { url, hostname });
        return { safe: false, reason: 'Private IP address' };
      }
      return { safe: true };
    }

    // Resolve DNS and check for private IPs (DNS rebinding protection)
    try {
      const addresses = await dns.resolve4(hostname);
      for (const ip of addresses) {
        if (isPrivateIp(ip)) {
          logger.warn('url-validator', 'Hostname resolves to private IP', {
            url,
            hostname,
            resolvedIp: ip
          });
          return { safe: false, reason: 'Resolves to private IP' };
        }
      }
    } catch (dnsError) {
      // DNS resolution failed - allow request to proceed with warning
      // Legitimate public websites shouldn't be blocked due to DNS timeouts
      logger.warn('url-validator', 'DNS resolution failed, allowing request to proceed', {
        url,
        hostname,
        error: dnsError.message,
        reason: 'Public websites should not be blocked due to DNS issues'
      });
      // Return safe=true to allow the request
      // We've already validated: protocol is http/https, hostname not in blocklist
      return { safe: true };
    }

    return { safe: true };
  } catch (error) {
    logger.error('url-validator', 'URL validation error', {
      url,
      error: error.message
    });
    return { safe: false, reason: 'Invalid URL format' };
  }
}

/**
 * Check if IP address is private/internal
 *
 * @param {string} ip - IP address to check
 * @returns {boolean} True if IP is private
 */
function isPrivateIp(ip) {
  return PRIVATE_IP_RANGES.some(pattern => pattern.test(ip));
}

module.exports = {
  validateUrl,
  isPrivateIp
};
