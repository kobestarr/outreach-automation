const https = require("https");
const { getCredential } = require("../../../shared/outreach-core/credentials-loader");

const HASDATA_BASE_URL = "api.hasdata.com";

async function scrapeGoogleMaps(location, businessTypes = []) {
  const apiKey = getCredential("hasdata", "apiKey");
  
  return new Promise((resolve, reject) => {
    const searchQuery = encodeURIComponent(location);
    const apiPath = "/google-maps/search?query=" + searchQuery + "&limit=100";
    
    const options = {
      hostname: HASDATA_BASE_URL,
      path: apiPath,
      method: "GET",
      headers: {
        "Authorization": "Bearer " + apiKey,
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
          const businesses = result.items || result.data || [];
          
          resolve(businesses.map(b => ({
            name: b.name || b.businessName,
            address: b.address || b.formattedAddress,
            phone: b.phone || b.phoneNumber,
            website: b.website || b.url,
            rating: b.rating || b.averageRating,
            reviewCount: b.reviewCount || b.userRatingsTotal || 0,
            category: b.category || (b.types && b.types[0]) || "unknown",
            location: {
              lat: (b.location && b.location.lat) || (b.geometry && b.geometry.location && b.geometry.location.lat),
              lng: (b.location && b.location.lng) || (b.geometry && b.geometry.location && b.geometry.location.lng)
            },
            placeId: b.placeId || b.place_id,
            emailsFromWebsite: b.emails || []
          })));
        } catch (error) {
          reject(new Error("Failed to parse HasData response: " + error.message));
        }
      });
    });
    
    req.on("error", (error) => {
      reject(new Error("HasData API error: " + error.message));
    });
    
    req.end();
  });
}

module.exports = { scrapeGoogleMaps };
