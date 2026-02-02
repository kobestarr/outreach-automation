/**
 * Email Pattern Generator
 * Generates likely email patterns from name + domain
 */

/**
 * Generate email patterns from name and domain
 */
function generateEmailPatterns({ firstName, lastName, domain }) {
  if (!domain) return [];
  
  const first = (firstName || "").toLowerCase().replace(/[^a-z]/g, "");
  const last = (lastName || "").toLowerCase().replace(/[^a-z]/g, "");
  
  const patterns = [];
  
  if (first && last) {
    patterns.push(`${first}.${last}@${domain}`);
    patterns.push(`${first}${last}@${domain}`);
    patterns.push(`${first}@${domain}`);
    if (first.length > 0) {
      patterns.push(`${first[0]}.${last}@${domain}`);
      patterns.push(`${first[0]}${last}@${domain}`);
    }
    patterns.push(`${last}@${domain}`);
  } else if (first) {
    patterns.push(`${first}@${domain}`);
  } else if (last) {
    patterns.push(`${last}@${domain}`);
  }
  
  patterns.push(`info@${domain}`);
  patterns.push(`hello@${domain}`);
  patterns.push(`contact@${domain}`);
  
  return [...new Set(patterns)];
}

/**
 * Extract domain from URL
 */
function extractDomain(url) {
  if (!url) return null;
  
  try {
    let domain = url.replace(/^https?:\/\//, "");
    domain = domain.replace(/^www\./, "");
    domain = domain.split("/")[0];
    domain = domain.split(":")[0];
    return domain || null;
  } catch (error) {
    return null;
  }
}

module.exports = {
  generateEmailPatterns,
  extractDomain
};
