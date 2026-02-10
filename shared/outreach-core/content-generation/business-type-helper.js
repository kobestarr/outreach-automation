/**
 * Business Type Helper
 * Converts business categories to generic plural business types
 * For use in merge variable templates: "including {{businessType}}s like {{companyName}}"
 */

const logger = require("../logger");

/**
 * Category to plural business type mapping
 */
const BUSINESS_TYPE_MAP = {
  // Professional services
  dentist: "dentists",
  dental: "dental practices",
  "dental practice": "dental practices",
  doctor: "doctors",
  "medical practice": "medical practices",
  solicitor: "solicitors",
  "law firm": "law firms",
  lawyer: "lawyers",
  accountant: "accountants",
  "accounting firm": "accounting firms",
  consultant: "consultants",
  "consulting firm": "consulting firms",
  architect: "architects",
  engineer: "engineers",
  veterinarian: "veterinarians",
  "vet clinic": "vet clinics",
  optometrist: "optometrists",
  chiropractor: "chiropractors",

  // Health & Beauty
  salon: "salons",
  "hair salon": "hair salons",
  "beauty salon": "beauty salons",
  barbershop: "barbershops",
  "barber shop": "barber shops",
  gym: "gyms",
  "fitness center": "fitness centers",
  "fitness centre": "fitness centres",
  physio: "physios",
  physiotherapist: "physiotherapists",
  "physio clinic": "physio clinics",
  "personal trainer": "personal trainers",
  spa: "spas",
  wellness: "wellness centers",
  "wellness center": "wellness centers",
  "wellness centre": "wellness centres",
  nutritionist: "nutritionists",
  dietitian: "dietitians",

  // Food & Beverage
  cafe: "cafes",
  café: "cafés",
  restaurant: "restaurants",
  bakery: "bakeries",
  "coffee shop": "coffee shops",
  bistro: "bistros",
  pub: "pubs",
  bar: "bars",
  "wine bar": "wine bars",

  // Retail
  retail: "retail businesses",
  shop: "shops",
  boutique: "boutiques",
  store: "stores",
  "retail store": "retail stores",
  "gift shop": "gift shops",

  // Services
  plumber: "plumbers",
  electrician: "electricians",
  landscaper: "landscapers",
  "landscaping company": "landscaping companies",
  builder: "builders",
  "building company": "building companies",
  handyman: "handymen",
  "home improvement": "home improvement companies",
  "dry cleaner": "dry cleaners",
  "car wash": "car washes",
  "pet groomer": "pet groomers",
  "pet grooming": "pet grooming businesses",

  // Default fallback
  unknown: "local businesses",
  "": "local businesses",
};

/**
 * Get plural business type from category
 * @param {string} category - Business category (e.g., "dentist", "gym", "salon")
 * @returns {string} Plural business type (e.g., "dentists", "gyms", "salons")
 */
function getBusinessType(category) {
  if (!category) {
    logger.debug("business-type-helper", "No category provided, using default", {
      category,
    });
    return "local businesses";
  }

  const normalizedCategory = category.toLowerCase().trim();

  // Direct match
  if (BUSINESS_TYPE_MAP[normalizedCategory]) {
    return BUSINESS_TYPE_MAP[normalizedCategory];
  }

  // Partial match (e.g., "dental clinic" → "dental practices")
  for (const [key, value] of Object.entries(BUSINESS_TYPE_MAP)) {
    if (normalizedCategory.includes(key) || key.includes(normalizedCategory)) {
      logger.debug("business-type-helper", "Partial match found", {
        category: normalizedCategory,
        matchedKey: key,
        businessType: value,
      });
      return value;
    }
  }

  // Smart pluralization fallback
  const pluralized = smartPluralize(normalizedCategory);

  logger.debug("business-type-helper", "No match found, using smart pluralization", {
    category: normalizedCategory,
    businessType: pluralized,
  });

  return pluralized;
}

/**
 * Smart pluralization for unknown categories
 * @param {string} word - Singular word
 * @returns {string} Pluralized word
 */
function smartPluralize(word) {
  if (!word) return "local businesses";

  // Already plural
  if (word.endsWith("s") || word.endsWith("es")) {
    return word;
  }

  // Special cases
  if (word.endsWith("y") && !["ay", "ey", "iy", "oy", "uy"].some((v) => word.endsWith(v))) {
    return word.slice(0, -1) + "ies"; // company → companies
  }

  if (word.endsWith("ch") || word.endsWith("sh") || word.endsWith("x") || word.endsWith("z")) {
    return word + "es"; // church → churches
  }

  if (word.endsWith("f")) {
    return word.slice(0, -1) + "ves"; // shelf → shelves
  }

  if (word.endsWith("fe")) {
    return word.slice(0, -2) + "ves"; // knife → knives
  }

  // Default: add 's'
  return word + "s";
}

/**
 * Get business type with article (a/an)
 * @param {string} category - Business category
 * @returns {string} Business type with article (e.g., "a dentist", "an accountant")
 */
function getBusinessTypeWithArticle(category) {
  const type = getBusinessType(category);

  // Get singular form (remove 's' or 'es')
  let singular = type;
  if (type.endsWith("ies")) {
    singular = type.slice(0, -3) + "y"; // companies → company
  } else if (type.endsWith("es")) {
    singular = type.slice(0, -2); // churches → church
  } else if (type.endsWith("s")) {
    singular = type.slice(0, -1); // dentists → dentist
  }

  // Determine article
  const vowels = ["a", "e", "i", "o", "u"];
  const article = vowels.includes(singular[0].toLowerCase()) ? "an" : "a";

  return `${article} ${singular}`;
}

module.exports = {
  getBusinessType,
  getBusinessTypeWithArticle,
  smartPluralize,
};
