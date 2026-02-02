/**
 * Email Quality Validator
 * Reusable validation functions for email quality checks
 */

/**
 * Validate UK tone - checks for British phrases and flags Americanisms
 * @param {Object} email - Email object with subject and body
 * @returns {Object} Validation result with passed flag and issues array
 */
function validateUKTone(email) {
  const text = `${email.subject} ${email.body}`.toLowerCase();
  const issues = [];
  
  // Check for UK phrases (positive indicators)
  const ukPhrases = ['brilliant', 'lovely', 'proper', 'sorted', 'cheers', 'fancy', 'reckon', 'cuppa', 'natter', 'chinwag', 'chuffed', 'blimey', 'scrummy'];
  const hasUKPhrases = ukPhrases.some(phrase => text.includes(phrase));
  
  // Check for Americanisms (negative indicators)
  const americanisms = ['dollars', 'dollar', 'reach out', 'circle back', 'touch base', 'i\'m reaching out', 'i hope you\'re well'];
  const foundAmericanisms = americanisms.filter(phrase => text.includes(phrase));
  
  // Check for British spelling
  const britishSpellings = ['colour', 'organise', 'realise', 'favourite', 'recognise'];
  const americanSpellings = ['color', 'organize', 'realize', 'favorite', 'recognize'];
  const foundAmericanSpellings = americanSpellings.filter(spelling => text.includes(spelling));
  
  if (!hasUKPhrases && text.length > 50) {
    issues.push('No UK phrases detected - email may sound too generic');
  }
  
  if (foundAmericanisms.length > 0) {
    issues.push(`Americanisms found: ${foundAmericanisms.join(', ')}`);
  }
  
  if (foundAmericanSpellings.length > 0) {
    issues.push(`American spellings found: ${foundAmericanSpellings.join(', ')}`);
  }
  
  return {
    passed: issues.length === 0,
    hasUKPhrases,
    issues,
    score: issues.length === 0 ? 100 : Math.max(0, 100 - (issues.length * 25))
  };
}

/**
 * Validate email length - ensures under 100 words
 * @param {Object} email - Email object with body
 * @returns {Object} Validation result
 */
function validateLength(email) {
  const wordCount = email.body.split(/\s+/).filter(w => w.length > 0).length;
  const charCount = email.body.length;
  const targetMaxWords = 100;
  const targetMaxChars = 600;
  
  const passed = wordCount <= targetMaxWords && charCount <= targetMaxChars;
  const issues = [];
  
  if (wordCount > targetMaxWords) {
    issues.push(`Too long: ${wordCount} words (target: ${targetMaxWords})`);
  }
  if (charCount > targetMaxChars) {
    issues.push(`Too long: ${charCount} characters (target: ${targetMaxChars})`);
  }
  
  return {
    passed,
    wordCount,
    charCount,
    issues,
    score: passed ? 100 : Math.max(0, 100 - ((wordCount - targetMaxWords) * 2))
  };
}

/**
 * Validate personalization - checks name, location, business-specific references
 * @param {Object} email - Email object
 * @param {Object} businessData - Business data object
 * @returns {Object} Validation result
 */
function validatePersonalization(email, businessData) {
  const text = `${email.subject} ${email.body}`.toLowerCase();
  const issues = [];
  let score = 0;
  
  // Check for owner name
  if (businessData.ownerFirstName) {
    const hasName = text.includes(businessData.ownerFirstName.toLowerCase());
    if (hasName) score += 25;
    else issues.push(`Owner name (${businessData.ownerFirstName}) not mentioned`);
  }
  
  // Check for business name
  if (businessData.businessName) {
    const hasBusinessName = text.includes(businessData.businessName.toLowerCase());
    if (hasBusinessName) score += 25;
    else issues.push(`Business name (${businessData.businessName}) not mentioned`);
  }
  
  // Check for location
  if (businessData.location) {
    const hasLocation = text.includes(businessData.location.toLowerCase());
    if (hasLocation) score += 25;
    else issues.push(`Location (${businessData.location}) not mentioned`);
  }
  
  // Check for category-specific references
  if (businessData.category) {
    const categoryKeywords = {
      restaurant: ['food', 'meal', 'dining', 'menu', 'dish', 'cuisine'],
      salon: ['hair', 'styling', 'cut', 'treatment', 'appointment'],
      gym: ['fitness', 'workout', 'membership', 'training', 'exercise'],
      dentist: ['dental', 'teeth', 'oral', 'checkup', 'treatment'],
      plumber: ['plumbing', 'pipe', 'leak', 'repair', 'installation'],
      cafe: ['coffee', 'drink', 'brew', 'cuppa', 'latte'],
      accountant: ['accounting', 'tax', 'financial', 'books', 'compliance']
    };
    
    const category = businessData.category.toLowerCase();
    const keywords = categoryKeywords[category] || [];
    const hasCategoryKeyword = keywords.some(keyword => text.includes(keyword));
    
    if (hasCategoryKeyword) score += 25;
    else if (keywords.length > 0) {
      issues.push(`No category-specific references found for ${category}`);
    }
  }
  
  return {
    passed: issues.length === 0,
    score: Math.min(100, score),
    issues
  };
}

/**
 * Validate rating handling - ensures proper framing as business signal
 * @param {Object} email - Email object
 * @param {Object} businessData - Business data with rating
 * @returns {Object} Validation result
 */
function validateRatingHandling(email, businessData) {
  if (!businessData.rating) {
    return { passed: true, score: 100, issues: [] };
  }
  
  const text = `${email.subject} ${email.body}`.toLowerCase();
  const issues = [];
  
  // Check for awkward personal satisfaction phrases
  const awkwardPhrases = [
    'i\'m chuffed about your rating',
    'i\'m thrilled with your',
    'i\'m pleased about your rating',
    'i\'m excited about your',
    'i\'m chuffed about your',
    'i\'m thrilled about your rating'
  ];
  
  const foundAwkward = awkwardPhrases.some(phrase => text.includes(phrase));
  
  // Check for proper business signal framing
  const properFraming = [
    'rating shows',
    'rating indicates',
    'rating speaks',
    'rating demonstrates',
    'your rating',
    'strong rating',
    'excellent rating'
  ];
  
  const hasProperFraming = properFraming.some(phrase => text.includes(phrase));
  
  if (foundAwkward) {
    issues.push('Uses personal satisfaction about rating (should frame as business signal)');
  }
  
  if (text.includes('rating') && !hasProperFraming && !foundAwkward) {
    // Rating mentioned but framing unclear - not necessarily bad
  }
  
  return {
    passed: !foundAwkward,
    score: foundAwkward ? 0 : (hasProperFraming ? 100 : 70),
    issues
  };
}

/**
 * Validate banned phrases - checks for generic phrases
 * @param {Object} email - Email object
 * @returns {Object} Validation result
 */
function validateBannedPhrases(email) {
  const text = `${email.subject} ${email.body}`.toLowerCase();
  const bannedPhrases = [
    'hope this email finds you well',
    'i hope you\'re well',
    'i\'m reaching out',
    'i hope this email finds you',
    'hope you\'re doing well',
    'i wanted to reach out'
  ];
  
  const found = bannedPhrases.filter(phrase => text.includes(phrase));
  
  return {
    passed: found.length === 0,
    found,
    issues: found.length > 0 ? [`Banned phrases found: ${found.join(', ')}`] : [],
    score: found.length === 0 ? 100 : 0
  };
}

/**
 * Validate subject parsing - ensures clean subject/body separation
 * @param {Object} email - Email object
 * @returns {Object} Validation result
 */
function validateSubjectParsing(email) {
  const issues = [];
  
  // Check if subject appears in body
  if (email.subject && email.body.toLowerCase().includes(email.subject.toLowerCase())) {
    issues.push('Subject line appears in email body');
  }
  
  // Check for "Subject:" marker in body
  if (email.body.toLowerCase().includes('subject:')) {
    issues.push('"Subject:" marker found in email body');
  }
  
  // Check subject length
  if (email.subject && email.subject.length > 60) {
    issues.push(`Subject too long: ${email.subject.length} characters (target: 60)`);
  }
  
  return {
    passed: issues.length === 0,
    issues,
    score: issues.length === 0 ? 100 : Math.max(0, 100 - (issues.length * 33))
  };
}

/**
 * Validate CTA - checks for low-pressure call-to-action
 * @param {Object} email - Email object
 * @returns {Object} Validation result
 */
function validateCTA(email) {
  const text = email.body.toLowerCase();
  const ctaPhrases = [
    'quick chat',
    'coffee',
    'cuppa',
    'quick call',
    'brief chat',
    'have a chat',
    'discuss',
    'chat',
    'call'
  ];
  
  const hasCTA = ctaPhrases.some(phrase => text.includes(phrase));
  
  // Check for high-pressure CTAs (negative)
  const highPressure = [
    'buy now',
    'sign up today',
    'limited time',
    'act now',
    'don\'t miss out'
  ];
  
  const hasHighPressure = highPressure.some(phrase => text.includes(phrase));
  
  const issues = [];
  if (!hasCTA) {
    issues.push('No clear call-to-action found');
  }
  if (hasHighPressure) {
    issues.push('High-pressure CTA detected (should be low-pressure)');
  }
  
  return {
    passed: hasCTA && !hasHighPressure,
    hasCTA,
    hasHighPressure,
    issues,
    score: hasCTA && !hasHighPressure ? 100 : (hasCTA ? 70 : 0)
  };
}

/**
 * Score email quality - overall quality score
 * @param {Object} email - Email object
 * @param {Object} businessData - Business data object
 * @returns {Object} Complete quality report
 */
function scoreEmailQuality(email, businessData) {
  const ukTone = validateUKTone(email);
  const length = validateLength(email);
  const personalization = validatePersonalization(email, businessData);
  const rating = validateRatingHandling(email, businessData);
  const banned = validateBannedPhrases(email);
  const subject = validateSubjectParsing(email);
  const cta = validateCTA(email);
  
  // Weighted scoring
  const weights = {
    ukTone: 15,
    length: 10,
    personalization: 20,
    rating: 15,
    banned: 20, // Critical - banned phrases are deal-breakers
    subject: 10,
    cta: 10
  };
  
  const weightedScore = (
    (ukTone.score * weights.ukTone) +
    (length.score * weights.length) +
    (personalization.score * weights.personalization) +
    (rating.score * weights.rating) +
    (banned.score * weights.banned) +
    (subject.score * weights.subject) +
    (cta.score * weights.cta)
  ) / Object.values(weights).reduce((a, b) => a + b, 0);
  
  const allIssues = [
    ...ukTone.issues,
    ...length.issues,
    ...personalization.issues,
    ...rating.issues,
    ...banned.issues,
    ...subject.issues,
    ...cta.issues
  ];
  
  return {
    overallScore: Math.round(weightedScore),
    passed: weightedScore >= 85 && banned.passed, // Must pass banned phrases check
    checks: {
      ukTone,
      length,
      personalization,
      rating,
      banned,
      subject,
      cta
    },
    issues: allIssues,
    summary: {
      wordCount: length.wordCount,
      charCount: length.charCount,
      hasUKPhrases: ukTone.hasUKPhrases,
      hasPersonalization: personalization.score >= 75,
      hasProperRating: rating.passed,
      hasBannedPhrases: !banned.passed,
      hasSubjectIssues: !subject.passed,
      hasCTA: cta.hasCTA
    }
  };
}

module.exports = {
  validateUKTone,
  validateLength,
  validatePersonalization,
  validateRatingHandling,
  validateBannedPhrases,
  validateSubjectParsing,
  validateCTA,
  scoreEmailQuality
};
