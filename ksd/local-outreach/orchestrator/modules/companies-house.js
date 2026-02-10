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
 * Get owner name directly from company registration number
 * More reliable than searching by business name
 * @param {string} registrationNumber - 8-digit company registration number
 * @returns {Promise<Object|null>} Owner information
 */
async function getOwnerByRegistrationNumber(registrationNumber) {
  try {
    if (!registrationNumber || !/^\d{8}$/.test(registrationNumber)) {
      logger.warn('companies-house', 'Invalid registration number format', { registrationNumber });
      return null;
    }

    logger.info('companies-house', 'Looking up company by registration number', { registrationNumber });

    // Get officers directly using registration number
    const officers = await getCompanyOfficers(registrationNumber);

    if (officers.length === 0) {
      logger.info('companies-house', 'No officers found for registration number', { registrationNumber });
      return null;
    }

    // Return first active director/officer
    const owner = officers[0];
    const nameParts = owner.name.split(" ");

    const result = {
      firstName: nameParts[0] || "",
      lastName: nameParts.slice(1).join(" ") || "",
      fullName: owner.name,
      title: owner.officer_role,
      companyNumber: registrationNumber,
      source: 'companies-house-registration-number'
    };

    logger.info('companies-house', 'Found owner via registration number', {
      registrationNumber,
      ownerName: result.fullName,
      title: result.title
    });

    return result;
  } catch (error) {
    logger.error('companies-house', 'Registration number lookup error', {
      registrationNumber,
      error: error.message
    });
    return null;
  }
}

/**
 * Get ALL owners directly from company registration number
 * Returns up to maxOwners (default 5)
 * @param {string} registrationNumber - 8-digit company registration number
 * @param {number} maxOwners - Maximum number of owners to return (default 5)
 * @returns {Promise<Array>} Array of owner information objects
 */
async function getAllOwnersByRegistrationNumber(registrationNumber, maxOwners = 5) {
  try {
    if (!registrationNumber || !/^\d{8}$/.test(registrationNumber)) {
      logger.warn('companies-house', 'Invalid registration number format', { registrationNumber });
      return [];
    }

    logger.info('companies-house', 'Looking up all owners by registration number', { registrationNumber, maxOwners });

    // Get officers directly using registration number
    const officers = await getCompanyOfficers(registrationNumber);

    if (officers.length === 0) {
      logger.info('companies-house', 'No officers found for registration number', { registrationNumber });
      return [];
    }

    // Convert all officers to owner format (up to maxOwners)
    const owners = officers.slice(0, maxOwners).map(officer => {
      const nameParts = officer.name.split(" ");
      return {
        firstName: nameParts[0] || "",
        lastName: nameParts.slice(1).join(" ") || "",
        fullName: officer.name,
        title: officer.officer_role,
        companyNumber: registrationNumber,
        source: 'companies-house-registration-number'
      };
    });

    logger.info('companies-house', 'Found owners via registration number', {
      registrationNumber,
      count: owners.length,
      owners: owners.map(o => o.fullName)
    });

    return owners;
  } catch (error) {
    logger.error('companies-house', 'Registration number lookup error', {
      registrationNumber,
      error: error.message
    });
    return [];
  }
}

/**
 * Get owner name from business name and location
 * Falls back to name search if registration number not available
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
      companyName: company.title,
      source: 'companies-house-name-search'
    };
  } catch (error) {
    logger.error('companies-house', 'Companies House lookup error', { error: error.message });
    return null;
  }
}

/**
 * Get ALL owners from business name and location
 * Returns up to maxOwners (default 5)
 * @param {string} businessName - Business name
 * @param {string} postcode - Postcode
 * @param {number} maxOwners - Maximum number of owners to return (default 5)
 * @returns {Promise<Array>} Array of owner information objects
 */
async function getAllOwnersByName(businessName, postcode, maxOwners = 5) {
  try {
    // Search for company
    const companies = await searchCompany(businessName, postcode);

    if (companies.length === 0) {
      return [];
    }

    // Try first match (most likely)
    const company = companies[0];

    // Get officers
    const officers = await getCompanyOfficers(company.company_number);

    if (officers.length === 0) {
      return [];
    }

    // Convert all officers to owner format (up to maxOwners)
    const owners = officers.slice(0, maxOwners).map(officer => {
      const nameParts = officer.name.split(" ");
      return {
        firstName: nameParts[0] || "",
        lastName: nameParts.slice(1).join(" ") || "",
        fullName: officer.name,
        title: officer.officer_role,
        companyNumber: company.company_number,
        companyName: company.title,
        source: 'companies-house-name-search'
      };
    });

    logger.info('companies-house', 'Found owners via name search', {
      businessName,
      count: owners.length,
      owners: owners.map(o => o.fullName)
    });

    return owners;
  } catch (error) {
    logger.error('companies-house', 'Companies House lookup error', { error: error.message });
    return [];
  }
}

module.exports = {
  searchCompany,
  getCompanyOfficers,
  getOwnerName,
  getOwnerByRegistrationNumber,
  getAllOwnersByRegistrationNumber,
  getAllOwnersByName
};
