/**
 * Test System Context Loading
 * Verifies that SYSTEM_CONTEXT.json loads correctly and provides full system understanding
 */

const {
  loadSystemContext,
  getSystemContext,
  getModuleDoc,
  getProcessFlow,
  getEmailMatchingRules,
  logSystemContextSummary
} = require('../shared/outreach-core/system-loader');

async function testSystemContext() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         TEST: System Context Loading & Understanding              ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  try {
    // Load system context
    console.log('📚 Loading system context from SYSTEM_CONTEXT.json...\n');
    const context = loadSystemContext();

    console.log('✅ System context loaded successfully!\n');

    // Display summary
    logSystemContextSummary();

    // Test: Get module documentation
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 1: Module Documentation');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const scraperDoc = getModuleDoc('enrichment', 'website-scraper');
    console.log('Module: website-scraper');
    console.log(`Purpose: ${scraperDoc.purpose}`);
    console.log(`When to use: ${scraperDoc.whenToUse}`);
    console.log(`Key Behavior: ${scraperDoc.keyBehavior}\n`);

    // Test: Get process flow
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 2: Process Flow');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const processFlow = getProcessFlow();
    console.log('Phase 2: Data Collection');
    console.log(`Action: ${processFlow.phase2_dataCollection.action}`);
    console.log('Sub-steps:');
    processFlow.phase2_dataCollection.subSteps.forEach(step => {
      console.log(`  → ${step}`);
    });
    console.log(`Key Point: ${processFlow.phase2_dataCollection.keyPoint}\n`);

    // Test: Get email matching rules
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 3: Email Matching Rules');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const emailRules = getEmailMatchingRules();
    console.log('Personal Email Patterns (Priority 1):');
    emailRules.personalPatterns.patterns.forEach(pattern => {
      console.log(`  - ${pattern}`);
    });

    console.log('\nRole-Based Patterns (Priority 2):');
    for (const [role, config] of Object.entries(emailRules.roleBasedPatterns.mappings)) {
      console.log(`  ${role}:`);
      config.patterns.forEach(pattern => {
        console.log(`    - ${pattern}`);
      });
    }

    console.log('\nDuplicate Handling:');
    console.log(`  Rule: ${emailRules.duplicateHandling.rule}`);
    console.log(`  Priority: ${emailRules.duplicateHandling.priority}`);
    console.log(`  Implementation: ${emailRules.duplicateHandling.implementation}\n`);

    console.log('Example Scenario:');
    const example = emailRules.duplicateHandling.example;
    console.log(`  Scenario: ${example.scenario}`);
    console.log(`  Input: ${example.input.join(', ')}`);
    console.log('  Output:');
    example.output.forEach(line => {
      console.log(`    - ${line}`);
    });
    console.log(`  Email Match Count: ${example.emailMatchCount}`);
    console.log(`  Note: ${example.note}\n`);

    // Test: Verify all critical information is present
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 4: Critical Information Verification');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const checks = [
      { name: 'System version', value: context.version, expected: '1.0.0' },
      { name: 'Module count', value: Object.keys(context.modules).length, expected: 6 },
      { name: 'Process flow phases', value: Object.keys(context.processFlow).length, expected: 4 },
      { name: 'Email matching rules', value: !!context.emailMatchingRules, expected: true },
      { name: 'Business object structure', value: !!context.businessObjectStructure, expected: true },
      { name: 'Common pitfalls', value: !!context.commonPitfalls, expected: true },
      { name: 'Tier pricing', value: !!context.tierPricing, expected: true }
    ];

    let allPassed = true;
    checks.forEach(check => {
      const passed = check.value === check.expected;
      const icon = passed ? '✅' : '❌';
      console.log(`  ${icon} ${check.name}: ${check.value}`);
      if (!passed) allPassed = false;
    });

    console.log();

    if (allPassed) {
      console.log('╔════════════════════════════════════════════════════════════════════╗');
      console.log('║         ✅ ALL TESTS PASSED - SYSTEM CONTEXT WORKING ✅           ║');
      console.log('║                                                                    ║');
      console.log('║  The system now fully understands its architecture on every run!  ║');
      console.log('║                                                                    ║');
      console.log('║  Features:                                                         ║');
      console.log('║  - All modules documented with purpose, input, output              ║');
      console.log('║  - Complete process flow with sub-steps                            ║');
      console.log('║  - Email matching rules with examples                              ║');
      console.log('║  - Duplicate handling logic documented                             ║');
      console.log('║  - Business object structure at each stage                         ║');
      console.log('║  - Common pitfalls and solutions                                   ║');
      console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    } else {
      console.log('╔════════════════════════════════════════════════════════════════════╗');
      console.log('║              ⚠️  SOME TESTS FAILED ⚠️                             ║');
      console.log('╚════════════════════════════════════════════════════════════════════╝\n');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ System context test failed:');
    console.error(`   Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}\n`);
    process.exit(1);
  }
}

testSystemContext();
