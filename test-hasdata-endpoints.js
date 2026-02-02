const https = require('https');
const { getCredential } = require('./shared/outreach-core/credentials-loader');

const apiKey = getCredential('hasdata', 'apiKey');
const jobId = 289535;

// Try different endpoint formats
const endpoints = [
  `/scrapers/google-maps/jobs/${jobId}`,
  `/scrapers/google-maps/jobs/${jobId}/results`,
  `/scrapers/google-maps/jobs/${jobId}/status`,
  `/jobs/${jobId}`,
  `/scrapers/google-maps/${jobId}`
];

function tryEndpoint(path) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.hasdata.com',
      path: path,
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          path,
          status: res.statusCode,
          data: data.substring(0, 200)
        });
      });
    });
    
    req.on('error', () => resolve({ path, status: 'ERROR', data: '' }));
    req.end();
  });
}

async function testAll() {
  console.log('Testing different endpoint formats...\n');
  for (const endpoint of endpoints) {
    const result = await tryEndpoint(endpoint);
    console.log(`${result.status}: ${endpoint}`);
    if (result.status === 200) {
      console.log('  Response:', result.data);
    }
    console.log('');
  }
}

testAll();
