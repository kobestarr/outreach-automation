/**
 * Revenue Estimation Module
 * Estimates business revenue using GPT-4 analysis of multiple signals
 */

const { generateEmailContent } = require("../../../../shared/outreach-core/content-generation/gpt-email-generator");
const { getCredential } = require("../../../../shared/outreach-core/credentials-loader");
const https = require("https");

const OPENAI_BASE_URL = "api.openai.com";

/**
 * Estimate revenue using GPT-4
 */
async function estimateRevenue(business) {
  const {
    name,
    category,
    address,
    employeeCount,
    reviewCount,
    locationCount = 1,
    website,
    linkedInEmployees
  } = business;
  
  const apiKey = getCredential("openai", "apiKey");
  
  const prompt = `You are a business analyst estimating UK company revenue.

Company: ${name}
Industry: ${category}
Location: ${address}
Employees (Companies House): ${employeeCount || "Unknown"}
Google Reviews: ${reviewCount || 0}
LinkedIn Employees: ${linkedInEmployees || "Unknown"}
Number of locations: ${locationCount}
Website: ${website || "Unknown"}

Based on these signals, estimate:
1. Annual revenue (in GBP)
2. Revenue band (£0-100k, £100k-500k, £500k-1M, £1M-5M, £5M+)
3. Confidence level (1-10)
4. Key reasoning

Output as JSON:
{
  "estimatedRevenue": number,
  "revenueBand": "string",
  "confidence": number,
  "reasoning": "string"
}`;
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are an expert business analyst specializing in UK SME revenue estimation. Provide accurate, conservative estimates based on industry benchmarks and business signals."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
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
          
          const estimate = JSON.parse(result.choices[0].message.content);
          
          resolve({
            estimatedRevenue: estimate.estimatedRevenue || 0,
            revenueBand: estimate.revenueBand || "unknown",
            confidence: estimate.confidence || 0,
            reasoning: estimate.reasoning || "",
            method: "gpt_multi_signal"
          });
        } catch (error) {
          reject(new Error(`Failed to parse revenue estimate: ${error.message}`));
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
  estimateRevenue
};
