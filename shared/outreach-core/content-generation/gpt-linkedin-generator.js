/**
 * GPT-4 LinkedIn Content Generation Module
 * Generates LinkedIn connection notes and messages
 */

const https = require("https");
const { getCredential } = require("../credentials-loader");

const OPENAI_BASE_URL = "api.openai.com";

/**
 * Generate LinkedIn connection request note
 */
async function generateConnectionNote(params) {
  const {
    ownerFirstName,
    businessName,
    category,
    location,
    linkedInTitle,
    customPrompt
  } = params;
  
  const apiKey = getCredential("openai", "apiKey");
  
  const prompt = customPrompt || `Write a personalized LinkedIn connection request note for a UK local business owner.

Name: ${ownerFirstName}
Business: ${businessName}
Category: ${category}
Location: ${location}
Title: ${linkedInTitle || "Business Owner"}

Requirements:
- 1-2 sentences max
- Friendly, professional
- Reference something specific (their business, location, or title)
- Low-pressure
- UK tone

Output just the connection note text (no labels or formatting):`;
  
  return callGPT4(prompt, apiKey);
}

/**
 * Generate LinkedIn first message
 */
async function generateLinkedInMessage(params) {
  const {
    ownerFirstName,
    businessName,
    category,
    location,
    emailSubject,
    emailBody,
    customPrompt
  } = params;
  
  const apiKey = getCredential("openai", "apiKey");
  
  const prompt = customPrompt || `Write a LinkedIn message for ${ownerFirstName} at ${businessName} in ${location}.

This is a follow-up after they accepted your connection request. Reference the email you sent them (subject: "${emailSubject || "Quick question"}") and offer to share more via LinkedIn if they prefer.

Requirements:
- 2-3 sentences
- Reference the email
- Offer value (case study, resource, etc.)
- Low-pressure CTA
- UK tone

Output just the message text:`;
  
  return callGPT4(prompt, apiKey);
}

/**
 * Call GPT-4 API
 */
function callGPT4(prompt, apiKey) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are an expert at writing professional LinkedIn messages for UK business outreach."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 300
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
    
    req.write(postData);
    req.end();
  });
}

module.exports = {
  generateConnectionNote,
  generateLinkedInMessage
};
