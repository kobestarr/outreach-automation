/**
 * Email Human Review Generator
 * Generates sample emails for human review and feedback
 */

const fs = require('fs');
const path = require('path');
const { generateEmailContent } = require('../../../../shared/outreach-core/content-generation');
const { assignTier, loadTierConfig } = require('../modules/tier-assigner');
const { scoreEmailQuality } = require('../../../../shared/outreach-core/content-generation/email-quality-validator');

// Parse command line arguments
const args = process.argv.slice(2);
const categoryFilter = args.includes('--category') ? args[args.indexOf('--category') + 1] : null;
const tierFilter = args.includes('--tier') ? args[args.indexOf('--tier') + 1] : null;
const outputFile = args.includes('--output') ? args[args.indexOf('--output') + 1] : null;
const samplesPerScenario = parseInt(args.includes('--samples') ? args[args.indexOf('--samples') + 1] : '5', 10);

/**
 * Generate test scenarios for human review
 */
function generateReviewScenarios() {
  const scenarios = [];
  const tierConfig = loadTierConfig();
  
  // Category configurations
  const categories = [
    { name: 'Restaurant', category: 'Restaurant', jtbdFear: 'Getting more customers through the door', barterEligible: true }
  ];
  
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
    { name: 'No Barter', barterAvailable: false, barterEligible: false }
  ];
  
  // Generate scenarios
  categories.forEach(cat => {
    if (categoryFilter && categoryFilter !== 'all' && !cat.name.toLowerCase().includes(categoryFilter.toLowerCase())) {
      return;
    }
    
    const tiers = tierFilter && tierFilter !== 'all' 
      ? [tierFilter] 
      : Object.keys(tierConfig.tiers);
    
    tiers.forEach(tierId => {
      const tier = tierConfig.tiers[tierId];
      const revenue = (tier.revenueRange[0] + tier.revenueRange[1]) / 2;
      
      dataQualityScenarios.forEach(dataQuality => {
        barterScenarios.forEach(barter => {
          if (barter.barterEligible && !cat.barterEligible) {
            return;
          }
          
          const barterOpportunity = barter.barterEligible ? {
            eligible: barter.barterEligible,
            available: barter.barterAvailable,
            offering: cat.barterEligible ? 'service credits' : null
          } : null;
          
          scenarios.push({
            id: `${cat.name.toLowerCase()}-${tierId}-${dataQuality.name.toLowerCase().replace(/\s+/g, '-')}-${barter.name.toLowerCase().replace(/\s+/g, '-')}`,
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
            tierName: tier.name,
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
 * Generate multiple samples for a scenario
 */
async function generateSamples(scenario, count = 5) {
  const samples = [];
  
  for (let i = 0; i < count; i++) {
    try {
      const email = await generateEmailContent(scenario.businessData);
      const quality = scoreEmailQuality(email, scenario.businessData);
      
      samples.push({
        number: i + 1,
        email,
        quality
      });
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      samples.push({
        number: i + 1,
        error: error.message
      });
    }
  }
  
  return samples;
}

/**
 * Format scenario for review
 */
function formatScenarioForReview(scenario, samples) {
  const { businessData, tier, tierName, dataQuality, barter } = scenario;
  
  let output = `\n${'='.repeat(80)}\n`;
  output += `SCENARIO: ${scenario.category} - ${tierName} (${tier}) - ${dataQuality} - ${barter}\n`;
  output += `${'='.repeat(80)}\n\n`;
  
  output += `BUSINESS CONTEXT:\n`;
  output += `  Business Name: ${businessData.businessName}\n`;
  output += `  Owner: ${businessData.ownerFirstName} ${businessData.ownerLastName || ''}\n`;
  output += `  Location: ${businessData.location}, ${businessData.postcode}\n`;
  output += `  Address: ${businessData.address}\n`;
  output += `  Website: ${businessData.website}\n`;
  output += `  Rating: ${businessData.rating || 'N/A'} (${businessData.reviewCount || 0} reviews)\n`;
  output += `  Revenue Band: ${businessData.revenueBand}\n`;
  output += `  Tier: ${tierName} (${tier})\n`;
  output += `  Setup Fee: £${businessData.setupFee}\n`;
  output += `  Monthly Price: £${businessData.monthlyPrice}\n`;
  output += `  GHL Offer: ${businessData.ghlOffer}\n`;
  output += `  Lead Magnet: ${businessData.leadMagnet}\n`;
  output += `  JTBD Fear: ${businessData.jtbdFear}\n`;
  if (businessData.barterOpportunity) {
    output += `  Barter: ${businessData.barterOpportunity.available ? 'Available' : 'Not Available'} (${businessData.barterOpportunity.offering || 'N/A'})\n`;
  } else {
    output += `  Barter: Not Eligible\n`;
  }
  output += `\n`;
  
  samples.forEach((sample, idx) => {
    output += `${'-'.repeat(80)}\n`;
    output += `EMAIL SAMPLE ${sample.number}:\n`;
    output += `${'-'.repeat(80)}\n`;
    
    if (sample.error) {
      output += `ERROR: ${sample.error}\n\n`;
      return;
    }
    
    output += `Subject: ${sample.email.subject}\n\n`;
    output += `Body:\n${sample.email.body}\n\n`;
    
    if (sample.quality) {
      output += `Quality Score: ${sample.quality.overallScore}%\n`;
      if (sample.quality.issues.length > 0) {
        output += `Issues:\n`;
        sample.quality.issues.forEach(issue => {
          output += `  - ${issue}\n`;
        });
      }
      output += `\n`;
      output += `Quality Breakdown:\n`;
      output += `  UK Tone: ${sample.quality.checks.ukTone.score}% ${sample.quality.checks.ukTone.passed ? '✅' : '❌'}\n`;
      output += `  Length: ${sample.quality.checks.length.score}% (${sample.quality.checks.length.wordCount} words, ${sample.quality.checks.length.charCount} chars) ${sample.quality.checks.length.passed ? '✅' : '❌'}\n`;
      output += `  Personalization: ${sample.quality.checks.personalization.score}% ${sample.quality.checks.personalization.passed ? '✅' : '❌'}\n`;
      output += `  Rating Handling: ${sample.quality.checks.rating.score}% ${sample.quality.checks.rating.passed ? '✅' : '❌'}\n`;
      output += `  Banned Phrases: ${sample.quality.checks.banned.score}% ${sample.quality.checks.banned.passed ? '✅' : '❌'}\n`;
      output += `  Subject Parsing: ${sample.quality.checks.subject.score}% ${sample.quality.checks.subject.passed ? '✅' : '❌'}\n`;
      output += `  CTA: ${sample.quality.checks.cta.score}% ${sample.quality.checks.cta.passed ? '✅' : '❌'}\n`;
    }
    output += `\n`;
  });
  
  return output;
}

/**
 * Main function
 */
async function runReviewGeneration() {
  console.log('📧 Email Human Review Generator\n');
  console.log('='.repeat(80));
  
  const scenarios = generateReviewScenarios();
  console.log(`\n📊 Generated ${scenarios.length} scenarios for review\n`);
  
  if (categoryFilter) console.log(`Filter: Category = ${categoryFilter}`);
  if (tierFilter) console.log(`Filter: Tier = ${tierFilter}`);
  console.log(`Samples per scenario: ${samplesPerScenario}\n`);
  
  let fullOutput = `# Email Samples for Human Review\n\n`;
  fullOutput += `Generated: ${new Date().toISOString()}\n`;
  fullOutput += `Total Scenarios: ${scenarios.length}\n`;
  fullOutput += `Samples per Scenario: ${samplesPerScenario}\n`;
  fullOutput += `Total Emails: ${scenarios.length * samplesPerScenario}\n\n`;
  
  if (categoryFilter) fullOutput += `Category Filter: ${categoryFilter}\n`;
  if (tierFilter) fullOutput += `Tier Filter: ${tierFilter}\n`;
  fullOutput += `\n`;
  
  // Process each scenario
  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    console.log(`[${i + 1}/${scenarios.length}] Generating samples for: ${scenario.id}...`);
    
    const samples = await generateSamples(scenario, samplesPerScenario);
    const formatted = formatScenarioForReview(scenario, samples);
    
    console.log(`  ✅ Generated ${samples.filter(s => !s.error).length}/${samplesPerScenario} samples`);
    
    fullOutput += formatted;
  }
  
  // Save to file if specified
  if (outputFile) {
    const outputPath = path.isAbsolute(outputFile) 
      ? outputFile 
      : path.join(process.cwd(), outputFile);
    
    fs.writeFileSync(outputPath, fullOutput, 'utf8');
    console.log(`\n✅ Review file saved to: ${outputPath}`);
  }
  
  // Also output to console
  console.log('\n' + '='.repeat(80));
  console.log('📄 REVIEW OUTPUT');
  console.log('='.repeat(80));
  console.log(fullOutput);
  
  return {
    scenarios: scenarios.length,
    totalSamples: scenarios.length * samplesPerScenario,
    outputFile
  };
}

// Run if called directly
if (require.main === module) {
  runReviewGeneration().catch(error => {
    console.error('\n❌ Review generation failed:', error);
    process.exit(1);
  });
}

module.exports = {
  generateReviewScenarios,
  generateSamples,
  formatScenarioForReview,
  runReviewGeneration
};
