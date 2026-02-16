/**
 * Browser Fetcher Module
 * Uses Playwright to render JS-heavy sites (Wix, Squarespace, Divi, etc.)
 *
 * This is a FALLBACK — native HTTP fetch is always tried first.
 * Only used when detection heuristic identifies a JS-rendered site.
 *
 * Browser lifecycle:
 * - Lazy init: browser only launched when first needed
 * - Reuse: single browser instance shared across pages in a scrape run
 * - Auto-cleanup: closeBrowser() + process exit safety net
 */

const logger = require('../logger');

let browser = null;

/**
 * Detect if HTML is from a JS-rendered site that needs browser rendering
 * @param {string} html - Raw HTML from native HTTP fetch
 * @returns {boolean} True if site needs Playwright rendering
 */
function needsBrowserRendering(html) {
  if (!html || typeof html !== 'string') return false;

  // Check for known JS framework markers
  const frameworkMarkers = [
    // Wix
    'wix-warmup-data',
    'wixCssCustom',
    'X-Wix-',
    'wix-site',
    'wixCodeInit',
    'thunderbolt-',

    // Squarespace
    'data-layout-label',
    'squarespace.com/universal',
    'sqs-block',

    // Heavy SPA shells
    '__NEXT_DATA__',
    '__NUXT__',
  ];

  const hasFrameworkMarker = frameworkMarkers.some(marker => html.includes(marker));

  if (hasFrameworkMarker) {
    // Also check that the body has very little visible text
    // (a Wix site with good meta content might still have useful static text)
    const visibleText = extractVisibleText(html);
    if (visibleText.length < 500) {
      logger.debug('browser-fetcher', 'Framework marker detected with thin content', {
        visibleTextLength: visibleText.length,
        marker: frameworkMarkers.find(m => html.includes(m))
      });
      return true;
    }
  }

  // Generic detection: lots of HTML but very little visible text
  if (html.length > 10000) {
    const visibleText = extractVisibleText(html);
    if (visibleText.length < 200) {
      logger.debug('browser-fetcher', 'Thin content detected (generic)', {
        htmlLength: html.length,
        visibleTextLength: visibleText.length
      });
      return true;
    }
  }

  return false;
}

/**
 * Extract visible text from HTML (strip scripts, styles, and tags)
 * @param {string} html - HTML content
 * @returns {string} Visible text content
 */
function extractVisibleText(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Initialize browser (lazy — only called when needed)
 * @returns {Promise<Object>} Playwright browser instance
 */
async function initBrowser() {
  if (browser) return browser;

  const { chromium } = require('playwright');

  logger.info('browser-fetcher', 'Launching headless Chromium');

  browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ]
  });

  return browser;
}

/**
 * Fetch a URL using Playwright headless browser
 * @param {string} url - URL to fetch
 * @param {number} timeout - Timeout in ms (default 15000)
 * @returns {Promise<string|null>} Rendered HTML or null on failure
 */
async function fetchWithBrowser(url, timeout = 15000) {
  let page = null;

  try {
    const browserInstance = await initBrowser();
    page = await browserInstance.newPage();

    // Block unnecessary resources for speed
    await page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (['image', 'media', 'font'].includes(resourceType)) {
        return route.abort();
      }
      return route.continue();
    });

    // Set a realistic user agent
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-GB,en;q=0.9',
    });

    logger.info('browser-fetcher', 'Rendering page with Playwright', { url });

    // Navigate and wait for network to settle
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: timeout,
    });

    // Small extra wait for any late JS rendering
    await page.waitForTimeout(1000);

    // Get fully rendered HTML
    const html = await page.content();

    logger.info('browser-fetcher', 'Page rendered successfully', {
      url,
      htmlLength: html.length,
      visibleTextLength: extractVisibleText(html).length
    });

    return html;
  } catch (error) {
    logger.warn('browser-fetcher', 'Playwright rendering failed', {
      url,
      error: error.message
    });
    return null;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (e) {
        // Page may already be closed
      }
    }
  }
}

/**
 * Close browser instance and clean up
 * Safe to call multiple times (no-op if browser not running)
 */
async function closeBrowser() {
  if (browser) {
    try {
      await browser.close();
      logger.debug('browser-fetcher', 'Browser closed');
    } catch (e) {
      // Browser may already be closed
    }
    browser = null;
  }
}

// Safety net: clean up browser on process exit
process.on('exit', () => {
  if (browser) {
    try {
      browser.close();
    } catch (e) {
      // Sync close attempt — may not work but best effort
    }
  }
});

module.exports = {
  needsBrowserRendering,
  fetchWithBrowser,
  closeBrowser,
  extractVisibleText, // Exported for testing
};
