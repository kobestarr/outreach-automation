/**
 * GPT-4 Email Generation Module
 * Generates personalized email content using OpenAI GPT-4
 * with micro-offer system: category-specific angles + observation signals
 *
 * @module gpt-email-generator
 */

const https = require("https");
const { getCredential } = require("../credentials-loader");
const { getCategoryGroup, getCategoryEmailAngles } = require("./category-mapper");
const { computeObservationSignals, selectPrimarySignal, getSignalHook } = require("./observation-signals");
const { getCurrencyForLocation } = require("./currency-localization");

const OPENAI_BASE_URL = "api.openai.com";
const REQUEST_TIMEOUT_MS = 60000; // OpenAI can be slow, 60 seconds

// 20-Rule Email System Prompt (Micro-Offer System)
const EMAIL_SYSTEM_PROMPT = `You are a cold email copywriter who writes like a busy business owner reaching out to a peer, not a marketer pitching a stranger.

20 RULES (follow strictly):
1. Write like a busy business owner, not a marketer
2. No buzzwords, jargon, or corporate speak
3. Keep emails under 100 words (4-5 sentences max)
4. Use lowercase subject lines (feels less sales-y)
5. Lead with specific observation, not generic pleasantry
6. Reference local context (location, competitor, category)
7. One clear CTA per email (micro-offer link or calendar)
8. UK English spelling and tone (not American)
9. No "hope this email finds you well" or similar clichés
10. No exclamation marks (feels desperate)
11. Use short sentences and paragraphs
12. Conversational tone (contractions OK: "I've noticed", "you're")
13. Specific over generic ("22 reviews" not "some reviews")
14. Lead with value/observation, not self-introduction
15. Reference pain point without stating it explicitly
16. Subtle barter mentions (if applicable) - natural connection, not pitch
17. Social proof via competitor mention (if available)
18. Pricing in local currency with proper formatting
19. No attachments or links (except micro-offer/calendar)
20. Sign off casually (just first name, no signature block)`;

/**
 * Generate email content using GPT-4 with micro-offer system
 *
 * @param {Object} params - Business data and configuration
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
    customPrompt // DEPRECATED: kept for backward compatibility, bypasses micro-offer system
  } = params;

  const apiKey = getCredential("openai", "apiKey");

  // Build prompt (use custom prompt if provided for backward compatibility, otherwise use micro-offer system)
  const prompt = customPrompt || buildEmailPrompt({
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
    socialMedia
  });
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: EMAIL_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 1500 // Increased for micro-offer system
    });
    
    const options = {
      hostname: OPENAI_BASE_URL,
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
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
            console.error("[OpenAI] API error response:", JSON.stringify(result.error, null, 2));
            reject(new Error(`OpenAI API error: ${result.error.message}`));
            return;
          }

          if (!result.choices || !result.choices[0] || !result.choices[0].message) {
            console.error("[OpenAI] Unexpected response structure:", JSON.stringify(result, null, 2));
            reject(new Error("OpenAI API returned unexpected response structure"));
            return;
          }

          const content = result.choices[0].message.content;

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
              model: "gpt-4",
              temperature: 0.7,
              generatedAt: new Date().toISOString()
            }
          });
        } catch (error) {
          console.error("[OpenAI] Failed to parse response. Raw data:", data.substring(0, 500));
          reject(new Error(`Failed to parse OpenAI response: ${error.message}`));
        }
      });
    });

    // Set request timeout (OpenAI can be slow)
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`OpenAI API request timeout after ${REQUEST_TIMEOUT_MS}ms`));
    });

    req.on("error", (error) => {
      if (error.code === "ECONNRESET") {
        reject(new Error("OpenAI API connection reset - request may have timed out"));
      } else {
        reject(new Error(`OpenAI API request error: ${error.message}`));
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
  // TODO: Future enhancement - match angle to signal intelligently
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
 * Parse email content from GPT response
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
