const { scrapeGoogleMaps } = require('./ksd/local-outreach/orchestrator/modules/google-maps-scraper');
const { processBusinesses } = require('./ksd/local-outreach/orchestrator/main');

// Test with just a few businesses
scrapeGoogleMaps('Bramhall', 'SK7', ['restaurants'])
  .then(businesses => {
    console.log('Found', businesses.length, 'businesses');
    // Take only first 2 for testing
    const testBusinesses = businesses.slice(0, 2);
    console.log('Testing with', testBusinesses.length, 'businesses:');
    testBusinesses.forEach((b, i) => {
      console.log(`${i+1}. ${b.name} - ${b.postcode || 'No postcode'}`);
    });
    
    // Now test enrichment on just these 2
    return processBusinesses('Bramhall', 'SK7', ['restaurants']).then(enriched => {
      console.log('\nEnriched', enriched.length, 'businesses');
      if (enriched.length > 0) {
        const first = enriched[0];
        console.log('\nFirst business details:');
        console.log('Name:', first.name);
        console.log('Email:', first.ownerEmail || 'Not found');
        console.log('Revenue:', first.estimatedRevenue || 'Not estimated');
        console.log('Tier:', first.assignedOfferTier || 'Not assigned');
      }
    });
  })
  .catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
  });
