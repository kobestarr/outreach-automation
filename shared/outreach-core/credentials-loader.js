/**
 * Shared Credentials Loader
 * Loads API keys and tracks usage for rate-limited services
 * Used by all outreach core modules
 */

const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = '/root/.credentials/api-keys.json';
const USAGE_TRACKER_PATH = '/root/.credentials/usage-tracker.json';

/**
 * Load credentials from api-keys.json
 */
function loadCredentials() {
  try {
    const data = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    throw new Error(`Failed to load credentials: ${error.message}`);
  }
}

/**
 * Get a specific credential by service name
 */
function getCredential(service, key = 'apiKey') {
  const credentials = loadCredentials();
  if (!credentials[service]) {
    throw new Error(`Service ${service} not found in credentials`);
  }
  return credentials[service][key];
}

/**
 * Load usage tracker
 */
function loadUsageTracker() {
  try {
    if (!fs.existsSync(USAGE_TRACKER_PATH)) {
      return {};
    }
    const data = fs.readFileSync(USAGE_TRACKER_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.warn(`Failed to load usage tracker: ${error.message}`);
    return {};
  }
}

/**
 * Save usage tracker
 */
function saveUsageTracker(tracker) {
  try {
    fs.writeFileSync(USAGE_TRACKER_PATH, JSON.stringify(tracker, null, 2), { mode: 0o600 });
  } catch (error) {
    throw new Error(`Failed to save usage tracker: ${error.message}`);
  }
}

/**
 * Check if daily limit is reached for a service
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
 * Record usage for a service
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
