/**
 * GPT-4 Email Generation Module
 * Generates personalized email content using OpenAI GPT-4
 */

const https = require("https");
const { getCredential } = require("../credentials-loader");

const OPENAI_BASE_URL = "api.openai.com";

/**
 * Generate email content using GPT-4
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
    jtbdFear,
    leadMagnet,
    offerTier,
    customPrompt
  } = params;
  
  const apiKey = getCredential("openai", "apiKey");
  
  // Build prompt (use custom prompt if provided, otherwise use default)
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
    jtbdFear,
    leadMagnet,
    offerTier
  });
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are an expert cold email copywriter specializing in UK local business outreach. Write friendly, helpful, low-pressure emails that feel personal and genuine."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 500
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
          
          const content = result.choices[0].message.content;
          
          // Parse subject and body from response
          const parsed = parseEmailContent(content);
          
          resolve({
            subject: parsed.subject,
            body: parsed.body,
            fullContent: content
          });
        } catch (error) {
          reject(new Error(`Failed to parse OpenAI response: ${error.message}`));
        }
      });
    });
    
    req.on("error", (error) => {
      reject(new Error(`OpenAI API request error: ${error.message}`));
    });
    
    req.write(postData);
    req.end();
  });
}

/**
 * Build email prompt from business data
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
    jtbdFear,
    leadMagnet,
    offerTier
  } = params;
  
  // Build barter mention if available
  let barterNote = "";
  if (barterOpportunity && barterOpportunity.available && barterOpportunity.eligible) {
    barterNote = `
Barter Opportunity: This business offers ${barterOpportunity.offering}. If appropriate, mention this subtly and naturally in the opening (e.g., "Since I'm a regular at places like yours..." or "I love supporting local [category] businesses..."). Keep it subtle and conversational - NOT an explicit barter pitch, just a natural connection point.`;
  }

  return `Write a personalized cold email for a UK local business owner.

Business: ${businessName}
Owner: ${ownerFirstName}
Category: ${category}
Location: ${location}
Reviews: ${reviewCount || "Unknown"} (Rating: ${rating || "N/A"})
Competitor mentioned: ${competitorName || "None"}
JTBD Fear: ${jtbdFear || "General business growth"}
Lead Magnet: ${leadMagnet || "None"}
Offer Tier: ${offerTier || "Tier 1"}${barterNote}

Requirements:
- 4-5 sentences max
- Friendly, UK-style tone (not American)
- Reference something specific about their business/location
- Address their JTBD fear
- Low-pressure CTA (coffee meeting or quick call)
- Mention competitor as social proof if provided
- No buzzwords or "hope this email finds you well"

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
  buildEmailPrompt
};
