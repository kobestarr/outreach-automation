/**
 * Claude LinkedIn Generation Module
 * Generates LinkedIn connection notes and messages using Anthropic Claude
 * with micro-offer system: category-specific angles + observation signals
 *
 * DROP-IN REPLACEMENT for gpt-linkedin-generator.js
 *
 * @module claude-linkedin-generator
 */

const { getCredential } = require("../credentials-loader");
const { getCategoryGroup, getCategoryLinkedInAngles } = require("./category-mapper");
const { resolveModel } = require("../llm-models");
const { callAnthropic } = require("../anthropic-call");

const REQUEST_TIMEOUT_MS = 60000;

// 21-Rule LinkedIn System Prompt
const LINKEDIN_SYSTEM_PROMPT = `You are a professional LinkedIn communicator who writes concise, value-focused messages.

21 RULES (follow strictly):
1. Connection notes: 1-2 sentences max (<300 chars)
2. Sound human, not corporate: "I love" not "I'm intrigued by" or "amazing work"
3. NO sales pitch in connection note (just context)
4. Business name ONLY: NEVER include location - write "The Cutting Room" NOT "The Cutting Room in Bramhall"
5. NO corporate/marketing speak AT ALL: Banned words include "differentiate", "unique value proposition", "target audience", "standing out", "crowded market", "articulate", "unique qualities", "showcase", "position", "brand identity"
6. Use plain language: "get more clients" not "acquire customers", "keep clients coming back" not "retention strategy"
7. First message: Start with "Hi [Name], I don't know if you saw my email so I thought I'd try here."
8. NEVER mention resources/articles that don't exist (no fake case studies/articles)
9. Offer practical operations help (bookings, scheduling, client communication) NOT market positioning/branding advice
10. Low-pressure CTA: "Let me know if that's useful?" or "Worth a chat?"
11. UK tone (professional but warm)
12. Different angle than email (critical requirement)
13. No emojis (unprofessional in B2B)
14. Keep total message under 500 characters
15. Use first name only (no Mr./Ms.)
16. Lead with mutual context (location, industry, observation)
17. Reference specific detail from their profile/business
18. Sign off with just first name
19. NEVER use em dashes (—) - use regular hyphens (-) or commas instead
20. SOCIAL PROOF: Where natural, mention working with high-profile clients like Twiggy (the iconic 60s model) for credibility - weave it in casually, not as a boast
21. LOCAL PROXIMITY: Mention being based in Poynton to build local trust ("I'm just down the road in Poynton" for nearby areas, "easy to get to from Poynton" for Manchester)`;

/**
 * Generate LinkedIn connection note
 *
 * @param {Object} params - Business data
 * @param {string} params.model - Claude model (default: OUTREACH_LINKEDIN_MODEL, then OUTREACH_COPY_MODEL, then claude-sonnet-5-5)
 * @param {string} params.existingText - copy already stored for this record; returned as is with no API call
 * @returns {Promise<string>} Connection note text
 */
async function generateConnectionNote(params) {
  const {
    businessName,
    ownerFirstName,
    category,
    location,
    model: requestedModel,
    existingText // already generated and stored: reuse, no call
  } = params;

  if (existingText) return existingText;

  const model = resolveModel("linkedin", requestedModel);
  const apiKey = getCredential("anthropic", "apiKey");

  // Get category group for context
  const categoryGroup = getCategoryGroup(category);

  const prompt = `Write a LinkedIn connection request note for a UK local business owner.

Business: ${businessName}
Owner: ${ownerFirstName}
Category: ${category} (${categoryGroup})
Location: ${location}

Requirements:
- Under 300 characters (LinkedIn limit)
- Reference their business and location as context
- NO sales pitch - just friendly professional context
- Use casual tone: "I love" not "I'm intrigued by"
- Business name ONLY (no location suffix)
- Example: "Hi ${ownerFirstName}, I work with ${category} businesses in ${location} and love what you're doing with ${businessName}. Would be great to connect."

Output just the connection note text (no labels or formatting).`;

  const result = await callAnthropic({
    apiKey,
    body: {
      model,
      max_tokens: Number(process.env.OUTREACH_LINKEDIN_NOTE_MAX_TOKENS) || 300,
      temperature: 0.75,
      system: LINKEDIN_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }]
    },
    timeoutMs: REQUEST_TIMEOUT_MS
  });

  const text = result.text.trim();
  if (!text) {
    throw new Error("Anthropic API returned unexpected response structure");
  }
  return text;
}

/**
 * Generate LinkedIn message (post-connection)
 *
 * @param {Object} params - Business data and email context
 * @param {string} params.model - Claude model (default: OUTREACH_LINKEDIN_MODEL, then OUTREACH_COPY_MODEL, then claude-sonnet-5-5)
 * @param {string} params.existingText - copy already stored for this record; returned as is with no API call
 * @returns {Promise<string>} LinkedIn message text
 */
async function generateLinkedInMessage(params) {
  const {
    businessName,
    ownerFirstName,
    category,
    location,
    emailSubject,
    emailBody,
    model: requestedModel,
    existingText // already generated and stored: reuse, no call
  } = params;

  if (existingText) return existingText;

  const model = resolveModel("linkedin", requestedModel);
  const apiKey = getCredential("anthropic", "apiKey");

  // Get category group and LinkedIn angles (different from email)
  const categoryGroup = getCategoryGroup(category);
  const linkedInAngles = getCategoryLinkedInAngles(categoryGroup);
  const primaryAngle = linkedInAngles[0] || "growing your business";

  const prompt = `Write a LinkedIn message (post-connection) for a UK local business owner.

Business: ${businessName}
Owner: ${ownerFirstName}
Category: ${category} (${categoryGroup})
Location: ${location}
LinkedIn Angle: ${primaryAngle} (use this as context, different from email)

Email Context (DO NOT REPEAT):
Subject: ${emailSubject}
Body: ${emailBody}

Requirements:
- Start with: "Hi ${ownerFirstName}, I don't know if you saw my email so I thought I'd try here."
- Reference the LinkedIn angle: "${primaryAngle}"
- Offer practical operations help (bookings, scheduling, client communication)
- NO market positioning/branding advice (banned: "differentiate", "stand out", "target audience")
- Use plain language: "get more clients" not "acquire customers"
- Low-pressure CTA: "Let me know if that's useful?" or "Worth a chat?"
- Under 500 characters total
- Business name ONLY (no location)
- Different angle than email
- CRITICAL: NEVER use em dashes (—) - use regular hyphens (-) or commas instead
- DO NOT mention case studies or articles that don't exist - offer direct help only
- Optional: If it fits naturally, mention working with prominent clients like Twiggy for credibility
- CRITICAL: Mention being based in Poynton for local trust: "I'm just down the road in Poynton" for nearby areas or "easy to get to from Poynton" for Manchester

Output just the message text (no labels or formatting).`;

  const result = await callAnthropic({
    apiKey,
    body: {
      model,
      max_tokens: Number(process.env.OUTREACH_LINKEDIN_MESSAGE_MAX_TOKENS) || 400,
      temperature: 0.75,
      system: LINKEDIN_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }]
    },
    timeoutMs: REQUEST_TIMEOUT_MS
  });

  const text = result.text.trim();
  if (!text) {
    throw new Error("Anthropic API returned unexpected response structure");
  }
  return text;
}

module.exports = {
  generateConnectionNote,
  generateLinkedInMessage,
  // Export for testing/debugging
  LINKEDIN_SYSTEM_PROMPT
};
