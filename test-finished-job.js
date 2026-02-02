const https = require('https');
const { getCredential } = require('./shared/outreach-core/credentials-loader');

const apiKey = getCredential('hasdata', 'apiKey');
const jobId = 289535; // This should be finished by now

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
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const parsed = JSON.parse(data);
    console.log('Status:', parsed.status);
    console.log('Data type:', typeof parsed.data);
    console.log('Data keys:', parsed.data ? Object.keys(parsed.data) : 'null');
    if (parsed.data && typeof parsed.data === 'object') {
      console.log('Data:', JSON.stringify(parsed.data, null, 2).substring(0, 500));
    }
  });
});

req.end();
