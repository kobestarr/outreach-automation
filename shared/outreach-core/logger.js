/**
 * Centralized Logger Module
 * Provides consistent logging across all outreach modules
 * 
 * Log Levels:
 * - error: Critical errors that need immediate attention
 * - warn: Warning conditions that should be noted
 * - info: Informational messages about normal operation
 * - debug: Detailed debugging information (only in development)
 * 
 * Environment Variables:
 * - LOG_LEVEL: Minimum log level to output (error, warn, info, debug). Default: info
 * - LOG_JSON: Output logs as JSON (true/false). Default: false
 * - NODE_ENV: When 'production', debug logs are suppressed
 */

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const DEFAULT_LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const LOG_JSON = process.env.LOG_JSON === 'true';

/**
 * Get current log level from environment
 */
function getLogLevel() {
  const level = DEFAULT_LOG_LEVEL.toLowerCase();
  return LOG_LEVELS[level] !== undefined ? level : 'info';
}

/**
 * Check if a log level should be output
 */
function shouldLog(level) {
  const currentLevel = getLogLevel();
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLevel];
}

/**
 * Sanitize data to remove sensitive information
 */
function sanitizeData(data) {
  if (typeof data !== 'object' || data === null) {
    return data;
  }
  
  const sensitiveKeys = ['apiKey', 'api_key', 'key', 'token', 'password', 'secret', 'authorization'];
  const sanitized = {};
  
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeData(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Format log message
 */
function formatLog(level, module, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const sanitizedMeta = sanitizeData(meta);
  
  if (LOG_JSON) {
    return JSON.stringify({
      timestamp,
      level,
      module,
      message,
      ...sanitizedMeta
    });
  }
  
  const metaStr = Object.keys(sanitizedMeta).length > 0 
    ? ' ' + JSON.stringify(sanitizedMeta)
    : '';
  
  return `[${timestamp}] [${level.toUpperCase()}] [${module}] ${message}${metaStr}`;
}

/**
 * Log error message
 */
function error(module, message, meta = {}) {
  if (!shouldLog('error')) return;
  console.error(formatLog('error', module, message, meta));
}

/**
 * Log warning message
 */
function warn(module, message, meta = {}) {
  if (!shouldLog('warn')) return;
  console.warn(formatLog('warn', module, message, meta));
}

/**
 * Log info message
 */
function info(module, message, meta = {}) {
  if (!shouldLog('info')) return;
  console.log(formatLog('info', module, message, meta));
}

/**
 * Log debug message (only in non-production)
 */
function debug(module, message, meta = {}) {
  if (IS_PRODUCTION || !shouldLog('debug')) return;
  console.log(formatLog('debug', module, message, meta));
}

module.exports = {
  error,
  warn,
  info,
  debug,
  getLogLevel,
  sanitizeData
};
