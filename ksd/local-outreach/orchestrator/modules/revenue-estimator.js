/**
 * Revenue Estimation Module
 * Estimates business revenue using Claude (Anthropic) analysis of multiple signals
 */

const { getCredential } = require("../../../../shared/outreach-core/credentials-loader");
const https = require("https");

const ANTHROPIC_BASE_URL = "api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Estimate revenue using Claude (Anthropic)
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

  const apiKey = getCredential("anthropic", "apiKey");

  const systemPrompt = "You are an expert business analyst specializing in UK SME revenue estimation. Provide accurate, conservative estimates based on industry benchmarks and business signals. Respond ONLY with valid JSON - no explanations, no markdown.";

  const userPrompt = `Estimate UK company revenue based on these signals:

Company: ${name}
Industry: ${category}
Location: ${address}
Employees (Companies House): ${employeeCount || "Unknown"}
Google Reviews: ${reviewCount || 0}
LinkedIn Employees: ${linkedInEmployees || "Unknown"}
Number of locations: ${locationCount}
Website: ${website || "Unknown"}

Provide:
1. Annual revenue (in GBP)
2. Revenue band (£0-100k, £100k-500k, £500k-1M, £1M-5M, £5M+)
3. Confidence level (1-10)
4. Key reasoning

Output as JSON only:
{
  "estimatedRevenue": number,
  "revenueBand": "string",
  "confidence": number,
  "reasoning": "string"
}`;

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      temperature: 0.3,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt
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
            reject(new Error(`Anthropic API error: ${result.error.message}`));
            return;
          }

          // Anthropic response structure: result.content[0].text
          let content = result.content[0].text.trim();

          // Extract JSON from text if Claude added explanations
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            content = jsonMatch[0];
          }

          // Remove markdown code blocks if present
          content = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
          const estimate = JSON.parse(content);

          resolve({
            estimatedRevenue: estimate.estimatedRevenue || 0,
            revenueBand: estimate.revenueBand || "unknown",
            confidence: estimate.confidence || 0,
            reasoning: estimate.reasoning || "",
            method: "claude_multi_signal"
          });
        } catch (error) {
          reject(new Error(`Failed to parse revenue estimate: ${error.message}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`Anthropic API request error: ${error.message}`));
    });
    
    req.write(postData);
    req.end();
  });
}

module.exports = {
  estimateRevenue
};
