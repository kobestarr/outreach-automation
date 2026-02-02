/**
 * GPT-4 Email Generation Module
 * Generates personalized email content using OpenAI GPT-4
 * 
 * FIXED: Subject line parsing, UK tone enforcement, quality prompts
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
          content: `You are an expert cold email copywriter specializing in UK local business outreach.

CRITICAL REQUIREMENTS:
- Use British English spelling (colour, organise, realise, favourite, etc.)
- Use UK phrases: "cheers", "brilliant", "lovely", "proper", "sorted"
- Avoid Americanisms: "dollars", "$", "US", "America", "reach out", "circle back", "touch base"
- Write friendly, helpful, low-pressure emails that feel personal and genuine
- Sound like a local UK business consultant, not a customer or fan.
- Don't express personal satisfaction about their rating (don't say "I'm chuffed" or "I'm thrilled" about their rating)
- Acknowledge their rating as a positive business signal, not personal emotion
- You're reaching out to help them grow, not as a satisfied customer
- Keep emails SHORT: 3-5 sentences maximum (under 100 words)
- NO generic phrases: "hope this email finds you well", "I'm reaching out", "I hope you're well"
- Be specific and reference their actual business/location
- Use their first name naturally in the opening`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 300  // Reduced to keep emails shorter
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
          
          // Validate and clean
          parsed.body = cleanEmailBody(parsed.body);
          
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

  // Build competitor mention
  let competitorNote = "";
  if (competitorName) {
    competitorNote = `
Social Proof: ${competitorName} (a similar business) is already using our service. Mention this naturally if it fits, but don't force it.`;
  }

  return `Write a personalized cold email for a UK local business owner.

BUSINESS DETAILS:
- Business Name: ${businessName}
- Owner First Name: ${businessName} (use this naturally in opening)
- Category: ${category}
- Location: ${location} (reference this specifically)
- Reviews: ${reviewCount || "Unknown"} (Rating: ${rating || "N/A"})
- JTBD Fear: ${jtbdFear || "General business growth"}
- Lead Magnet: ${leadMagnet || "None"}
- Offer Tier: ${offerTier || "Tier 1"}${barterNote}${competitorNote}

STRICT REQUIREMENTS:
- 3-5 sentences MAXIMUM (aim for 60-80 words total)
- Use British English spelling and UK phrases
Reference something SPECIFIC about  or 
- If mentioning their rating, frame it as a positive business signal (e.g., "Your 4.5 rating shows you're doing well"), NOT personal satisfaction (don't say "I'm chuffed" or "I'm thrilled" about their rating)
- You're a consultant reaching out to help, not a customer expressing satisfaction
- Address their JTBD fear: ${jtbdFear || "business growth"}

- When mentioning their rating, frame it as a business observation (e.g., "Your 4.5 rating shows strong customer satisfaction"), NOT personal emotion
- NEVER say things like "I'm chuffed about your rating" or "I'm thrilled with your 4.5 stars" - you're not a customer expressing satisfaction
- You're a consultant acknowledging their success as a business signal, not expressing personal pleasure
- Low-pressure CTA: suggest a "quick chat" or "coffee" - NO hard sell
- Use ${ownerFirstName}'s name naturally in the opening
- NO generic phrases: "hope this email finds you well", "I'm reaching out", "I hope you're well"
- NO Americanisms: "dollars", "$", "reach out", "circle back"

OUTPUT FORMAT (CRITICAL - follow exactly):
Subject: [one short line, under 60 characters, no quotes]
Body: [3-5 sentences, UK tone, under 100 words total]


Example of GOOD rating mention: "Your 4.5 rating shows you're doing well" or "I noticed your strong 4.5 rating"
Example of BAD rating mention: "I'm chuffed about your 4.5 rating" or "I'm thrilled with your brilliant rating"

Example format:
Subject: Quick question about ${businessName}
Body: Hi ${ownerFirstName},

I noticed ${businessName} in ${location} and was impressed by your ${rating || "excellent"} rating.

[Rest of email...]

Cheers,
[Your Name]`;
}

/**
 * Parse email content from GPT response - FIXED VERSION
 * Properly handles subject/body separation and removes subject from body
 */
function parseEmailContent(content) {
  // Remove any markdown code blocks
  let cleaned = content.replace(/```[\s\S]*?```/g, '').trim();
  
  const lines = cleaned.split("\n");
  let subject = "";
  let body = "";
  let foundSubject = false;
  let inBody = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lowerLine = line.toLowerCase();
    
    // Look for subject line
    if (lowerLine.startsWith("subject:")) {
      if (!foundSubject) {
        subject = line.replace(/^subject:\s*/i, "").trim();
        // Remove quotes if present
        subject = subject.replace(/^["']|["']$/g, "");
        foundSubject = true;
      }
      // Skip this line completely - don't add to body
      continue;
    }
    
    // Look for body marker
    if (lowerLine.startsWith("body:")) {
      inBody = true;
      const bodyStart = line.replace(/^body:\s*/i, "").trim();
      if (bodyStart && !bodyStart.toLowerCase().startsWith("subject:")) {
        body += bodyStart;
      }
      continue;
    }
    
    // If we're in body section, add line (but skip subject lines)
    if (inBody) {
      // Skip any lines that look like subject lines
      if (!lowerLine.startsWith("subject:")) {
        if (body) body += "\n";
        body += line;
      }
    } else if (!foundSubject && line.length > 0) {
      // If we haven't found subject yet and this looks like it might be subject
      // (short line, no colon, or first non-empty line)
      if (i === 0 || (line.length < 80 && !line.includes(":"))) {
        subject = line.replace(/^["']|["']$/g, "");
        foundSubject = true;
        continue;
      }
    }
  }
  
  // Clean up body - remove any remaining subject markers
  if (body) {
    body = body
      .split("\n")
      .filter(line => {
        const lower = line.toLowerCase().trim();
        return !lower.startsWith("subject:") && lower !== "subject:";
      })
      .join("\n")
      .trim();
    
    // Remove any duplicate subject lines that might be in body
    if (subject) {
      const subjectPattern = new RegExp(`^${subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
      body = body.split("\n")
        .filter(line => !subjectPattern.test(line.trim()))
        .join("\n")
        .trim();
    }
  }
  
  // Fallback: if no clear subject/body separation, try to infer
  if (!subject && !body) {
    const parts = cleaned.split("\n\n");
    if (parts.length >= 2) {
      subject = parts[0].replace(/^subject:\s*/i, "").trim().replace(/^["']|["']$/g, "");
      body = parts.slice(1).join("\n\n").trim();
    } else {
      // Last resort: use first line as subject, rest as body
      const firstLineBreak = cleaned.indexOf("\n");
      if (firstLineBreak > 0) {
        subject = cleaned.substring(0, firstLineBreak).trim().replace(/^["']|["']$/g, "");
        body = cleaned.substring(firstLineBreak + 1).trim();
      } else {
        body = cleaned;
      }
    }
  }
  
  // Final cleanup
  subject = (subject || "Quick question about your business").trim();
  body = (body || cleaned).trim();
  
  // Remove any leading/trailing quotes
  subject = subject.replace(/^["']|["']$/g, "");
  
  return {
    subject: subject,
    body: body
  };
}

/**
 * Clean email body - remove common issues
 */
function cleanEmailBody(body) {
  if (!body) return "";
  
  // Remove any subject lines that might have leaked in
  body = body.split("\n")
    .filter(line => {
      const lower = line.toLowerCase().trim();
      return !lower.startsWith("subject:") && lower !== "subject:";
    })
    .join("\n");
  
  // Remove excessive blank lines
  body = body.replace(/\n{3,}/g, "\n\n");
  
  // Remove leading/trailing whitespace
  body = body.trim();
  
  return body;
}

/**
 * Generate email sequence (4 variations) - IMPROVED PROMPTS
 */
async function generateEmailSequence(businessData, sequenceConfig = {}) {
  const emails = [];
  const { businessName, ownerFirstName, category, location, jtbdFear } = businessData;
  
  // Email 1: Initial outreach
  emails.push(await generateEmailContent({
    ...businessData,
    customPrompt: sequenceConfig.email1Prompt || undefined
  }));
  
  // Email 2: Follow-up (gentle reminder with value)
  emails.push(await generateEmailContent({
    ...businessData,
    customPrompt: sequenceConfig.email2Prompt || `Write a BRIEF follow-up email (Email 2 of 4) for ${businessName} owner ${ownerFirstName}.

This is a gentle follow-up - NO generic phrases like "hope this email finds you well" or "I'm reaching out".
Keep it under 80 words. Reference something specific from their business or offer a quick tip.
UK tone, friendly, low-pressure. Use ${ownerFirstName}'s name naturally.

OUTPUT FORMAT:
Subject: [short subject, under 60 chars]
Body: [brief email, 3-4 sentences max]`
  }));
  
  // Email 3: Case study/value prop (still low-pressure)
  emails.push(await generateEmailContent({
    ...businessData,
    customPrompt: sequenceConfig.email3Prompt || `Write a BRIEF follow-up email (Email 3 of 4) for ${businessName} owner ${ownerFirstName}.

Share a quick, specific example of how you've helped similar ${category} businesses in ${location}.
Keep it under 80 words. Still low-pressure - just showing what's possible.
UK tone, friendly. NO generic phrases.

OUTPUT FORMAT:
Subject: [short subject, under 60 chars]
Body: [brief email, 3-4 sentences max]`
  }));
  
  // Email 4: Final touch (respectful last attempt)
  emails.push(await generateEmailContent({
    ...businessData,
    customPrompt: sequenceConfig.email4Prompt || `Write a FINAL follow-up email (Email 4 of 4) for ${businessName} owner ${ownerFirstName}.

This is the last email - make it clear but still respectful. Keep it under 80 words.
Offer one final value or make it easy for them to say no.
UK tone, friendly, professional. NO generic phrases.

OUTPUT FORMAT:
Subject: [short subject, under 60 chars]
Body: [brief email, 3-4 sentences max]`
  }));
  
  return emails;
}

module.exports = {
  generateEmailContent,
  generateEmailSequence,
  buildEmailPrompt,
  parseEmailContent,
  cleanEmailBody
};
