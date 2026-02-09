/**
 * Claude Email Generation Module
 * Generates personalized email content using Anthropic Claude
 * with micro-offer system: category-specific angles + observation signals
 *
 * DROP-IN REPLACEMENT for gpt-email-generator.js
 *
 * @module claude-email-generator
 */

const https = require("https");
const { getCredential } = require("../credentials-loader");
const logger = require("../logger");
const { getCategoryGroup, getCategoryEmailAngles } = require("./category-mapper");
const { computeObservationSignals, selectPrimarySignal, getSignalHook } = require("./observation-signals");
const { getCurrencyForLocation } = require("./currency-localization");

const ANTHROPIC_BASE_URL = "api.anthropic.com";
const REQUEST_TIMEOUT_MS = 60000;
const ANTHROPIC_VERSION = "2023-06-01"; // Required header

// 20-Rule Email System Prompt (Micro-Offer System)
const EMAIL_SYSTEM_PROMPT = `You are a cold email copywriter who writes like a busy business owner reaching out to a peer, not a marketer pitching a stranger.

20 RULES (follow strictly):
1. Write like a busy business owner, not a marketer
2. No buzzwords, jargon, or corporate speak
3. Keep emails under 100 words (4-5 sentences max)
4. Use lowercase subject lines (feels less sales-y)
5. ALWAYS start with casual greeting: "Hi [Name]," or "Hey [Name],"
6. Reference business name ONLY - never add location/postcode (e.g. "The Cutting Room" not "The Cutting Room in Bramhall, SK7")
7. Use plain language: "help keeping clients" not "help with client retention", "rebooking" not "retention"
8. ALWAYS say "From just £X" NEVER "For just £X" or "for just £X" or "Could X for just £X"
9. One clear CTA per email (micro-offer link or calendar)
10. UK English spelling and tone (not American)
11. No "hope this email finds you well" or similar clichés
12. No exclamation marks (feels desperate)
13. Use short sentences and paragraphs
14. Conversational tone (contractions OK: "I've noticed", "you're")
15. Specific over generic ("22 reviews" not "some reviews")
16. Lead with observation, not self-introduction
17. Reference pain point without stating it explicitly
18. Subtle barter mentions (if applicable) - natural connection, not pitch
19. Social proof via competitor mention (if available)
20. ALWAYS end with "Sent from my iPhone" (no name, no other signature)`;

/**
 * Generate email content using Claude with micro-offer system
 *
 * @param {Object} params - Business data and configuration
 * @param {string} params.model - Claude model to use (default: claude-sonnet-4-5-20250929)
 * @param {string} params.customPrompt - (DEPRECATED) Custom prompt override - bypasses micro-offer system. Only use for testing.
 * @returns {Promise<Object>} Email with subject, body, fullContent, and metadata
 */
async function generateEmailContent(params) {
  const {
    barterOpportunity,
    businessName,
    ownerFirstName,
    category,
    location,
    website,
    reviewCount,
    rating,
    competitorName,
    country,
    instagramUrl,
    facebookUrl,
    socialMedia,
    model = "claude-sonnet-4-5-20250929", // Default to Sonnet 4.5 (best balance)
    customPrompt // DEPRECATED: kept for backward compatibility, bypasses micro-offer system
  } = params;

  const apiKey = getCredential("anthropic", "apiKey");

  // Build prompt (use custom prompt if provided for backward compatibility, otherwise use micro-offer system)
  const prompt = customPrompt || buildEmailPrompt(params);

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: model,
      max_tokens: 1500,
      temperature: 0.7,
      system: EMAIL_SYSTEM_PROMPT, // Claude uses separate system parameter
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    });

    const options = {
      hostname: ANTHROPIC_BASE_URL,
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Length": Buffer.byteLength(postData)
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

          if (result.error) {
            logger.error('claude-email-generator', 'Anthropic API error', {
              error: result.error
            });
            reject(new Error(`Anthropic API error: ${result.error.message}`));
            return;
          }

          if (!result.content || !result.content[0] || !result.content[0].text) {
            logger.error('claude-email-generator', 'Unexpected response structure', {
              hasContent: !!result.content,
              contentLength: result.content?.length
            });
            reject(new Error("Anthropic API returned unexpected response structure"));
            return;
          }

          const content = result.content[0].text;

          // Parse subject and body from response
          const parsed = parseEmailContent(content);

          // Get metadata from params if available (set by buildEmailPrompt)
          const metadata = params._metadata || {};

          resolve({
            subject: parsed.subject,
            body: parsed.body,
            fullContent: content,
            metadata: {
              primaryHook: metadata.primarySignal || null,
              toneRegion: metadata.country || "UK",
              categoryAngle: metadata.primaryAngle || null,
              categoryGroup: metadata.categoryGroup || null,
              observationSignals: metadata.signals || [],
              microOfferPrice: metadata.microOfferPrice || null,
              fullOfferPrice: metadata.fullOfferPrice || null,
              model: model,
              temperature: 0.7,
              generatedAt: new Date().toISOString()
            }
          });
        } catch (error) {
          logger.error('claude-email-generator', 'Failed to parse response', {
            error: error.message,
            rawDataPreview: data.substring(0, 200)
          });
          reject(new Error(`Failed to parse Anthropic response: ${error.message}`));
        }
      });
    });

    // Set request timeout
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`Anthropic API request timeout after ${REQUEST_TIMEOUT_MS}ms`));
    });

    req.on("error", (error) => {
      if (error.code === "ECONNRESET") {
        reject(new Error("Anthropic API connection reset - request may have timed out"));
      } else {
        reject(new Error(`Anthropic API request error: ${error.message}`));
      }
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Build email prompt from business data using micro-offer system
 * Computes category angles, observation signals, and currency localization
 */
function buildEmailPrompt(params) {
  const {
    barterOpportunity,
    businessName,
    ownerFirstName,
    category,
    location,
    reviewCount,
    rating,
    competitorName,
    website,
    country // optional country override
  } = params;

  // 1. Determine category group
  const categoryGroup = getCategoryGroup(category);

  // 2. Compute observation signals
  const signals = computeObservationSignals({
    reviewCount,
    rating,
    website,
    instagramUrl: params.instagramUrl,
    facebookUrl: params.facebookUrl,
    socialMedia: params.socialMedia
  });

  // 3. Select primary signal (most important)
  const primarySignal = selectPrimarySignal(signals);
  const signalHook = primarySignal ? getSignalHook(primarySignal) : "growing your business";

  // 4. Get category angles
  const angles = getCategoryEmailAngles(categoryGroup);

  // 5. Select primary angle (use first angle as default)
  const primaryAngle = angles[0] || "optimizing your customer acquisition";

  // 6. Get currency for location
  const currency = getCurrencyForLocation(location, country);

  // 7. Store metadata for later (attach to params for access in resolve)
  params._metadata = {
    categoryGroup,
    signals,
    primarySignal,
    primaryAngle,
    country: currency.country,
    microOfferPrice: `${currency.symbol}${currency.microOffer}`,
    fullOfferPrice: `${currency.symbol}${currency.fullOffer}`
  };

  // 8. Build barter mention if available
  let barterNote = "";
  if (barterOpportunity && barterOpportunity.available && barterOpportunity.eligible) {
    barterNote = `

Barter Context: This business offers ${barterOpportunity.offering}. If appropriate, mention this subtly and naturally as a connection point (e.g., "I'm a regular at places like yours" or "I love supporting local ${category} businesses"). Keep it conversational, NOT an explicit barter pitch.`;
  }

  // 9. Build micro-offer prompt
  return `Write a cold email for a UK local business using the micro-offer approach.

Business: ${businessName || "their business"}
Owner: ${ownerFirstName || "the owner"}
Category: ${category} (${categoryGroup})
Location: ${location}
Observation: ${primarySignal ? `${primarySignal} - ${signalHook}` : "general opportunity"}
Category Angle: ${primaryAngle}
Reviews: ${reviewCount !== undefined && reviewCount !== null ? reviewCount : "Unknown"} (Rating: ${rating || "N/A"})
Website: ${website || "None listed"}
Competitor (social proof): ${competitorName || "None"}
Micro-Offer Price: ${currency.symbol}${currency.microOffer}
Full Offer Price: ${currency.symbol}${currency.fullOffer}${barterNote}

Requirements:
- Lead with the observation: "${signalHook}"
- Use the category angle as context: "${primaryAngle}"
- Micro-offer CTA: "Just ${currency.symbol}${currency.microOffer} to get started" or similar
- Under 100 words total
- Lowercase subject line (no capital letters except names)
- No buzzwords, jargon, or exclamation marks
- UK English spelling and tone
- Conversational, like one business owner to another
- Reference ${location} or local context
- If competitor provided, use as social proof naturally
- Keep barter mention subtle if included

Output format:
Subject: [subject line]
Body: [email body]`;
}

/**
 * Parse email content from Claude response
 */
function parseEmailContent(content) {
  const lines = content.split("\n");
  let subject = "";
  let body = "";
  let inBody = false;

  for (const line of lines) {
    if (line.toLowerCase().startsWith("subject:")) {
      subject = line.replace(/^subject:\s*/i, "").trim();
    } else if (line.toLowerCase().startsWith("body:")) {
      inBody = true;
      body = line.replace(/^body:\s*/i, "").trim();
    } else if (inBody) {
      body += "\n" + line.trim();
    }
  }

  // Fallback: if no subject/body markers, use first line as subject, rest as body
  if (!subject && !body) {
    const parts = content.split("\n\n");
    subject = parts[0] || "";
    body = parts.slice(1).join("\n\n") || content;
  }

  return {
    subject: subject || "Quick question about your business",
    body: body || content
  };
}

/**
 * Generate email sequence (4 variations)
 */
async function generateEmailSequence(businessData, sequenceConfig = {}) {
  const emails = [];

  // Email 1: Initial outreach
  emails.push(await generateEmailContent({
    ...businessData,
    customPrompt: sequenceConfig.email1Prompt || undefined
  }));

  // Email 2: Follow-up (if no response)
  emails.push(await generateEmailContent({
    ...businessData,
    customPrompt: sequenceConfig.email2Prompt || `Write a follow-up email (Email 2 of 4) for ${businessData.businessName}. This is a gentle follow-up with a helpful tip or resource. Keep it brief and low-pressure.`
  }));

  // Email 3: Case study/value prop
  emails.push(await generateEmailContent({
    ...businessData,
    customPrompt: sequenceConfig.email3Prompt || `Write a follow-up email (Email 3 of 4) for ${businessData.businessName}. Share a brief case study or specific value proposition. Still low-pressure.`
  }));

  // Email 4: Final touch
  emails.push(await generateEmailContent({
    ...businessData,
    customPrompt: sequenceConfig.email4Prompt || `Write a final follow-up email (Email 4 of 4) for ${businessData.businessName}. This is the last one - make it clear but still respectful.`
  }));

  return emails;
}

module.exports = {
  generateEmailContent,
  generateEmailSequence,
  buildEmailPrompt,
  // Export for testing/debugging
  EMAIL_SYSTEM_PROMPT
};
