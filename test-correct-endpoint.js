const https = require('https');
const { getCredential } = require('./shared/outreach-core/credentials-loader');

const apiKey = getCredential('hasdata', 'apiKey');
const jobId = 289535;

console.log('Testing correct endpoint: /scrapers/jobs/' + jobId);
console.log('');

const options = {
  hostname: 'api.hasdata.com',
  path: `/scrapers/jobs/${jobId}`,
  method: 'GET',
  headers: {
    'x-api-key': apiKey,
    'Accept': 'application/json'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  
  console.log('Status:', res.statusCode);
  console.log('');
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      console.log('Response:');
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log('Failed to parse:', e.message);
      console.log('Raw:', data.substring(0, 500));
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.end();
