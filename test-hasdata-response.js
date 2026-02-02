const https = require('https');
const { getCredential } = require('./shared/outreach-core/credentials-loader');

const apiKey = getCredential('hasdata', 'apiKey');
const location = 'CUSTOM>Bramhall, SK7';
const keywords = ['restaurants'];

const postData = JSON.stringify({
  keywords: keywords,
  locations: [location],
  extractEmails: true
});

const options = {
  hostname: 'api.hasdata.com',
  path: '/scrapers/google-maps/jobs',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log('Sending request to HasData...');
console.log('Location:', location);
console.log('Keywords:', keywords);
console.log('');

const req = https.request(options, (res) => {
  let data = '';
  
  console.log('Status:', res.statusCode);
  console.log('Headers:', JSON.stringify(res.headers, null, 2));
  console.log('');
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Response body:');
    console.log(data);
    console.log('');
    
    try {
      const parsed = JSON.parse(data);
      console.log('Parsed JSON:');
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log('Failed to parse JSON:', e.message);
    }
  });
});

req.on('error', (error) => {
  console.error('Request error:', error);
});

req.write(postData);
req.end();
