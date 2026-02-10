/**
 * Circuit Breaker Pattern
 * Prevents cascading failures by failing fast when a service is unhealthy
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Too many failures, requests fail fast (circuit "open" = no current flows)
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 *
 * @module circuit-breaker
 */

const logger = require('../logger');

const STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

class CircuitBreaker {
  /**
   * Create a circuit breaker
   *
   * @param {Object} options - Configuration options
   * @param {string} options.name - Circuit breaker name (for logging)
   * @param {number} options.failureThreshold - Number of failures before opening (default: 5)
   * @param {number} options.resetTimeout - Milliseconds before attempting to close (default: 60000)
   * @param {number} options.halfOpenRequests - Max requests in HALF_OPEN state (default: 1)
   */
  constructor(options) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute default
    this.halfOpenRequests = options.halfOpenRequests || 1;

    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
    this.halfOpenAttempts = 0;
  }

  /**
   * Execute a function with circuit breaker protection
   *
   * @param {Function} fn - Async function to execute
   * @returns {Promise<any>} Result of the function
   * @throws {Error} If circuit is OPEN or function fails
   */
  async execute(fn) {
    // Check if circuit is OPEN
    if (this.state === STATES.OPEN) {
      if (Date.now() < this.nextAttempt) {
        const secondsUntilRetry = Math.ceil((this.nextAttempt - Date.now()) / 1000);
        logger.warn('circuit-breaker', 'Circuit OPEN - failing fast', {
          name: this.name,
          state: this.state,
          failureCount: this.failureCount,
          retryIn: `${secondsUntilRetry}s`
        });
        throw new Error(`Circuit breaker OPEN for ${this.name} - retry in ${secondsUntilRetry}s`);
      }

      // Time to try HALF_OPEN
      this.transitionTo(STATES.HALF_OPEN);
    }

    // Check if too many HALF_OPEN attempts
    if (this.state === STATES.HALF_OPEN && this.halfOpenAttempts >= this.halfOpenRequests) {
      logger.debug('circuit-breaker', 'HALF_OPEN limit reached', {
        name: this.name,
        attempts: this.halfOpenAttempts,
        maxAttempts: this.halfOpenRequests
      });
      throw new Error(`Circuit breaker HALF_OPEN for ${this.name} - testing in progress`);
    }

    // Attempt request
    if (this.state === STATES.HALF_OPEN) {
      this.halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful request
   */
  onSuccess() {
    this.failureCount = 0;

    if (this.state === STATES.HALF_OPEN) {
      this.successCount++;
      logger.info('circuit-breaker', 'HALF_OPEN request succeeded', {
        name: this.name,
        successCount: this.successCount
      });

      // Success in HALF_OPEN - close circuit
      this.transitionTo(STATES.CLOSED);
    }
  }

  /**
   * Handle failed request
   */
  onFailure() {
    this.failureCount++;
    this.successCount = 0;

    logger.warn('circuit-breaker', 'Request failed', {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      threshold: this.failureThreshold
    });

    if (this.state === STATES.HALF_OPEN) {
      // Failure in HALF_OPEN - reopen circuit
      this.transitionTo(STATES.OPEN);
    } else if (this.failureCount >= this.failureThreshold) {
      // Too many failures in CLOSED - open circuit
      this.transitionTo(STATES.OPEN);
    }
  }

  /**
   * Transition to a new state
   *
   * @param {string} newState - New state (CLOSED, OPEN, HALF_OPEN)
   */
  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;

    if (newState === STATES.OPEN) {
      this.nextAttempt = Date.now() + this.resetTimeout;
      logger.error('circuit-breaker', 'Circuit OPENED', {
        name: this.name,
        failureCount: this.failureCount,
        resetTimeout: `${this.resetTimeout}ms`,
        nextAttempt: new Date(this.nextAttempt).toISOString()
      });
    } else if (newState === STATES.HALF_OPEN) {
      this.halfOpenAttempts = 0;
      logger.info('circuit-breaker', 'Circuit HALF_OPEN - testing recovery', {
        name: this.name,
        maxAttempts: this.halfOpenRequests
      });
    } else if (newState === STATES.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
      this.halfOpenAttempts = 0;
      logger.info('circuit-breaker', 'Circuit CLOSED - service recovered', {
        name: this.name,
        previousState: oldState
      });
    }
  }

  /**
   * Get current circuit breaker status
   *
   * @returns {{state: string, failureCount: number, nextAttempt: number}}
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      nextAttempt: this.state === STATES.OPEN ? this.nextAttempt : null
    };
  }

  /**
   * Manually reset circuit breaker to CLOSED state
   */
  reset() {
    logger.info('circuit-breaker', 'Manual reset', { name: this.name });
    this.transitionTo(STATES.CLOSED);
  }
}

/**
 * Circuit breaker instances for different services
 */
const breakers = {
  reoon: new CircuitBreaker({
    name: 'reoon',
    failureThreshold: 5,
    resetTimeout: 120000 // 2 minutes
  }),
  icypeas: new CircuitBreaker({
    name: 'icypeas',
    failureThreshold: 5,
    resetTimeout: 120000 // 2 minutes
  }),
  outscraper: new CircuitBreaker({
    name: 'outscraper',
    failureThreshold: 5,
    resetTimeout: 180000 // 3 minutes (longer for external API)
  }),
  openai: new CircuitBreaker({
    name: 'openai',
    failureThreshold: 5,
    resetTimeout: 60000 // 1 minute
  })
};

/**
 * Get circuit breaker for a service
 *
 * @param {string} service - Service name (reoon, icypeas, outscraper, openai)
 * @returns {CircuitBreaker} Circuit breaker instance
 */
function getCircuitBreaker(service) {
  if (!breakers[service]) {
    throw new Error(`No circuit breaker configured for service: ${service}`);
  }
  return breakers[service];
}

module.exports = {
  CircuitBreaker,
  getCircuitBreaker,
  breakers,
  STATES
};
