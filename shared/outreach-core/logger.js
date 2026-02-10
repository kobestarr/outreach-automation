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
 * Mask email address for privacy (GDPR compliance)
 * Example: john.doe@example.com → jo***@ex***.com
 */
function maskEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) {
    return email;
  }

  const [localPart, domain] = email.split('@');

  // Mask local part (keep first 2 chars)
  const maskedLocal = localPart.length > 2
    ? localPart.substring(0, 2) + '***'
    : '***';

  // Mask domain (keep first 2 chars)
  const maskedDomain = domain.length > 2
    ? domain.substring(0, 2) + '***'
    : '***';

  return `${maskedLocal}@${maskedDomain}`;
}

/**
 * Sanitize data to remove sensitive information and mask PII
 */
function sanitizeData(data) {
  if (typeof data !== 'object' || data === null) {
    // Check if it's a string that looks like an email
    if (typeof data === 'string' && data.includes('@') && data.includes('.')) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(data)) {
        return maskEmail(data);
      }
    }
    return data;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => sanitizeData(item));
  }

  const sensitiveKeys = ['apiKey', 'api_key', 'key', 'token', 'password', 'secret', 'authorization'];
  const emailKeys = ['email', 'emails', 'emailAddress', 'from', 'to', 'cc', 'bcc'];
  const sanitized = {};

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();

    // Redact sensitive keys
    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      sanitized[key] = '[REDACTED]';
    }
    // Mask email fields
    else if (emailKeys.includes(lowerKey)) {
      if (Array.isArray(value)) {
        sanitized[key] = value.map(email => maskEmail(email));
      } else if (typeof value === 'string') {
        sanitized[key] = maskEmail(value);
      } else {
        sanitized[key] = value;
      }
    }
    // Recursively sanitize objects
    else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeData(value);
    }
    // Keep other values as-is
    else {
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
