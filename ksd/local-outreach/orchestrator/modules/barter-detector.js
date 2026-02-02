const { hasAgreement } = require("./barter-agreements");

// Categories where multiple barter agreements are allowed (consumption-based)
const MULTIPLE_ALLOWED = ["cafe", "restaurant", "butcher", "gym", "salon", "bakery", "coffee"];

// Categories where only ONE barter agreement is allowed (service-based)
const SINGLE_ONLY = ["dentist", "plumber", "electrician", "accountant", "solicitor", "lawyer"];

const barterCategories = {
  cafe: { value: "high", offering: "coffee/food credits", discount: 50 },
  restaurant: { value: "high", offering: "food credits", discount: 100 },
  butcher: { value: "medium", offering: "meat/products", discount: 50 },
  salon: { value: "high", offering: "haircuts/treatments", discount: 100 },
  gym: { value: "high", offering: "membership", discount: 100 },
  dentist: { value: "high", offering: "dental work", discount: 200 },
  plumber: { value: "medium", offering: "service discount", discount: 100 },
  electrician: { value: "medium", offering: "service discount", discount: 100 }
};

function detectBarterOpportunity(business) {
  const category = (business.category || "").toLowerCase();
  const barterInfo = Object.entries(barterCategories).find(([cat]) => category.includes(cat));
  
  if (!barterInfo) {
    return { eligible: false, available: false, value: "low" };
  }
  
  const [barterCategory, info] = barterInfo;
  
  // Check if this category allows multiple agreements
  const allowsMultiple = MULTIPLE_ALLOWED.some(cat => barterCategory.includes(cat));
  const isSingleOnly = SINGLE_ONLY.some(cat => barterCategory.includes(cat));
  
  // For single-only categories, check if agreement exists
  // For multiple-allowed categories, always available
  let hasExistingAgreement = false;
  if (isSingleOnly) {
    hasExistingAgreement = hasAgreement(barterCategory);
  }
  // For multiple-allowed, we dont check - can have multiple
