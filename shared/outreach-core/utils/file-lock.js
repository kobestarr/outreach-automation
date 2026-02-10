/**
 * File Locking Utility
 * Prevents concurrent writes to files using a simple lock mechanism
 *
 * @module file-lock
 */

const logger = require('../logger');

class FileLock {
  constructor() {
    this.locks = new Map(); // filepath -> Promise
  }

  /**
   * Acquire a lock for a file
   * Waits if file is already locked
   *
   * @param {string} filepath - Path to file
   * @param {number} timeout - Max wait time in ms (default: 30000)
   * @returns {Promise<Function>} Release function - MUST be called when done
   */
  async acquire(filepath, timeout = 30000) {
    const startTime = Date.now();

    // Wait for existing lock to release
    while (this.locks.has(filepath)) {
      if (Date.now() - startTime > timeout) {
        throw new Error(`File lock timeout for ${filepath}`);
      }

      logger.debug('file-lock', 'Waiting for lock', { filepath });
      await this.sleep(100); // Check every 100ms
    }

    // Create new lock
    let releaseFn;
    const lockPromise = new Promise(resolve => {
      releaseFn = () => {
        this.locks.delete(filepath);
        logger.debug('file-lock', 'Lock released', { filepath });
        resolve();
      };
    });

    this.locks.set(filepath, lockPromise);
    logger.debug('file-lock', 'Lock acquired', { filepath });

    return releaseFn;
  }

  /**
   * Execute a function with file lock
   *
   * @param {string} filepath - Path to file
   * @param {Function} fn - Async function to execute
   * @returns {Promise<any>} Result of function
   */
  async withLock(filepath, fn) {
    const release = await this.acquire(filepath);

    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Check if file is currently locked
   *
   * @param {string} filepath - Path to file
   * @returns {boolean} True if locked
   */
  isLocked(filepath) {
    return this.locks.has(filepath);
  }

  /**
   * Sleep for specified milliseconds
   *
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
module.exports = new FileLock();
