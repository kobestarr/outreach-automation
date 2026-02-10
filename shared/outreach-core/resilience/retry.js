/**
 * Retry Logic with Exponential Backoff
 * Handles transient failures by retrying with increasing delays
 *
 * @module retry
 */

const logger = require('../logger');

/**
 * Retry a function with exponential backoff
 *
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxAttempts - Maximum retry attempts (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 10000)
 * @param {number} options.backoffFactor - Exponential backoff factor (default: 2)
 * @param {Function} options.shouldRetry - Function to determine if error is retryable (default: isRetryableError)
 * @param {string} options.operationName - Name of operation for logging (default: 'operation')
 * @returns {Promise<any>} Result of the function
 * @throws {Error} If all retries exhausted
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2,
    shouldRetry = isRetryableError,
    operationName = 'operation'
  } = options;

  let lastError;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.debug('retry', `Attempt ${attempt}/${maxAttempts}`, { operationName });
      const result = await fn();

      if (attempt > 1) {
        logger.info('retry', 'Operation succeeded after retry', {
          operationName,
          attempt,
          totalAttempts: maxAttempts
        });
      }

      return result;
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      if (!shouldRetry(error)) {
        logger.debug('retry', 'Error not retryable - aborting', {
          operationName,
          attempt,
          error: error.message
        });
        throw error;
      }

      // Check if we have retries left
      if (attempt >= maxAttempts) {
        logger.error('retry', 'All retry attempts exhausted', {
          operationName,
          attempts: maxAttempts,
          lastError: error.message
        });
        throw new Error(`Retry failed after ${maxAttempts} attempts: ${error.message}`);
      }

      // Calculate delay with exponential backoff
      const waitTime = Math.min(delay, maxDelay);
      logger.warn('retry', 'Retry attempt failed - backing off', {
        operationName,
        attempt,
        maxAttempts,
        waitTime: `${waitTime}ms`,
        error: error.message
      });

      // Wait before next attempt
      await sleep(waitTime);

      // Exponential backoff
      delay *= backoffFactor;
    }
  }

  throw lastError;
}

/**
 * Determine if an error is retryable
 *
 * @param {Error} error - Error to check
 * @returns {boolean} True if error is retryable
 */
function isRetryableError(error) {
  const message = error.message || '';
  const code = error.code || '';

  // Network errors (transient)
  const networkErrors = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EPIPE',
    'ENETUNREACH',
    'EHOSTUNREACH'
  ];

  if (networkErrors.includes(code)) {
    return true;
  }

  // HTTP status codes (rate limiting, server errors)
  const retryableStatusCodes = [
    408, // Request Timeout
    429, // Too Many Requests
    500, // Internal Server Error
    502, // Bad Gateway
    503, // Service Unavailable
    504  // Gateway Timeout
  ];

  // Check if error message contains HTTP status code
  const statusMatch = message.match(/HTTP (\d{3})/);
  if (statusMatch) {
    const statusCode = parseInt(statusMatch[1]);
    if (retryableStatusCodes.includes(statusCode)) {
      return true;
    }
  }

  // Check error status property (common in HTTP libraries)
  if (error.status && retryableStatusCodes.includes(error.status)) {
    return true;
  }
  if (error.statusCode && retryableStatusCodes.includes(error.statusCode)) {
    return true;
  }

  // Timeout errors
  if (message.includes('timeout') || message.includes('timed out')) {
    return true;
  }

  // Default: not retryable
  return false;
}

/**
 * Sleep for specified milliseconds
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a retry wrapper for a function
 * Useful for wrapping API calls
 *
 * @param {Function} fn - Function to wrap
 * @param {Object} retryOptions - Retry options (see retryWithBackoff)
 * @returns {Function} Wrapped function with retry logic
 */
function withRetry(fn, retryOptions = {}) {
  return async (...args) => {
    return retryWithBackoff(() => fn(...args), retryOptions);
  };
}

module.exports = {
  retryWithBackoff,
  isRetryableError,
  withRetry,
  sleep
};
