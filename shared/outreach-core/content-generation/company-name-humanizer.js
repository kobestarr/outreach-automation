/**
 * Company Name Humanizer
 * Converts scraped company names to natural human-written format
 *
 * Examples:
 * - "KissDental Bramhall" → "KissDental"
 * - "Kobestarr Digital Limited" → "Kobestarr Digital"
 * - "Apple Inc." → "Apple"
 * - "Shell plc" → "Shell"
 * - "Samsung Electronics Co., Ltd." → "Samsung"
 */

const logger = require("../logger");

// Common UK location patterns (postcodes, cities, areas)
const UK_LOCATION_PATTERNS = [
  // Postcode areas (e.g., "Bramhall SK7", "London W1", "Manchester M1")
  /\b[A-Z]{1,2}\d{1,2}[A-Z]?\b/gi,

  // Major UK cities and towns (comprehensive list)
  /\b(London|Birmingham|Manchester|Liverpool|Leeds|Sheffield|Bristol|Edinburgh|Glasgow|Cardiff|Belfast|Newcastle|Nottingham|Leicester|Coventry|Bradford|Hull|Stoke|Wolverhampton|Plymouth|Derby|Southampton|Portsmouth|Brighton|Reading|Bolton|Salford|Preston|Aberdeen|Dundee|Sunderland|Norwich|Milton Keynes|Swansea|Oxford|Cambridge|Ipswich|York|Gloucester|Watford|Luton|Exeter|Bournemouth|Swindon|Crawley|Basildon|Southend|Worthing|Chelmsford|Colchester|Blackpool|Blackburn|Huddersfield|Oldham|Poole|Middlesbrough|Telford|Slough|Cheltenham|Maidstone|Rochdale|Gateshead|Rotherham|Wigan|Doncaster|Stockport|Warrington|St Helens|Walsall|Eastbourne|Gillingham|Darlington|Hartlepool|Burnley|Grimsby|Hastings|Scunthorpe|Carlisle|Worcester|Lancaster|Barnsley|Wakefield|Mansfield|Nuneaton|Peterborough|Stevenage|Hemel Hempstead|Basingstoke|High Wycombe|Aylesbury|Harlow|Bracknell|Redditch|Crewe|Lincoln|Chesterfield|Lowestoft|Rugby|Great Yarmouth|Shrewsbury|Hereford|Taunton|Salisbury|Stafford|Kidderminster|Kettering|Runcorn|Widnes|Dewsbury|Weymouth|Bath|Folkestone|Chatham|Guildford|Harrogate|Weston-super-Mare|Woking|Bramhall|Poynton|Alderley Edge|Wilmslow|Knutsford|Cheadle|Hale|Sale|Altrincham|Prestbury|Macclesfield|Congleton|Nantwich|Sandbach|Middlewich|Northwich|Winsford|Frodsham|Helsby|Ellesmere Port|Neston|Heswall|Hoylake|West Kirby|Bebington|Birkenhead|Wallasey|Bangor|Newry|Lisburn|Derry|Londonderry|Ballymena|Newtownabbey|Craigavon|Armagh|Omagh|Banbridge|Larne|Carrickfergus|Coleraine|Enniskillen|Antrim|Limavady|Strabane|Magherafelt|Downpatrick|Holywood|Newtownards|Portadown|Lurgan|Dungannon|Cookstown|Ballymoney|Greenock|Paisley|East Kilbride|Livingston|Cumbernauld|Hamilton|Kirkcaldy|Ayr|Perth|Kilmarnock|Inverness|Falkirk|Dumfries|Stirling|Dunfermline|Motherwell|Coatbridge|Wishaw|Glenrothes|Clydebank|Airdrie|Rutherglen|Cambuslang|Bearsden|Newton Mearns|Bishopbriggs|Musselburgh|Renfrew|Bonnyrigg|Penicuik|Arbroath|Alloa|Bathgate|Grangemouth|Fraserburgh|Irvine|Dumbarton|Elgin|Bellshill|Blantyre|Erskine|Barrhead|Viewpark|Kilwinning|Troon|Peebles|Linlithgow|Forfar|Montrose|Dalkeith|Kelso|Galashiels|Hawick|Selkirk|Jedburgh|Annan|Stranraer|Stornoway|Fort William|Oban|Campbeltown|Lerwick|Kirkwall|Thurso|Wick|Dingwall|Nairn|Forres|Buckie|Keith|Huntly|Inverurie|Peterhead|Stonehaven|Banchory|Ballater|Braemar|Pitlochry|Aberfeldy|Crieff|Callander|Dunblane|Bridge of Allan|Tillicoultry|Dollar|Clackmannan|Kinross|Cowdenbeath|Lochgelly|Buckhaven|Methil|Leven|Anstruther|Crail|St Andrews|Cupar|Newburgh|Auchtermuchty|Falkland|Ladybank|Springfield|Freuchie|Kingskettle|Dairsie|Guardbridge|Leuchars|Newport-on-Tay|Tayport|Wormit)\b/gi,

  // Common area descriptors
  /\b(North|South|East|West|Central|Upper|Lower|Old|New)\s+[A-Z][a-z]+\b/gi,

  // "Business Name [Location]" pattern
  /\s+[-–—]\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s*$/gi
];

// TRUE legal entity suffixes (always strip)
const LEGAL_SUFFIXES = [
  // UK
  'Limited',
  'Ltd',
  'Ltd.',
  'LTD',
  'plc',
  'PLC',
  'LLP',
  'LP',

  // US
  'Inc',
  'Inc.',
  'Incorporated',
  'Corp',
  'Corp.',
  'Corporation',
  'LLC',
  'L.L.C.',
  'Co',
  'Co.',
  'Company',

  // International
  'GmbH',
  'AG',
  'SA',
  'S.A.',
  'SL',
  'S.L.',
  'BV',
  'NV',
  'Pty',
  'Pty.',
  'Pty Ltd'
];

// Generic business descriptors (only strip if not core to brand)
const GENERIC_DESCRIPTORS = [
  'Group',
  'Holdings',
  'Holding',
  'International',
  'Global',
  'Worldwide',
  'Enterprises',
  'Industries',
  'Electronics', // User example: Samsung Electronics → Samsung
  'Services',
  'Systems',
  'Technologies',
  'Tech',
  'Online',
  'Web',
  'Studio',
  'Studios',
  'Agency',
  'Consultancy',
  'Consulting',
  'Partners',
  'Associates',
  'Ventures'
];

// Brand-core descriptors (keep these unless followed by legal suffix)
const BRAND_CORE_DESCRIPTORS = [
  'Digital', // User example: Kobestarr Digital → keep
  'Solutions', // User example: ABC Solutions → keep
  'Media',
  'Coffee', // Starbucks Coffee
  'Pizza'
];

// Brand-core words that should NOT be stripped (even if they match suffixes)
const BRAND_CORE_EXCEPTIONS = {
  // If company name is exactly these patterns, don't strip the suffix
  'Digital': [
    'Kobestarr Digital', // User's company
    'AKQA Digital',
    'R/GA Digital'
  ],
  'Media': [
    'BBC Media',
    'Vice Media'
  ],
  'Studios': [
    'Pixar Studios',
    'Marvel Studios'
  ],
  'Electronics': [
    // Samsung Electronics will be stripped to Samsung (user's example)
  ],
  'Technologies': [
    // Generally should be stripped
  ]
};

/**
 * Strip legal entity suffixes from company name
 * @param {string} name - Company name
 * @returns {string} Name without legal suffixes
 */
function stripLegalSuffixes(name) {
  let cleaned = name.trim();

  // Build regex pattern for legal suffixes
  // Match at end of string or followed by comma/period
  const pattern = new RegExp(
    `\\s+(${LEGAL_SUFFIXES.join('|')})(?:[\\s,.]*)$`,
    'gi'
  );

  // Keep stripping until no more matches (handles "Co., Ltd." etc.)
  let previousName;
  do {
    previousName = cleaned;
    cleaned = cleaned.replace(pattern, '');
    cleaned = cleaned.trim().replace(/[,.]$/, '').trim();
  } while (cleaned !== previousName && cleaned.length > 0);

  return cleaned;
}

/**
 * Strip generic descriptors from company name
 * Only strips if not brand-core and result is still meaningful
 * @param {string} name - Company name
 * @param {string} original - Original name for context
 * @returns {string} Name without generic descriptors
 */
function stripGenericDescriptors(name, original) {
  let cleaned = name.trim();
  const words = cleaned.split(/\s+/);

  // Don't strip if name is already short
  if (words.length <= 1) {
    return cleaned;
  }

  // Check last word
  const lastWord = words[words.length - 1];

  // If last word is brand-core descriptor, keep it
  if (BRAND_CORE_DESCRIPTORS.some(desc => desc.toLowerCase() === lastWord.toLowerCase())) {
    return cleaned;
  }

  // If last word is generic descriptor, strip it
  if (GENERIC_DESCRIPTORS.some(desc => desc.toLowerCase() === lastWord.toLowerCase())) {
    const withoutLast = words.slice(0, -1).join(' ');

    // Strip if result is not empty and is a valid brand name
    if (withoutLast.length > 0) {
      return withoutLast;
    }
  }

  return cleaned;
}

/**
 * Strip location names from company name
 * @param {string} name - Company name
 * @returns {string} Name without location
 */
function stripLocation(name) {
  let cleaned = name;

  // Apply all location patterns
  for (const pattern of UK_LOCATION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Clean up extra spaces and trailing punctuation
  cleaned = cleaned.trim().replace(/\s+/g, ' ').replace(/[,.-]+$/, '').trim();

  return cleaned;
}

/**
 * Humanize company name - convert scraped name to natural format
 * @param {string} companyName - Original scraped company name
 * @returns {Object} { humanized: string, original: string }
 */
function humanizeCompanyName(companyName) {
  if (!companyName || typeof companyName !== 'string') {
    return {
      humanized: companyName || '',
      original: companyName || ''
    };
  }

  const original = companyName.trim();
  let humanized = original;

  // Step 1: Strip location names
  humanized = stripLocation(humanized);

  // Step 2: Strip legal entity suffixes
  humanized = stripLegalSuffixes(humanized);

  // Step 3: Strip generic descriptors (but keep brand-core words)
  humanized = stripGenericDescriptors(humanized, original);

  // Step 4: Final cleanup
  humanized = humanized.trim();

  // Validation: Don't return empty string
  if (humanized.length === 0) {
    logger.warn('company-name-humanizer', 'Humanization resulted in empty string', {
      original
    });
    return {
      humanized: original,
      original
    };
  }

  logger.debug('company-name-humanizer', 'Humanized company name', {
    original,
    humanized
  });

  return {
    humanized,
    original
  };
}

/**
 * Get short name for "Team" fallback greeting
 * Extracts first 1-2 significant words for concise team addressing
 *
 * Examples:
 * - "Montgomery's Artisan Butchers" → "Montgomery's"
 * - "Paul Granelli Jewellers" → "Paul Granelli"
 * - "Glo Tanning Bramhall" → "Glo Tanning"
 * - "The Coffee Shop" → "Coffee Shop" (skip article)
 *
 * @param {string} companyName - Company name (can be raw or already humanized)
 * @returns {string} Short name (1-2 words)
 */
function getShortNameForTeam(companyName) {
  if (!companyName || typeof companyName !== 'string') {
    return 'Team';
  }

  // First humanize to remove location, legal suffixes, etc.
  const { humanized } = humanizeCompanyName(companyName);

  // Split into words
  const words = humanized.split(/\s+/).filter(w => w.length > 0);

  if (words.length === 0) {
    return 'Team';
  }

  // Skip leading articles (The, A, An)
  const articles = ['the', 'a', 'an'];
  let startIndex = 0;
  if (words.length > 1 && articles.includes(words[0].toLowerCase())) {
    startIndex = 1;
  }

  // Business type keywords that should be kept as second word
  const businessTypes = [
    'cafe', 'coffee', 'restaurant', 'bar', 'pub', 'bistro', 'grill', 'kitchen',
    'gym', 'fitness', 'yoga', 'pilates', 'wellness', 'health', 'spa',
    'dental', 'dentist', 'clinic', 'surgery', 'medical', 'pharmacy',
    'salon', 'barber', 'hair', 'beauty', 'nails', 'spa',
    'bakery', 'patisserie', 'deli', 'butcher', 'grocers', 'market',
    'hotel', 'inn', 'lodge', 'motel', 'hostel',
    'studio', 'gallery', 'theatre', 'cinema',
    'shop', 'store', 'boutique', 'emporium',
    'garage', 'motors', 'automotive', 'tyres',
    'plumbing', 'plumber', 'electrician', 'builder', 'joiner', 'decorator',
    'accountancy', 'accounting', 'legal', 'solicitors', 'law',
    'estate', 'property', 'lettings', 'rentals',
    'insurance', 'financial', 'mortgage', 'investments'
  ];

  // Generic descriptors that should be stripped
  const genericDescriptors = [
    'artisan', 'boutique', 'premium', 'luxury', 'elite', 'premier',
    'professional', 'specialists', 'expert', 'masters',
    'company', 'group', 'services', 'solutions', 'systems',
    'jewellers', 'jeweller', 'jewelry', 'jewellery' // Specific to examples
  ];

  // Take first 1-2 words after article
  const relevantWords = words.slice(startIndex);

  if (relevantWords.length === 1) {
    // Single word company name
    return relevantWords[0];
  }

  // Check if first word is possessive (ends with 's or ')
  const firstWord = relevantWords[0];
  const isPossessive = firstWord.endsWith("'s") || firstWord.endsWith("'");

  if (isPossessive) {
    // "Montgomery's Artisan Butchers" → "Montgomery's"
    // "Paul's Cafe" → "Paul's"
    return firstWord;
  }

  // Check if second word is a business type keyword
  if (relevantWords.length >= 2) {
    const secondWord = relevantWords[1].toLowerCase();
    if (businessTypes.includes(secondWord)) {
      // "Glo Tanning" → "Glo Tanning"
      // "Main Street Cafe" → "Main Street Cafe"
      return `${relevantWords[0]} ${relevantWords[1]}`;
    }
  }

  // Check if second word is a generic descriptor
  if (relevantWords.length >= 2) {
    const secondWord = relevantWords[1].toLowerCase();
    if (genericDescriptors.includes(secondWord)) {
      // "Paul Granelli Jewellers" → "Paul Granelli"
      // "Elite Fitness" → "Elite" (no, Elite is not possessive)
      return relevantWords[0];
    }
  }

  // Default: Take first 2 words
  // "Paul Granelli Jewellers" → "Paul Granelli"
  return relevantWords.slice(0, 2).join(' ');
}

/**
 * Test the humanizer with known examples
 * @returns {Object} Test results
 */
function runTests() {
  const testCases = [
    { input: 'KissDental Bramhall', expected: 'KissDental' },
    { input: 'Kobestarr Digital Limited', expected: 'Kobestarr Digital' },
    { input: 'Apple Inc.', expected: 'Apple' },
    { input: 'Shell plc', expected: 'Shell' },
    { input: 'Samsung Electronics Co., Ltd.', expected: 'Samsung' },
    { input: 'Starbucks Coffee Company', expected: 'Starbucks Coffee' },
    { input: 'Microsoft Corporation', expected: 'Microsoft' },
    { input: 'Amazon.com, Inc.', expected: 'Amazon.com' },
    { input: 'The Hair Salon London', expected: 'The Hair Salon' },
    { input: 'Joe\'s Pizza Manchester', expected: 'Joe\'s Pizza' },
    { input: 'Acme Ltd', expected: 'Acme' },
    { input: 'XYZ Holdings plc', expected: 'XYZ' },
    { input: 'ABC Solutions Limited', expected: 'ABC Solutions' }
  ];

  const results = testCases.map(test => {
    const result = humanizeCompanyName(test.input);
    const passed = result.humanized === test.expected;

    return {
      input: test.input,
      expected: test.expected,
      actual: result.humanized,
      passed
    };
  });

  const passCount = results.filter(r => r.passed).length;
  const failCount = results.length - passCount;

  return {
    results,
    summary: {
      total: results.length,
      passed: passCount,
      failed: failCount,
      passRate: `${Math.round((passCount / results.length) * 100)}%`
    }
  };
}

module.exports = {
  humanizeCompanyName,
  getShortNameForTeam,
  runTests
};
