/**
 * SMTP Rate Limiter
 * Prevents SMTP abuse by rate limiting connections per host
 *
 * Tracks SMTP connection attempts per mail server hostname and enforces limits
 * to prevent:
 * - Mailbox enumeration attacks
 * - Server overload from excessive verification attempts
 * - IP blocking from mail servers
 *
 * @module smtp-rate-limiter
 */

const logger = require('../logger');

class SmtpRateLimiter {
  constructor() {
    this.hostAttempts = new Map(); // hostname -> { count, resetAt }
    this.MAX_ATTEMPTS_PER_HOST = 5;
    this.RESET_INTERVAL_MS = 60000; // 1 minute
  }

  /**
   * Check if an SMTP attempt to a host is allowed
   *
   * @param {string} hostname - Mail server hostname
   * @returns {boolean} True if attempt is allowed, false if rate limit exceeded
   */
  canAttempt(hostname) {
    const now = Date.now();
    const record = this.hostAttempts.get(hostname);

    if (!record) {
      // First attempt for this host
      this.hostAttempts.set(hostname, {
        count: 1,
        resetAt: now + this.RESET_INTERVAL_MS
      });
      return true;
    }

    // Check if reset interval has passed
    if (now > record.resetAt) {
      // Reset counter
      this.hostAttempts.set(hostname, {
        count: 1,
        resetAt: now + this.RESET_INTERVAL_MS
      });
      return true;
    }

    // Check if limit exceeded
    if (record.count >= this.MAX_ATTEMPTS_PER_HOST) {
      const secondsUntilReset = Math.ceil((record.resetAt - now) / 1000);
      logger.warn('smtp-rate-limiter', 'Rate limit exceeded', {
        hostname,
        attempts: record.count,
        maxAttempts: this.MAX_ATTEMPTS_PER_HOST,
        resetIn: `${secondsUntilReset}s`
      });
      return false;
    }

    // Increment counter
    record.count++;
    return true;
  }

  /**
   * Manually reset rate limit for a hostname
   *
   * @param {string} hostname - Mail server hostname to reset
   */
  reset(hostname) {
    this.hostAttempts.delete(hostname);
    logger.debug('smtp-rate-limiter', 'Rate limit reset', { hostname });
  }

  /**
   * Clear all rate limit records
   * Useful for testing or manual intervention
   */
  clearAll() {
    const count = this.hostAttempts.size;
    this.hostAttempts.clear();
    logger.info('smtp-rate-limiter', 'All rate limits cleared', { count });
  }

  /**
   * Get current status for a hostname
   *
   * @param {string} hostname - Mail server hostname
   * @returns {{attempts: number, remaining: number, resetAt: number}|null}
   */
  getStatus(hostname) {
    const record = this.hostAttempts.get(hostname);
    if (!record) {
      return {
        attempts: 0,
        remaining: this.MAX_ATTEMPTS_PER_HOST,
        resetAt: null
      };
    }

    return {
      attempts: record.count,
      remaining: Math.max(0, this.MAX_ATTEMPTS_PER_HOST - record.count),
      resetAt: record.resetAt
    };
  }
}

// Export singleton instance
module.exports = new SmtpRateLimiter();
