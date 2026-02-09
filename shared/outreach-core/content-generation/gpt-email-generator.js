/**
 * GPT-4 Email Generation Module
 * Generates personalized email content using OpenAI GPT-4
 * with micro-offer system: category-specific angles + observation signals
 *
 * @module gpt-email-generator
 */

const https = require("https");
const { getCredential } = require("../credentials-loader");
const logger = require("../logger");
const { getCategoryGroup, getCategoryEmailAngles } = require("./category-mapper");
const { computeObservationSignals, selectPrimarySignal, getSignalHook } = require("./observation-signals");
const { getCurrencyForLocation } = require("./currency-localization");

const OPENAI_BASE_URL = "api.openai.com";
const REQUEST_TIMEOUT_MS = 60000; // OpenAI can be slow, 60 seconds

// 24-Rule Email System Prompt (Micro-Offer System)
const EMAIL_SYSTEM_PROMPT = `You are a cold email copywriter who writes like a busy business owner reaching out to a peer, not a marketer pitching a stranger.

24 RULES (follow strictly):
1. Write like a busy business owner, not a marketer
2. No buzzwords, jargon, or corporate speak
3. Keep emails under 120 words (allows room for social proof while staying concise)
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
20. ALWAYS end with "Sent from my iPhone" (no name, no other signature)
21. NEVER use em dashes (—) - use regular hyphens (-) or commas instead
22. NEVER mention case studies, links to articles, or resources that don't exist - offer direct help only
23. SOCIAL PROOF: Where natural, mention working with high-profile clients like Twiggy (the iconic 60s model) for credibility - weave it in casually, not as a boast
24. LOCAL PROXIMITY (CRITICAL): Mention "I'm just down the road in Poynton" for nearby locations (Bramhall, Stockport, Hazel Grove, Cheadle) OR "easy to get to from Poynton" for Manchester/city center - builds trust and shows you're genuinely local`;

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
  const prompt = customPrompt || buildEmailPrompt(params);
  
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
            logger.error('gpt-email-generator', 'OpenAI API error', { 
              error: result.error 
            });
            reject(new Error(`OpenAI API error: ${result.error.message}`));
            return;
          }

          if (!result.choices || !result.choices[0] || !result.choices[0].message) {
            logger.error('gpt-email-generator', 'Unexpected response structure', { 
              hasChoices: !!result.choices,
              choicesLength: result.choices?.length
            });
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
          logger.error('gpt-email-generator', 'Failed to parse response', { 
            error: error.message,
            rawDataPreview: data.substring(0, 200)
          });
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
  // NOTE: Future enhancement - match angle to signal intelligently
  // This requires analyzing which angle best fits the detected signals
  // and is planned for v2.0. See GitHub issue #42.
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
- Under 120 words total (allows room for social proof)
- Lowercase subject line (no capital letters except names)
- No buzzwords, jargon, or exclamation marks
- UK English spelling and tone
- Conversational, like one business owner to another
- Reference ${location} or local context
- If competitor provided, use as social proof naturally
- Keep barter mention subtle if included
- CRITICAL: NEVER use em dashes (—) - use regular hyphens (-) or commas instead
- CRITICAL: DO NOT mention case studies, links to articles, or resources - offer direct practical help only (e.g., "I can show you how" not "I have a case study about...")
- SOCIAL PROOF: Where it fits naturally, mention working with high-profile clients like Twiggy (the iconic 60s model) - keep it casual: "I've built sites for everyone from local salons to Twiggy" or similar
- CRITICAL LOCAL PROXIMITY: Include casual mention of being based in Poynton to build local trust:
  * For Bramhall/Stockport/Hazel Grove/Cheadle: "I'm just down the road in Poynton"
  * For Manchester city center: "I'm in Poynton so easy to get to Manchester - 20 min on the train"
  * For other nearby towns (within 30 min): "I'm based in Poynton, just a short drive away"
  * Keep it natural and casual, not forced

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
