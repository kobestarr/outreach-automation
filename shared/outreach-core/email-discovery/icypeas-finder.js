/**
 * Icypeas Email Finder Module
 * Finds email addresses using firstname + lastname + domain
 */

const https = require('https');
const { getCredential, checkDailyLimit, recordUsage } = require('../credentials-loader');

const ICYPEAS_BASE_URL = 'app.icypeas.com';

/**
 * Find email address using name and domain
 * @param {Object} params - Search parameters
 * @param {string} params.firstName - First name
 * @param {string} params.lastName - Last name
 * @param {string} params.domainOrCompany - Domain or company name
 * @returns {Promise<Object>} Search result with email and certainty
 */
async function findEmail({ firstName, lastName, domainOrCompany }) {
  // Check daily limit
  const limitCheck = checkDailyLimit('icypeas');
  if (!limitCheck.canUse) {
    throw new Error(`Icypeas daily limit reached (500/day). Used: ${limitCheck.used}, Remaining: ${limitCheck.remaining}`);
  }
  
  const apiKey = getCredential('icypeas', 'apiKey');
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      firstname: firstName || '',
      lastname: lastName || '',
      domainOrCompany: domainOrCompany
    });
    
    const options = {
      hostname: ICYPEAS_BASE_URL,
      path: '/api/email-search',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          
          if (!result.success) {
            reject(new Error(`Icypeas API error: ${result.error || 'Unknown error'}`));
            return;
          }
          
          // Poll for results using the returned _id
          pollIcypeasResult(result.item._id, apiKey)
            .then((emailResult) => {
              // Record usage (1 credit per found email)
              if (emailResult && emailResult.emails && emailResult.emails.length > 0) {
                recordUsage('icypeas', emailResult.emails.length);
              }
              resolve(emailResult);
            })
            .catch(reject);
        } catch (error) {
          reject(new Error(`Failed to parse Icypeas response: ${error.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(new Error(`Icypeas API request error: ${error.message}`));
    });
    
    req.write(postData);
    req.end();
  });
}

/**
 * Poll Icypeas for search results
 * @param {string} searchId - Search ID from initial request
 * @param {string} apiKey - API key
 * @returns {Promise<Object>} Search results
 */
function pollIcypeasResult(searchId, apiKey) {
  return new Promise((resolve, reject) => {
    const maxAttempts = 10;
    let attempts = 0;
    
    const poll = () => {
      attempts++;
      
      const postData = JSON.stringify({ id: searchId });
      
      const options = {
        hostname: ICYPEAS_BASE_URL,
        path: '/api/bulk-single-searchs/read',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': apiKey,
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            
            if (result.items && result.items.length > 0) {
              const item = result.items[0];
              
              // Check status
              if (item.status === 'DEBITED' || item.status === 'FOUND') {
                // Search complete
                const emails = item.results?.emails || [];
                resolve({
                  emails: emails.map(e => ({
                    email: e.email,
                    certainty: e.certainty,
                    mxRecords: e.mxRecords,
                    mxProvider: e.mxProvider
                  })),
                  fullName: item.results?.fullname,
                  firstName: item.results?.firstname,
                  lastName: item.results?.lastname
                });
              } else if (item.status === 'NONE' || item.status === 'SCHEDULED' || item.status === 'IN_PROGRESS') {
                // Still processing, wait and retry
                if (attempts < maxAttempts) {
                  setTimeout(poll, 2000); // Wait 2 seconds
                } else {
                  reject(new Error('Icypeas search timeout - took too long'));
                }
              } else {
                // No email found or error
                resolve({
                  emails: [],
                  fullName: item.results?.fullname || null,
                  firstName: item.results?.firstname || null,
                  lastName: item.results?.lastname || null
                });
              }
            } else {
              // No results
              resolve({
                emails: [],
                fullName: null,
                firstName: null,
                lastName: null
              });
            }
          } catch (error) {
            reject(new Error(`Failed to parse Icypeas poll response: ${error.message}`));
          }
        });
      });
      
      req.on('error', (error) => {
        reject(new Error(`Icypeas poll request error: ${error.message}`));
      });
      
      req.write(postData);
      req.end();
    };
    
    poll();
  });
}

module.exports = {
  findEmail
};
