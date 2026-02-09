/**
 * Companies House Integration
 * Lookup UK business owners via Companies House API
 */

const https = require("https");
const { getCredential } = require("../../../../shared/outreach-core/credentials-loader");
const logger = require("../../../../shared/outreach-core/logger");

const COMPANIES_HOUSE_BASE_URL = "api.company-information.service.gov.uk";

/**
 * Search for company by name
 */
async function searchCompany(companyName, postcode) {
  const apiKey = getCredential("companiesHouse", "apiKey");
  
  return new Promise((resolve, reject) => {
    const searchQuery = encodeURIComponent(companyName);
    const path = postcode 
      ? `/search/companies?q=${searchQuery}&items_per_page=10`
      : `/search/companies?q=${searchQuery}&items_per_page=10`;
    
    const options = {
      hostname: COMPANIES_HOUSE_BASE_URL,
      path: path,
      method: "GET",
      headers: {
        "Authorization": Buffer.from(apiKey + ":").toString("base64"),
        "Accept": "application/json"
      }
    };
    
    const req = https.request(options, (res) => {
      let data = "";
      
      res.on("data", (chunk) => {
        data += chunk;
      });
      
      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          
          if (result.items && result.items.length > 0) {
            resolve(result.items);
          } else {
            resolve([]);
          }
        } catch (error) {
          reject(new Error(`Failed to parse Companies House response: ${error.message}`));
        }
      });
    });
    
    req.on("error", (error) => {
      reject(new Error(`Companies House API error: ${error.message}`));
    });
    
    req.end();
  });
}

/**
 * Get company officers (directors)
 */
async function getCompanyOfficers(companyNumber) {
  const apiKey = getCredential("companiesHouse", "apiKey");
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: COMPANIES_HOUSE_BASE_URL,
      path: `/company/${companyNumber}/officers`,
      method: "GET",
      headers: {
        "Authorization": Buffer.from(apiKey + ":").toString("base64"),
        "Accept": "application/json"
      }
    };
    
    const req = https.request(options, (res) => {
      let data = "";
      
      res.on("data", (chunk) => {
        data += chunk;
      });
      
      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          
          if (result.items && result.items.length > 0) {
            // Filter for active directors/officers
            const activeOfficers = result.items.filter(o => 
              o.officer_role === "director" || 
              o.officer_role === "secretary" ||
              o.resigned_on === undefined
            );
            
            resolve(activeOfficers);
          } else {
            resolve([]);
          }
        } catch (error) {
          reject(new Error(`Failed to parse Companies House officers response: ${error.message}`));
        }
      });
    });
    
    req.on("error", (error) => {
      reject(new Error(`Companies House API error: ${error.message}`));
    });
    
    req.end();
  });
}

/**
 * Get owner name from business name and location
 */
async function getOwnerName(businessName, postcode) {
  try {
    // Search for company
    const companies = await searchCompany(businessName, postcode);
    
    if (companies.length === 0) {
      return null;
    }
    
    // Try first match (most likely)
    const company = companies[0];
    
    // Get officers
    const officers = await getCompanyOfficers(company.company_number);
    
    if (officers.length === 0) {
      return null;
    }
    
    // Return first active director/officer
    const owner = officers[0];
    const nameParts = owner.name.split(" ");
    
    return {
      firstName: nameParts[0] || "",
      lastName: nameParts.slice(1).join(" ") || "",
      fullName: owner.name,
      title: owner.officer_role,
      companyNumber: company.company_number,
      companyName: company.title
    };
  } catch (error) {
    logger.error('companies-house', 'Companies House lookup error', { error: error.message });
    return null;
  }
}

module.exports = {
  searchCompany,
  getCompanyOfficers,
  getOwnerName
};
