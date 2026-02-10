/**
 * GPT-4 LinkedIn Content Generation Module
 * Generates LinkedIn connection notes and messages using micro-offer system
 * Ensures angles differ from email content
 */

const https = require("https");
const { getCredential } = require("../credentials-loader");
const { getCategoryGroup, getCategoryLinkedInAngles } = require("./category-mapper");
const { computeObservationSignals } = require("./observation-signals");

const OPENAI_BASE_URL = "api.openai.com";

// 23-Rule LinkedIn System Prompt (Micro-Offer System)
const LINKEDIN_SYSTEM_PROMPT = `You are a professional LinkedIn communicator who writes concise, value-focused messages.

23 RULES (follow strictly):
1. Connection notes: 1-2 sentences max (LinkedIn limits to 300 chars)
2. Sound human, not corporate: "I love" not "I'm intrigued by" or "amazing work", "running" not "established"
3. NO sales pitch in connection note (just context for why connecting)
4. Business name ONLY: NEVER include location - write "The Cutting Room" NOT "The Cutting Room in Bramhall"
5. NO corporate/marketing speak AT ALL: banned words include "differentiate", "unique value proposition", "target audience", "client lifetime value", "standing out", "crowded market", "articulate", "unique qualities", "unique appeal", "highlight", "showcase", "position", "brand identity"
6. Use plain language: "get more clients" not "acquire customers", "keep clients coming back" not "retention strategy", "what works for you" not "your unique approach"
7. First message: Start with "Hi [Name], I don't know if you saw my email so I thought I'd try here."
8. NEVER mention resources/articles that don't exist (no fake case studies/articles)
9. Offer specific value you can actually deliver, not vague "insights"
10. Low-pressure CTA (reply/react, not "book a call")
11. UK tone (professional but warm)
12. No buzzwords ("synergy", "leverage", "circle back")
13. Different angle than email (don't repeat same hook)
14. Use first name only (no Mr./Ms.)
15. No emojis (feels unprofessional in B2B)
16. Lead with mutual context (location, industry, observation)
17. Conversational but not overly casual
18. One CTA per message
19. Keep total message under 500 characters
20. Sign off with just first name
21. NEVER use em dashes (—) - use regular hyphens (-) or commas instead
22. SOCIAL PROOF: Where natural, mention working with high-profile clients like Twiggy (the iconic 60s model) for credibility - weave it in casually, not as a boast
23. LOCAL PROXIMITY: Mention being based in Poynton to build local trust ("I'm just down the road in Poynton" for nearby areas, "easy to get to from Poynton" for Manchester)`;

/**
 * Generate LinkedIn connection request note
 * Uses category-specific LinkedIn angles (different from email)
 *
 * @param {Object} params - Business owner data
 * @param {string} params.customPrompt - (DEPRECATED) Custom prompt override
 * @returns {Promise<string>} Connection note text
 */
async function generateConnectionNote(params) {
  const {
    ownerFirstName,
    businessName,
    category,
    location,
    linkedInTitle,
    emailAngleUsed, // Optional: angle used in email to avoid repetition
    customPrompt // DEPRECATED
  } = params;

  const apiKey = getCredential("openai", "apiKey");

  if (customPrompt) {
    // Backward compatibility: use custom prompt if provided
    return callGPT4(customPrompt, apiKey);
  }

  // 1. Determine category group
  const categoryGroup = getCategoryGroup(category);

  // 2. Get LinkedIn angles (different from email angles)
  const linkedInAngles = getCategoryLinkedInAngles(categoryGroup);

  // 3. Select angle (use first LinkedIn angle, which differs from email angles)
  const selectedAngle = linkedInAngles[0] || "building a stronger local presence";

  const prompt = `Write a LinkedIn connection request note for a UK local business owner.

Name: ${ownerFirstName}
Business: ${businessName}
Category: ${category} (${categoryGroup})
Location: ${location}
Title: ${linkedInTitle || "Business Owner"}
Context Angle: ${selectedAngle}
${emailAngleUsed ? `Note: Avoid mentioning "${emailAngleUsed}" (already used in email)` : ""}

Requirements:
- 1-2 sentences max (under 300 characters total)
- Reference their business or location naturally
- NO sales pitch (just context for connecting)
- Professional but warm UK tone
- Use the context angle subtly if relevant
- Just first name in sign-off

Output just the connection note text (no labels):`;

  return callGPT4(prompt, apiKey);
}

/**
 * Generate LinkedIn first message (post-connection)
 * Ensures angle differs from email content to avoid repetition
 *
 * @param {Object} params - Business owner data + email context
 * @param {string} params.emailPrimaryHook - Primary hook used in email (to avoid)
 * @param {string} params.customPrompt - (DEPRECATED) Custom prompt override
 * @returns {Promise<string>} LinkedIn message text
 */
async function generateLinkedInMessage(params) {
  const {
    ownerFirstName,
    businessName,
    category,
    location,
    emailSubject,
    emailPrimaryHook, // What observation/hook was used in email
    customPrompt // DEPRECATED
  } = params;

  const apiKey = getCredential("openai", "apiKey");

  if (customPrompt) {
    // Backward compatibility: use custom prompt if provided
    return callGPT4(customPrompt, apiKey);
  }

  // 1. Determine category group
  const categoryGroup = getCategoryGroup(category);

  // 2. Get LinkedIn angles (different from email angles)
  const linkedInAngles = getCategoryLinkedInAngles(categoryGroup);

  // 3. Select angle that's different from email hook
  // Use second LinkedIn angle if available, otherwise first
  const selectedAngle = linkedInAngles[1] || linkedInAngles[0] || "growing your customer base";

  const prompt = `Write a LinkedIn first message for ${ownerFirstName} at ${businessName} in ${location}.

Context:
- They just accepted your connection request
- You previously sent them an email (subject: "${emailSubject || "Quick question about their business"}")
- This LinkedIn message should offer value via a different angle
- Email hook used: ${emailPrimaryHook || "general business growth"}
- LinkedIn angle to use: ${selectedAngle}

Requirements:
- Start with: "Hi ${ownerFirstName}, I don't know if you saw my email so I thought I'd try here."
- 2-3 sentences (under 500 characters)
- Offer practical help with: "${selectedAngle}" (NOT market positioning/branding/differentiation advice)
- DO NOT mention: market positioning, standing out, competitors, crowded market, differentiation, unique selling points
- INSTEAD offer: practical tips about operations, bookings, scheduling, client communication
- DO NOT repeat the email's observation: "${emailPrimaryHook}"
- Low-pressure CTA: "Let me know if that's useful?" or "Worth a chat?"
- Professional but warm UK tone
- Sign off with just first name

Output just the message text:`;

  return callGPT4(prompt, apiKey);
}

/**
 * Call GPT-4 API with LinkedIn-optimized settings
 */
function callGPT4(prompt, apiKey) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: LINKEDIN_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.75, // Slightly higher for spontaneity
      max_tokens: 800 // Increased for longer DM sequences
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
            reject(new Error(`OpenAI API error: ${result.error.message}`));
            return;
          }
          
          resolve(result.choices[0].message.content.trim());
        } catch (error) {
          reject(new Error(`Failed to parse OpenAI response: ${error.message}`));
        }
      });
    });
    
    req.on("error", (error) => {
      reject(new Error(`OpenAI API request error: ${error.message}`));
    });
    
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('OpenAI API request timed out after 30s'));
    });
    
    req.write(postData);
    req.end();
  });
}

module.exports = {
  generateConnectionNote,
  generateLinkedInMessage,
  // Export for testing/debugging
  LINKEDIN_SYSTEM_PROMPT
};
