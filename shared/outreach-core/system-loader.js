/**
 * System Context Loader
 * Loads SYSTEM_CONTEXT.json at runtime to provide full system understanding
 *
 * This module ensures the entire outreach automation system has access to:
 * - Module documentation (purpose, input, output, whenToUse)
 * - Complete process flow
 * - Email matching rules
 * - Business object structure
 * - Common pitfalls and solutions
 *
 * Called once at application startup to load context into memory.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

let systemContext = null;

/**
 * Load system context from SYSTEM_CONTEXT.json
 * Called once at application startup
 * @returns {Object} System context object
 */
function loadSystemContext() {
  try {
    const contextPath = path.join(__dirname, 'SYSTEM_CONTEXT.json');
    const contextData = fs.readFileSync(contextPath, 'utf8');
    systemContext = JSON.parse(contextData);

    logger.info('system-loader', 'System context loaded successfully', {
      version: systemContext.version,
      systemName: systemContext.systemName,
      moduleCount: Object.keys(systemContext.modules).reduce((count, category) => {
        return count + Object.keys(systemContext.modules[category]).length;
      }, 0),
      lastUpdated: systemContext.lastUpdated
    });

    return systemContext;
  } catch (error) {
    logger.error('system-loader', 'Failed to load system context', {
      error: error.message,
      stack: error.stack
    });
    throw new Error(`System context loading failed: ${error.message}`);
  }
}

/**
 * Get current system context
 * Returns cached context or loads if not yet loaded
 * @returns {Object} System context object
 */
function getSystemContext() {
  if (!systemContext) {
    loadSystemContext();
  }
  return systemContext;
}

/**
 * Get module documentation
 * @param {string} category - Module category (discovery, enrichment, verification, contentGeneration, export, utilities)
 * @param {string} moduleName - Module name (e.g., 'website-scraper', 'lemlist-exporter')
 * @returns {Object|null} Module documentation or null if not found
 */
function getModuleDoc(category, moduleName) {
  const context = getSystemContext();
  const moduleDoc = context.modules[category]?.[moduleName] || null;

  if (!moduleDoc) {
    logger.warn('system-loader', 'Module documentation not found', {
      category,
      moduleName,
      availableCategories: Object.keys(context.modules),
      availableModules: context.modules[category] ? Object.keys(context.modules[category]) : []
    });
  }

  return moduleDoc;
}

/**
 * Get complete process flow documentation
 * @returns {Object} Process flow object with all phases
 */
function getProcessFlow() {
  const context = getSystemContext();
  return context.processFlow || null;
}

/**
 * Get email matching rules
 * Includes personal patterns, role-based patterns, and duplicate handling logic
 * @returns {Object} Email matching rules
 */
function getEmailMatchingRules() {
  const context = getSystemContext();
  return context.emailMatchingRules || null;
}

/**
 * Get multi-owner note formatting rules
 * @returns {Object} Multi-owner note rules
 */
function getMultiOwnerNoteRules() {
  const context = getSystemContext();
  return context.multiOwnerNoteRules || null;
}

/**
 * Get business object structure documentation
 * Shows fields at each stage: afterDiscovery, afterEnrichment, afterMergeVariables
 * @param {string} stage - Stage name (afterDiscovery, afterEnrichment, afterMergeVariables)
 * @returns {Object|null} Business object structure for that stage
 */
function getBusinessObjectStructure(stage) {
  const context = getSystemContext();
  return context.businessObjectStructure?.[stage] || null;
}

/**
 * Get common pitfalls and solutions
 * @returns {Object} Common pitfalls with solutions
 */
function getCommonPitfalls() {
  const context = getSystemContext();
  return context.commonPitfalls || null;
}

/**
 * Get tier pricing configuration
 * @returns {Object} Tier pricing multipliers and base prices
 */
function getTierPricing() {
  const context = getSystemContext();
  return context.tierPricing || null;
}

/**
 * Get nearby postcodes configuration
 * @returns {Object} Nearby postcodes for proximity detection
 */
function getNearbyPostcodes() {
  const context = getSystemContext();
  return context.nearbyPostcodes || null;
}

/**
 * Log system context summary
 * Useful for debugging and understanding what's loaded
 */
function logSystemContextSummary() {
  const context = getSystemContext();

  logger.info('system-loader', '\n╔════════════════════════════════════════════════════════════════════╗');
  logger.info('system-loader', '║                    SYSTEM CONTEXT LOADED                           ║');
  logger.info('system-loader', '╚════════════════════════════════════════════════════════════════════╝\n');

  logger.info('system-loader', `System: ${context.systemName} (v${context.version})`);
  logger.info('system-loader', `Description: ${context.description}`);
  logger.info('system-loader', `Last Updated: ${context.lastUpdated}\n`);

  logger.info('system-loader', 'Modules Loaded:');
  for (const [category, modules] of Object.entries(context.modules)) {
    logger.info('system-loader', `  ${category}:`);
    for (const [moduleName, moduleDoc] of Object.entries(modules)) {
      const status = moduleDoc.status ? ` [${moduleDoc.status}]` : '';
      logger.info('system-loader', `    - ${moduleName}${status}`);
    }
  }

  logger.info('system-loader', '\nProcess Flow:');
  for (const [phaseName, phase] of Object.entries(context.processFlow)) {
    logger.info('system-loader', `  Step ${phase.step}: ${phase.action}`);
    if (phase.subSteps) {
      phase.subSteps.forEach(subStep => {
        logger.info('system-loader', `    → ${subStep}`);
      });
    }
  }

  logger.info('system-loader', '\nEmail Matching:');
  logger.info('system-loader', `  Personal Patterns: ${context.emailMatchingRules.personalPatterns.patterns.length} patterns`);
  logger.info('system-loader', `  Role-Based Patterns: ${Object.keys(context.emailMatchingRules.roleBasedPatterns.mappings).length} role types`);
  logger.info('system-loader', `  Duplicate Handling: ${context.emailMatchingRules.duplicateHandling.rule}`);

  logger.info('system-loader', '\n═══════════════════════════════════════════════════════════════════\n');
}

module.exports = {
  loadSystemContext,
  getSystemContext,
  getModuleDoc,
  getProcessFlow,
  getEmailMatchingRules,
  getMultiOwnerNoteRules,
  getBusinessObjectStructure,
  getCommonPitfalls,
  getTierPricing,
  getNearbyPostcodes,
  logSystemContextSummary
};
