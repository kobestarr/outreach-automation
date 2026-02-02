/**
 * Email Prompt Tester
 * Comprehensive testing framework for email generation across all scenarios
 */

const { generateEmailContent, generateEmailSequence } = require('../../../../shared/outreach-core/content-generation');
const { assignTier, loadTierConfig } = require('../modules/tier-assigner');
const { detectBarterOpportunity } = require('../modules/barter-detector');
const { scoreEmailQuality } = require('../../../../shared/outreach-core/content-generation/email-quality-validator');

// Parse command line arguments
const args = process.argv.slice(2);
const categoryFilter = args.includes('--category') ? args[args.indexOf('--category') + 1] : null;
const tierFilter = args.includes('--tier') ? args[args.indexOf('--tier') + 1] : null;
const scenarioFilter = args.includes('--scenario') ? args[args.indexOf('--scenario') + 1] : null;

/**
 * Generate test scenarios matrix
 */
function generateTestScenarios() {
  const scenarios = [];
  
  // Category-based scenarios
  const categories = [
    { name: 'Restaurant', category: 'Restaurant', jtbdFear: 'Getting more customers through the door', barterEligible: true },
    { name: 'Salon', category: 'Hair Salon', jtbdFear: 'Building client loyalty', barterEligible: true },
    { name: 'Gym', category: 'Gym', jtbdFear: 'Increasing membership retention', barterEligible: true },
    { name: 'Dentist', category: 'Dentist', jtbdFear: 'Attracting new patients', barterEligible: true },
    { name: 'Plumber', category: 'Plumber', jtbdFear: 'Managing emergency calls efficiently', barterEligible: true },
    { name: 'Cafe', category: 'Cafe', jtbdFear: 'Building morning rush business', barterEligible: true },
    { name: 'Accountant', category: 'Accountant', jtbdFear: 'Streamlining tax season workload', barterEligible: false }
  ];
  
  // Tier scenarios (using tier config)
  const tierConfig = loadTierConfig();
  const tiers = Object.keys(tierConfig.tiers);
  
  // Data quality scenarios
  const dataQualityScenarios = [
    { name: 'High Rating', rating: 4.8, reviewCount: 250 },
    { name: 'Low Rating', rating: 3.2, reviewCount: 15 },
    { name: 'No Reviews', rating: null, reviewCount: 0 },
    { name: 'Standard', rating: 4.5, reviewCount: 127 }
  ];
  
  // Barter scenarios
  const barterScenarios = [
    { name: 'With Barter', barterAvailable: true, barterEligible: true },
    { name: 'No Barter', barterAvailable: false, barterEligible: false },
    { name: 'Barter Taken', barterAvailable: false, barterEligible: true }
  ];
  
  // Generate all combinations
  categories.forEach(cat => {
    if (categoryFilter && categoryFilter !== 'all' && !cat.name.toLowerCase().includes(categoryFilter.toLowerCase())) {
      return;
    }
    
    tiers.forEach(tierId => {
      if (tierFilter && tierFilter !== 'all' && tierId !== tierFilter) {
        return;
      }
      
      const tier = tierConfig.tiers[tierId];
      const revenue = (tier.revenueRange[0] + tier.revenueRange[1]) / 2; // Mid-point
      
      dataQualityScenarios.forEach(dataQuality => {
        barterScenarios.forEach(barter => {
          // Only test barter if category is eligible
          if (barter.barterEligible && !cat.barterEligible) {
            return;
          }
          
          const barterOpportunity = barter.barterEligible ? {
            eligible: barter.barterEligible,
            available: barter.barterAvailable,
            offering: cat.barterEligible ? 'service credits' : null
          } : null;
          
          scenarios.push({
            id: `${cat.name}-${tierId}-${dataQuality.name}-${barter.name}`.toLowerCase().replace(/\s+/g, '-'),
            category: cat.name,
            businessData: {
              businessName: `The ${cat.name} Test`,
              ownerFirstName: 'Sarah',
              ownerLastName: 'Johnson',
              category: cat.category,
              location: 'Bramhall',
              postcode: 'SK7',
              address: `123 High Street, Bramhall`,
              website: `https://www.test${cat.name.toLowerCase()}.co.uk`,
              rating: dataQuality.rating,
              reviewCount: dataQuality.reviewCount,
              estimatedRevenue: revenue,
              revenueBand: `£${Math.round(revenue / 1000)}k`,
              assignedOfferTier: parseInt(tierId.replace('tier', '')),
              setupFee: tier.setupFee,
              monthlyPrice: tier.monthlyPrice,
              ghlOffer: tier.ghlOffer,
              leadMagnet: tier.leadMagnet,
              jtbdFear: cat.jtbdFear,
              barterOpportunity
            },
            tier: tierId,
            dataQuality: dataQuality.name,
            barter: barter.name
          });
        });
      });
    });
  });
  
  return scenarios;
}

/**
 * Test a single scenario
 */
async function testScenario(scenario) {
  try {
    // Generate single email
    const email = await generateEmailContent(scenario.businessData);
    
    // Generate email sequence
    const sequence = await generateEmailSequence(scenario.businessData);
    
    // Score quality
    const singleScore = scoreEmailQuality(email, scenario.businessData);
    const sequenceScores = sequence.map(e => scoreEmailQuality(e, scenario.businessData));
    
    return {
      scenario,
      singleEmail: {
        email,
        score: singleScore
      },
      sequence: sequence.map((e, i) => ({
        email: e,
        score: sequenceScores[i],
        position: i + 1
      })),
      passed: singleScore.passed && sequenceScores.every(s => s.passed)
    };
  } catch (error) {
    return {
      scenario,
      error: error.message,
      passed: false
    };
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('🧪 Email Prompt Testing Framework\n');
  console.log('='.repeat(70));
  
  const scenarios = generateTestScenarios();
  console.log(`\n📊 Generated ${scenarios.length} test scenarios\n`);
  
  if (categoryFilter) console.log(`Filter: Category = ${categoryFilter}`);
  if (tierFilter) console.log(`Filter: Tier = ${tierFilter}`);
  if (scenarioFilter) console.log(`Filter: Scenario = ${scenarioFilter}`);
  console.log('');
  
  const results = [];
  let passed = 0;
  let failed = 0;
  
  // Test each scenario
  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    if (scenarioFilter && scenario.id !== scenarioFilter) continue;
    
    process.stdout.write(`Testing ${i + 1}/${scenarios.length}: ${scenario.id}... `);
    
    const result = await testScenario(scenario);
    results.push(result);
    
    if (result.passed) {
      console.log('✅ PASSED');
      passed++;
    } else {
      console.log('❌ FAILED');
      failed++;
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    }
    
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Generate report
  console.log('\n' + '='.repeat(70));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('='.repeat(70));
  console.log(`\nTotal Scenarios: ${scenarios.length}`);
  console.log(`Passed: ${passed} (${Math.round(passed/scenarios.length*100)}%)`);
  console.log(`Failed: ${failed} (${Math.round(failed/scenarios.length*100)}%)`);
  
  // Show failed scenarios with details
  const failedResults = results.filter(r => !r.passed);
  if (failedResults.length > 0) {
    console.log('\n❌ FAILED SCENARIOS:\n');
    failedResults.slice(0, 10).forEach(result => {
      console.log(`\n${result.scenario.id}:`);
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      } else {
        console.log(`  Single Email Score: ${result.singleEmail.score.overallScore}%`);
        if (result.singleEmail.score.issues.length > 0) {
          console.log(`  Issues: ${result.singleEmail.score.issues.slice(0, 3).join(', ')}`);
        }
      }
    });
    
    if (failedResults.length > 10) {
      console.log(`\n... and ${failedResults.length - 10} more failed scenarios`);
    }
  }
  
  // Show sample emails from passed scenarios
  const passedResults = results.filter(r => r.passed);
  if (passedResults.length > 0) {
    console.log('\n✅ SAMPLE PASSED EMAILS:\n');
    passedResults.slice(0, 3).forEach(result => {
      console.log(`\n${result.scenario.id}:`);
      console.log(`Subject: ${result.singleEmail.email.subject}`);
      console.log(`Body: ${result.singleEmail.email.body.substring(0, 150)}...`);
      console.log(`Score: ${result.singleEmail.score.overallScore}%`);
    });
  }
  
  return {
    total: scenarios.length,
    passed,
    failed,
    results
  };
}

// Run if called directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = {
  generateTestScenarios,
  testScenario,
  runTests
};
