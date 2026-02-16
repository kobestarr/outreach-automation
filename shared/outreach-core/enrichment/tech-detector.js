/**
 * Website Technology & Age Detection
 * Lightweight Wappalyzer-style fingerprinting from HTML + headers
 *
 * Detects:
 * - CMS/platform (WordPress, Wix, Squarespace, HubSpot, Shopify, etc.)
 * - JavaScript frameworks (React, Next.js, Vue, Angular)
 * - Age signals (old-school HTML patterns, non-responsive, Flash, table layouts)
 */

const logger = require('../logger');

/**
 * CMS/Platform fingerprints — checked against HTML content
 * Each entry: { name, patterns: [regex], meta: [{ name, content }], scripts: [string] }
 */
const CMS_FINGERPRINTS = [
  {
    name: 'WordPress',
    patterns: [/wp-content\//i, /wp-includes\//i, /wp-json/i],
    meta: [{ name: 'generator', content: /wordpress/i }],
    scripts: ['wp-emoji-release.min.js', 'jquery.min.js?ver=']
  },
  {
    name: 'Wix',
    patterns: [/wixCssCustom/i, /thunderbolt-/i, /wix-thunderbolt/i, /wixpress\.com/i, /SITE_CONTAINER/],
    meta: [{ name: 'generator', content: /wix\.com/i }],
    scripts: []
  },
  {
    name: 'Squarespace',
    patterns: [/sqs-block-/i, /sqsp-/i, /squarespace\.com/i, /squarespace-cdn/i],
    meta: [{ name: 'generator', content: /squarespace/i }],
    scripts: ['squarespace.com']
  },
  {
    name: 'Shopify',
    patterns: [/cdn\.shopify\.com/i, /Shopify\.theme/i, /shopify-section/i],
    meta: [{ name: 'generator', content: /shopify/i }],
    scripts: ['cdn.shopify.com']
  },
  {
    name: 'HubSpot',
    patterns: [/hs-scripts\.com/i, /hubspot/i, /hs-banner/i, /hbspt\./i],
    meta: [],
    scripts: ['js.hs-scripts.com', 'js.hubspot.com']
  },
  {
    name: 'Webflow',
    patterns: [/webflow\.com/i, /wf-/i, /data-wf-/i],
    meta: [{ name: 'generator', content: /webflow/i }],
    scripts: ['webflow.js']
  },
  {
    name: 'Joomla',
    patterns: [/\/media\/jui\//i, /\/components\/com_/i],
    meta: [{ name: 'generator', content: /joomla/i }],
    scripts: []
  },
  {
    name: 'Drupal',
    patterns: [/\/sites\/default\/files\//i, /drupal\.js/i, /Drupal\.settings/i],
    meta: [{ name: 'generator', content: /drupal/i }],
    scripts: ['drupal.js']
  },
  {
    name: 'Divi (WordPress)',
    patterns: [/et-boc/i, /et_pb_/i, /divi/i, /et-l\s/i],
    meta: [],
    scripts: ['divi']
  },
  {
    name: 'Elementor (WordPress)',
    patterns: [/elementor/i, /e-con-inner/i],
    meta: [],
    scripts: ['elementor']
  },
  {
    name: 'GoDaddy Website Builder',
    patterns: [/godaddy\.com/i, /wsb-/i],
    meta: [{ name: 'generator', content: /godaddy/i }],
    scripts: ['godaddy.com']
  },
  {
    name: 'Weebly',
    patterns: [/weebly\.com/i, /wsite-/i],
    meta: [],
    scripts: ['weebly.com']
  }
];

/**
 * Age signals — patterns that suggest an older website
 */
const AGE_SIGNALS = {
  veryOld: [ // Pre-2010
    { pattern: /<table[^>]*(?:width|cellpadding|cellspacing|bgcolor)/i, signal: 'Table-based layout' },
    { pattern: /<font\s/i, signal: 'Font tags (HTML4)' },
    { pattern: /<center>/i, signal: 'Center tags (deprecated)' },
    { pattern: /\.swf/i, signal: 'Flash content (.swf)' },
    { pattern: /<frameset/i, signal: 'Frames (HTML4)' },
    { pattern: /<marquee/i, signal: 'Marquee tag (deprecated)' },
    { pattern: /<blink/i, signal: 'Blink tag (deprecated)' },
    { pattern: /bgcolor=/i, signal: 'Bgcolor attribute (inline styling)' }
  ],
  old: [ // 2010-2015
    { pattern: /<!DOCTYPE html PUBLIC/i, signal: 'HTML4/XHTML doctype' },
    { pattern: /http-equiv="X-UA-Compatible"/i, signal: 'IE compatibility meta' },
    { pattern: /<!--\[if IE/i, signal: 'IE conditional comments' },
    { pattern: /jquery-1\./i, signal: 'jQuery 1.x' },
    { pattern: /bootstrap\/[23]\./i, signal: 'Bootstrap 2-3' }
  ],
  modern: [ // 2020+
    { pattern: /<meta\s+name="viewport"/i, signal: 'Responsive viewport' },
    { pattern: /loading="lazy"/i, signal: 'Lazy loading' },
    { pattern: /srcset=/i, signal: 'Responsive images (srcset)' },
    { pattern: /type="module"/i, signal: 'ES modules' },
    { pattern: /<link[^>]*rel="preload"/i, signal: 'Resource preloading' }
  ]
};

/**
 * Detect website technology stack from HTML content
 * @param {string} html - HTML content
 * @param {Object} headers - HTTP response headers (optional)
 * @returns {Object} Detection results
 */
function detectTech(html, headers = {}) {
  if (!html) return { cms: null, frameworks: [], ageEstimate: 'unknown', ageSignals: [] };

  // Detect CMS/platform
  const detectedCms = [];
  for (const cms of CMS_FINGERPRINTS) {
    let score = 0;

    // Check HTML patterns
    for (const pattern of cms.patterns) {
      if (pattern.test(html)) {
        score++;
      }
    }

    // Check meta tags
    for (const meta of cms.meta) {
      const metaRegex = new RegExp(`<meta[^>]*name=["']${meta.name}["'][^>]*content=["']([^"']+)["']`, 'i');
      const metaMatch = html.match(metaRegex);
      if (metaMatch && meta.content.test(metaMatch[1])) {
        score += 2; // Meta generator is strong signal
      }
    }

    // Check scripts
    for (const script of cms.scripts) {
      if (html.includes(script)) {
        score++;
      }
    }

    if (score >= 2) {
      detectedCms.push({ name: cms.name, confidence: Math.min(score * 25, 100) });
    }
  }

  // Sort by confidence
  detectedCms.sort((a, b) => b.confidence - a.confidence);

  // Detect age signals
  const ageSignals = { veryOld: [], old: [], modern: [] };

  for (const signal of AGE_SIGNALS.veryOld) {
    if (signal.pattern.test(html)) {
      ageSignals.veryOld.push(signal.signal);
    }
  }
  for (const signal of AGE_SIGNALS.old) {
    if (signal.pattern.test(html)) {
      ageSignals.old.push(signal.signal);
    }
  }
  for (const signal of AGE_SIGNALS.modern) {
    if (signal.pattern.test(html)) {
      ageSignals.modern.push(signal.signal);
    }
  }

  // Estimate age
  let ageEstimate;
  if (ageSignals.veryOld.length >= 2) {
    ageEstimate = 'pre-2010';
  } else if (ageSignals.veryOld.length >= 1 || (ageSignals.old.length >= 2 && ageSignals.modern.length === 0)) {
    ageEstimate = '2010-2015';
  } else if (ageSignals.modern.length >= 2) {
    ageEstimate = '2020+';
  } else if (ageSignals.old.length >= 1) {
    ageEstimate = '2015-2020';
  } else {
    ageEstimate = 'unknown';
  }

  // Check headers for tech hints
  const serverHeader = headers['server'] || headers['Server'] || '';
  const poweredBy = headers['x-powered-by'] || headers['X-Powered-By'] || '';

  // Extract WordPress version from generator meta
  let cmsVersion = null;
  const wpVersionMatch = html.match(/<meta\s+name="generator"\s+content="WordPress\s+([^"]+)"/i);
  if (wpVersionMatch) {
    cmsVersion = wpVersionMatch[1];
  }

  const result = {
    cms: detectedCms.length > 0 ? detectedCms[0].name : null,
    cmsConfidence: detectedCms.length > 0 ? detectedCms[0].confidence : 0,
    cmsVersion: cmsVersion,
    allCms: detectedCms,
    ageEstimate: ageEstimate,
    ageSignals: {
      veryOld: ageSignals.veryOld,
      old: ageSignals.old,
      modern: ageSignals.modern
    },
    server: serverHeader || null,
    poweredBy: poweredBy || null,
    hasResponsiveViewport: /name="viewport"/.test(html),
    hasSSL: null // Set by caller based on URL
  };

  logger.debug('tech-detector', 'Tech detection complete', {
    cms: result.cms,
    cmsConfidence: result.cmsConfidence,
    ageEstimate: result.ageEstimate,
    veryOldSignals: ageSignals.veryOld.length,
    modernSignals: ageSignals.modern.length
  });

  return result;
}

/**
 * Get a human-readable summary of tech detection
 * @param {Object} techResult - Result from detectTech()
 * @returns {string} Summary string
 */
function getTechSummary(techResult) {
  const parts = [];

  if (techResult.cms) {
    let cmsPart = techResult.cms;
    if (techResult.cmsVersion) cmsPart += ` ${techResult.cmsVersion}`;
    cmsPart += ` (${techResult.cmsConfidence}% confidence)`;
    parts.push(cmsPart);
  } else {
    parts.push('Unknown CMS');
  }

  if (techResult.ageEstimate !== 'unknown') {
    parts.push(`Est. ${techResult.ageEstimate}`);
  }

  if (!techResult.hasResponsiveViewport) {
    parts.push('Not responsive');
  }

  const oldSignals = [...techResult.ageSignals.veryOld, ...techResult.ageSignals.old];
  if (oldSignals.length > 0) {
    parts.push(`Old: ${oldSignals.join(', ')}`);
  }

  return parts.join(' | ');
}

module.exports = {
  detectTech,
  getTechSummary,
  CMS_FINGERPRINTS,
  AGE_SIGNALS
};
