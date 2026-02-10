/**
 * Email Pattern Matcher
 * Generates and verifies common business email patterns
 * Uses DNS MX records and optional SMTP verification
 */

const dns = require('dns').promises;
const net = require('net');
const logger = require('../logger');

/**
 * Generate common business email patterns from domain
 *
 * @param {string} domain - Business domain (from website URL)
 * @returns {string[]} Array of email patterns to try
 */
function generateEmailPatterns(domain) {
  // Remove www. prefix
  const cleanDomain = domain.replace(/^www\./, '');

  return [
    `info@${cleanDomain}`,
    `contact@${cleanDomain}`,
    `hello@${cleanDomain}`,
    `enquiries@${cleanDomain}`,
    `enquiry@${cleanDomain}`,
    `sales@${cleanDomain}`,
    `support@${cleanDomain}`,
    `office@${cleanDomain}`,
    `admin@${cleanDomain}`
  ];
}

/**
 * Verify email exists using DNS MX records + SMTP check
 * Does NOT send email - just checks if mailbox exists
 *
 * @param {string} email - Email address to verify
 * @param {boolean} smtpCheck - Whether to perform SMTP mailbox check (default: false)
 * @returns {Promise<boolean>} True if email likely exists
 */
async function verifyEmailExists(email, smtpCheck = false) {
  try {
    const domain = email.split('@')[1];

    // Step 1: Check DNS MX records
    const mxRecords = await dns.resolveMx(domain);

    if (!mxRecords || mxRecords.length === 0) {
      logger.debug('email-pattern-matcher', 'No MX records found', { email, domain });
      return false;
    }

    // Sort by priority (lower = higher priority)
    mxRecords.sort((a, b) => a.priority - b.priority);
    const primaryMx = mxRecords[0].exchange;

    logger.debug('email-pattern-matcher', 'MX records found', {
      email,
      domain,
      primaryMx,
      count: mxRecords.length
    });

    // Step 2: SMTP mailbox check (optional - more accurate but slower)
    if (smtpCheck) {
      const mailboxExists = await checkSmtpMailbox(email, primaryMx);
      return mailboxExists;
    }

    // For now, just return true if MX records exist
    // (We'll verify with Reoon later anyway)
    return true;

  } catch (error) {
    logger.debug('email-pattern-matcher', 'Email verification failed', {
      email,
      error: error.message
    });
    return false;
  }
}

/**
 * Check if SMTP mailbox exists (optional - advanced)
 * Connects to SMTP server and checks RCPT TO command
 * Does NOT send email
 *
 * @param {string} email - Email address to check
 * @param {string} mxHost - MX server hostname
 * @returns {Promise<boolean>} True if mailbox exists
 */
async function checkSmtpMailbox(email, mxHost) {
  return new Promise((resolve) => {
    const socket = net.createConnection(25, mxHost);

    let step = 0;
    const fromEmail = 'verify@example.com';

    socket.setTimeout(5000);

    socket.on('data', (data) => {
      const response = data.toString();

      if (step === 0 && response.startsWith('220')) {
        // Server ready
        socket.write(`HELO example.com\r\n`);
        step = 1;
      } else if (step === 1 && response.startsWith('250')) {
        // HELO accepted
        socket.write(`MAIL FROM:<${fromEmail}>\r\n`);
        step = 2;
      } else if (step === 2 && response.startsWith('250')) {
        // MAIL FROM accepted
        socket.write(`RCPT TO:<${email}>\r\n`);
        step = 3;
      } else if (step === 3) {
        // Check RCPT TO response
        const exists = response.startsWith('250');
        socket.write(`QUIT\r\n`);
        socket.end();
        resolve(exists);
      }
    });

    socket.on('error', (error) => {
      logger.debug('email-pattern-matcher', 'SMTP check error', {
        email,
        mxHost,
        error: error.message
      });
      socket.destroy();
      resolve(false);
    });

    socket.on('timeout', () => {
      logger.debug('email-pattern-matcher', 'SMTP check timeout', {
        email,
        mxHost
      });
      socket.destroy();
      resolve(false);
    });
  });
}

module.exports = {
  generateEmailPatterns,
  verifyEmailExists,
  checkSmtpMailbox
};
