/**
 * Revenue Estimation Module
 * Estimates business revenue using Claude (Anthropic) analysis of multiple signals
 */

const { getCredential } = require("../../../../shared/outreach-core/credentials-loader");
const { resolveModel } = require("../../../../shared/outreach-core/llm-models");
const { callAnthropic } = require("../../../../shared/outreach-core/anthropic-call");

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

  const result = await callAnthropic({
    apiKey,
    body: {
      model: resolveModel("mechanical"),
      max_tokens: 500,
      temperature: 0.3,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    },
    timeoutMs: 30000
  });

  let content = result.text.trim();
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      content = jsonMatch[0];
    }
    content = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    const estimate = JSON.parse(content);
    return {
      estimatedRevenue: estimate.estimatedRevenue || 0,
      revenueBand: estimate.revenueBand || "unknown",
      confidence: estimate.confidence || 0,
      reasoning: estimate.reasoning || "",
      method: "claude_multi_signal"
    };
  } catch (error) {
    throw new Error(`Failed to parse revenue estimate: ${error.message}`);
  }
}

module.exports = {
  estimateRevenue
};
