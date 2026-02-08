/**
 * Category Mapping Module
 * Maps business categories to groups and provides angle prompts for email + LinkedIn
 */

// Category group constants
const CATEGORY_GROUPS = {
  TRADESPEOPLE: "TRADESPEOPLE",
  HEALTH_BEAUTY: "HEALTH_BEAUTY",
  FOOD_HOSPITALITY: "FOOD_HOSPITALITY",
  PROFESSIONAL: "PROFESSIONAL",
  PROPERTY: "PROPERTY",
  FITNESS: "FITNESS",
  AUTOMOTIVE: "AUTOMOTIVE",
  HOME_SERVICES: "HOME_SERVICES",
  RETAIL: "RETAIL",
  EDUCATION: "EDUCATION",
  GENERAL: "GENERAL"
};

// Category keyword mapping for classification
const CATEGORY_KEYWORDS = {
  TRADESPEOPLE: [
    "plumber", "plumbing", "electrician", "electrical", "builder", "building",
    "roofer", "roofing", "carpenter", "carpentry", "joiner", "bricklayer",
    "plasterer", "painter", "decorator", "landscaper", "landscaping"
  ],
  HEALTH_BEAUTY: [
    "salon", "hairdresser", "barber", "beautician", "beauty", "spa",
    "massage", "therapist", "aesthetics", "nail", "manicure", "pedicure",
    "hair", "stylist", "cosmetic"
  ],
  FOOD_HOSPITALITY: [
    "restaurant", "cafe", "coffee", "pub", "bar", "hotel", "b&b",
    "catering", "caterer", "bakery", "bistro", "takeaway", "deli",
    "food", "hospitality", "inn"
  ],
  PROFESSIONAL: [
    "accountant", "accounting", "solicitor", "lawyer", "legal", "consultant",
    "consulting", "architect", "architecture", "surveyor", "financial",
    "advisor", "chartered"
  ],
  PROPERTY: [
    "estate agent", "letting", "lettings", "property management", "realtor",
    "real estate", "property", "landlord"
  ],
  FITNESS: [
    "gym", "fitness", "personal trainer", "pt", "yoga", "pilates",
    "crossfit", "martial arts", "boxing", "studio", "wellness"
  ],
  AUTOMOTIVE: [
    "mechanic", "garage", "car sales", "car repair", "mot", "auto repair",
    "bodyshop", "body shop", "car wash", "detailing", "automotive", "vehicle",
    "auto", "repair"
  ],
  HOME_SERVICES: [
    "cleaner", "cleaning", "gardener", "gardening", "pest control",
    "removals", "removal", "window cleaning", "gutter", "handyman",
    "locksmith"
  ],
  RETAIL: [
    "shop", "store", "boutique", "retail", "florist", "gift", "pet shop",
    "jeweller", "jeweler"
  ],
  EDUCATION: [
    "tutor", "tutoring", "music teacher", "nursery", "childcare",
    "training center", "training centre", "academy", "school",
    "dance", "drama", "driving instructor"
  ]
};

// Email angles per category group
const EMAIL_ANGLES = {
  TRADESPEOPLE: [
    "First impression online — most enquiries start with a Google search, and your web presence is the first thing prospects see",
    "Response time optimization — in trades, being first to respond often wins the job, even over lower quotes",
    "Review generation system — standing out in a crowded market with consistent 5-star reviews and testimonials"
  ],

  HEALTH_BEAUTY: [
    "Client retention and rebooking — reducing gaps in your schedule and maximizing lifetime value per client",
    "Online booking friction — removing barriers that stop potential clients from booking (\"I'll call later\" often means never)",
    "Instagram-to-client conversion — turning followers into paying customers with a clear booking path"
  ],

  FOOD_HOSPITALITY: [
    "Table booking optimization — reducing no-shows and filling quiet periods with a better reservation system",
    "Delivery and online presence — capturing the takeaway market with seamless ordering",
    "Review response strategy — turning negative reviews into recovery wins and positive reviews into marketing assets"
  ],

  PROFESSIONAL: [
    "Credibility and positioning — standing out from competitors with thought leadership and expertise signaling",
    "Referral system — turning satisfied clients into a predictable referral pipeline",
    "Content marketing — attracting ideal clients with valuable insights that demonstrate your expertise"
  ],

  PROPERTY: [
    "Listing visibility — ensuring your properties appear first when buyers and renters are searching",
    "Valuation lead capture — converting website visitors into valuation requests and listings",
    "Landlord retention — keeping landlords loyal with better communication and proactive portfolio management"
  ],

  FITNESS: [
    "Trial-to-member conversion — turning one-time visitors into committed long-term members",
    "Class booking optimization — filling classes consistently and reducing last-minute cancellations",
    "Retention beyond 3 months — reducing the drop-off that kills most gym businesses"
  ],

  AUTOMOTIVE: [
    "Service reminder system — bringing customers back for regular maintenance before they forget or go elsewhere",
    "Trust building with first-time customers — overcoming the \"mechanics are dodgy\" perception",
    "Upsell optimization — increasing average job value without feeling pushy or aggressive"
  ],

  HOME_SERVICES: [
    "Recurring booking system — turning one-off jobs into predictable monthly income",
    "Quote-to-booking conversion — reducing the time between quote and confirmed job",
    "Seasonal demand capture — filling the pipeline during quieter months before they arrive"
  ],

  RETAIL: [
    "Foot traffic to website — capturing local customers online, not just hoping they walk past",
    "Local SEO visibility — appearing when locals search for what you sell",
    "Loyalty and repeat purchase — turning one-time buyers into regulars with simple retention tactics"
  ],

  EDUCATION: [
    "Enrollment optimization — filling classes faster with a clearer path from enquiry to enrollment",
    "Parent communication — reducing admin burden with automated updates and booking management",
    "Waitlist management — capturing demand even when classes are full to fill future slots"
  ],

  GENERAL: [
    "Online presence basics — ensuring prospects can find you and understand what you offer",
    "Review generation — building social proof that converts browsers into buyers",
    "Customer journey optimization — removing friction from first contact to purchase"
  ]
};

// LinkedIn angles per category (DIFFERENT from email angles)
const LINKEDIN_ANGLES = {
  TRADESPEOPLE: [
    "Building a pipeline for quieter months — trades feast or famine, having a system changes that",
    "Standing out on Google when everyone looks the same — what makes someone pick you over 10 other sparks?",
    "Professional brand without looking corporate — tradespeople who look too polished lose trust, too scruffy lose jobs"
  ],

  HEALTH_BEAUTY: [
    "Client lifetime value — one client worth £5k+ over 3 years if retention is right",
    "Standing out in a saturated market — why should someone pick you over the 20 salons within 2 miles?",
    "Social media that actually books appointments — not just likes, actual revenue from Instagram"
  ],

  FOOD_HOSPITALITY: [
    "Filling quiet periods without discounting — Tuesdays and Wednesdays matter as much as weekends",
    "Local reputation management — one bad review can cost you 10 bookings, but most owners don't respond well",
    "Takeaway and delivery done right — Deliveroo takes 30%, but there are better ways to own that channel"
  ],

  PROFESSIONAL: [
    "Positioning as the obvious expert — not just another accountant/solicitor, the one people seek out",
    "Referral automation — great work should generate referrals automatically, not by asking awkwardly",
    "Thought leadership without the time sink — establish authority without becoming a full-time content creator"
  ],

  PROPERTY: [
    "Listing quality over quantity — 5 great listings beat 20 mediocre ones, vendors know the difference",
    "Valuation conversion — most agents get the valuation but lose the listing, here's why",
    "Landlord loyalty — investors have multiple properties, keep one happy and you keep them all"
  ],

  FITNESS: [
    "Member retention is the entire game — acquiring members is expensive, keeping them is profitable",
    "Community over equipment — people stay for the culture, not the treadmills",
    "Filling classes without paid ads — organic community growth beats paid ads every time for gyms"
  ],

  AUTOMOTIVE: [
    "Customer lifecycle — service, MOT, repair, upgrade... one customer is worth £3k+ over 5 years",
    "Trust signals that matter — what makes someone trust a garage they've never used?",
    "Workshop efficiency — more jobs per day without cutting corners or burning out"
  ],

  HOME_SERVICES: [
    "Recurring vs one-off — cleaners with 40 regular clients sleep better than those chasing one-offs",
    "Quote conversion speed — if you're slow to quote, you've already lost to someone faster",
    "Seasonality planning — November is too late to worry about December being quiet"
  ],

  RETAIL: [
    "Local vs online — you'll never out-Amazon Amazon, but you can own your local area",
    "Experience over product — people can buy online, they come to you for something else",
    "Community connection — shops that feel like hubs survive, shops that just sell don't"
  ],

  EDUCATION: [
    "Waitlist into enrollment pipeline — \"we're full\" should mean future revenue, not turned-away customers",
    "Parent experience — happy parents refer other parents, it's the cheapest marketing there is",
    "Class economics — knowing which classes are profitable and which are just keeping you busy"
  ],

  GENERAL: [
    "First impressions online — you're being Googled before you know someone exists",
    "Word of mouth at scale — turning great service into predictable referrals",
    "Small business fundamentals — most don't fail from bad work, they fail from invisible marketing"
  ]
};

/**
 * Get category group from business category string
 * @param {string} category - Business category (e.g. "Plumber", "Hair Salon")
 * @returns {string} Category group enum (e.g. "TRADESPEOPLE", "HEALTH_BEAUTY")
 */
function getCategoryGroup(category) {
  if (!category) return CATEGORY_GROUPS.GENERAL;

  const lowerCategory = category.toLowerCase();

  // Check each group's keywords
  for (const [group, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(keyword => lowerCategory.includes(keyword))) {
      return CATEGORY_GROUPS[group];
    }
  }

  // Default to GENERAL if no match
  return CATEGORY_GROUPS.GENERAL;
}

/**
 * Get email angles for a category group
 * @param {string} categoryGroup - Category group enum
 * @returns {Array<string>} Array of email angle prompts
 */
function getCategoryEmailAngles(categoryGroup) {
  return EMAIL_ANGLES[categoryGroup] || EMAIL_ANGLES.GENERAL;
}

/**
 * Get LinkedIn angles for a category group (different from email)
 * @param {string} categoryGroup - Category group enum
 * @returns {Array<string>} Array of LinkedIn angle prompts
 */
function getCategoryLinkedInAngles(categoryGroup) {
  return LINKEDIN_ANGLES[categoryGroup] || LINKEDIN_ANGLES.GENERAL;
}

module.exports = {
  CATEGORY_GROUPS,
  getCategoryGroup,
  getCategoryEmailAngles,
  getCategoryLinkedInAngles
};
