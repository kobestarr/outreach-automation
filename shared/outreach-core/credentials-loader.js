/**
 * Shared Credentials Loader
 * Loads API keys and tracks usage for rate-limited services
 * Used by all outreach core modules
 *
 * @module credentials-loader
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Configurable paths via environment variables with sensible defaults
const DEFAULT_CREDENTIALS_DIR = path.join(os.homedir(), '.credentials');
const CREDENTIALS_PATH = process.env.OUTREACH_CREDENTIALS_PATH ||
  path.join(process.env.CREDENTIALS_DIR || DEFAULT_CREDENTIALS_DIR, 'api-keys.json');
const USAGE_TRACKER_PATH = process.env.OUTREACH_USAGE_TRACKER_PATH ||
  path.join(process.env.CREDENTIALS_DIR || DEFAULT_CREDENTIALS_DIR, 'usage-tracker.json');

/**
 * Load all credentials from the api-keys.json file
 * @returns {Object} The credentials object containing all service configurations
 * @throws {Error} If the credentials file cannot be read or parsed
 */
function loadCredentials() {
  try {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      throw new Error(`Credentials file not found at ${CREDENTIALS_PATH}. ` +
        `Set OUTREACH_CREDENTIALS_PATH or CREDENTIALS_DIR environment variable.`);
    }
    const data = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Credentials file not found at ${CREDENTIALS_PATH}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in credentials file: ${error.message}`);
    }
    throw new Error(`Failed to load credentials: ${error.message}`);
  }
}

/**
 * Get a specific credential value for a service
 * @param {string} service - The service name (e.g., 'icypeas', 'openai', 'hasdata')
 * @param {string} [key='apiKey'] - The key to retrieve from the service config
 * @returns {string} The credential value
 * @throws {Error} If the service or key is not found
 */
function getCredential(service, key = 'apiKey') {
  if (!service || typeof service !== 'string') {
    throw new Error('Service name must be a non-empty string');
  }
  const credentials = loadCredentials();
  if (!credentials[service]) {
    throw new Error(`Service "${service}" not found in credentials. ` +
      `Available services: ${Object.keys(credentials).join(', ')}`);
  }
  if (credentials[service][key] === undefined) {
    throw new Error(`Key "${key}" not found for service "${service}"`);
  }
  return credentials[service][key];
}

/**
 * Load the usage tracker from disk
 * @returns {Object} Usage tracker object with per-service usage data
 */
function loadUsageTracker() {
  try {
    if (!fs.existsSync(USAGE_TRACKER_PATH)) {
      return {};
    }
    const data = fs.readFileSync(USAGE_TRACKER_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.warn(`[credentials-loader] Failed to load usage tracker: ${error.message}`);
    return {};
  }
}

/**
 * Save the usage tracker to disk with secure permissions
 * @param {Object} tracker - The usage tracker object to save
 * @throws {Error} If the file cannot be written
 */
function saveUsageTracker(tracker) {
  try {
    // Ensure directory exists
    const dir = path.dirname(USAGE_TRACKER_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(USAGE_TRACKER_PATH, JSON.stringify(tracker, null, 2), { mode: 0o600 });
  } catch (error) {
    throw new Error(`Failed to save usage tracker: ${error.message}`);
  }
}

/**
 * Check if daily limit is reached for a rate-limited service
 * @param {string} service - The service name (e.g., 'icypeas', 'reoon')
 * @returns {Object} Object with canUse (boolean), remaining (number), used (number), limit (number)
 */
function checkDailyLimit(service) {
  const tracker = loadUsageTracker();
  const credentials = loadCredentials();
  
  if (!tracker[service] || !credentials[service]) {
    return { canUse: true, remaining: credentials[service]?.dailyLimit || Infinity };
  }
  
  const today = new Date().toISOString().split('T')[0];
  const serviceTracker = tracker[service];
  
  // Reset if it's a new day
  if (serviceTracker.date !== today) {
    serviceTracker.date = today;
    serviceTracker.used = 0;
    serviceTracker.remaining = credentials[service].dailyLimit || 500;
    serviceTracker.lastReset = new Date().toISOString();
    saveUsageTracker(tracker);
  }
  
  const limit = credentials[service].dailyLimit || 500;
  const remaining = limit - serviceTracker.used;
  
  return {
    canUse: remaining > 0,
    remaining: Math.max(0, remaining),
    used: serviceTracker.used,
    limit: limit
  };
}

/**
 * Record API usage for a rate-limited service
 * Automatically resets the counter on a new day
 * @param {string} service - The service name (e.g., 'icypeas', 'reoon')
 * @param {number} [count=1] - Number of API calls to record
 * @returns {Object} Updated usage stats with used, remaining, and limit
 */
function recordUsage(service, count = 1) {
  const tracker = loadUsageTracker();
  const credentials = loadCredentials();
  
  if (!tracker[service]) {
    tracker[service] = {
      date: new Date().toISOString().split('T')[0],
      used: 0,
      limit: credentials[service]?.dailyLimit || 500,
      remaining: credentials[service]?.dailyLimit || 500,
      lastReset: new Date().toISOString()
    };
  }
  
  const today = new Date().toISOString().split('T')[0];
  const serviceTracker = tracker[service];
  
  // Reset if it's a new day
  if (serviceTracker.date !== today) {
    serviceTracker.date = today;
    serviceTracker.used = 0;
    serviceTracker.remaining = credentials[service].dailyLimit || 500;
    serviceTracker.lastReset = new Date().toISOString();
  }
  
  serviceTracker.used += count;
  serviceTracker.remaining = Math.max(0, serviceTracker.remaining - count);
  saveUsageTracker(tracker);
  
  return {
    used: serviceTracker.used,
    remaining: serviceTracker.remaining,
    limit: serviceTracker.limit
  };
}

module.exports = {
  loadCredentials,
  getCredential,
  loadUsageTracker,
  saveUsageTracker,
  checkDailyLimit,
  recordUsage
};
