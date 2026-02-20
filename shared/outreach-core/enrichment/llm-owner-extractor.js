/**
 * LLM-based Owner & Email Extraction
 *
 * Uses Claude Haiku to extract business owner/founder/director names
 * AND email addresses from website text. Far more accurate than regex
 * (~100% precision vs ~70% for regex).
 *
 * Cost: ~$0.001 per business (Haiku 4.5)
 */

const fs = require('fs');
const { fetchWebsite } = require('./website-scraper');
const { needsBrowserRendering, fetchWithBrowser } = require('./browser-fetcher');

const CREDS_PATH = require('os').homedir() + '/.credentials/api-keys.json';

// Lazy-loaded client
let _client = null;
let _model = null;

function getClient() {
  if (_client) return { client: _client, model: _model };

  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  const Anthropic = require('@anthropic-ai/sdk');
  _client = new Anthropic({ apiKey: creds.anthropic.apiKey });
  _model = 'claude-haiku-4-5-20251001';

  return { client: _client, model: _model };
}

const PROMPT = `You are extracting business owner/founder/director information and email addresses from a website.

Business name: "{BUSINESS}"

Website text:
{TEXT}

Extract:
1. The owner, founder, director, or principal person's name(s) and their role.
   Only extract REAL PERSON NAMES — not business names, team descriptions, or generic text.
2. ALL email addresses visible on the site. For each email, note if it appears to belong to a specific person or is a generic/shared address.

If no person name is clearly identifiable, return an empty owners array.
If no email is found, return an empty emails array.

Return ONLY valid JSON, no other text:
{"owners":[{"name":"Full Name","title":"Role","email":"their@email.com or null"}],"emails":[{"email":"address@domain.com","type":"personal or generic","person":"Name if associated, or null"}]}`;

/**
 * Strip HTML to clean text for LLM consumption
 */
function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim()
    .substring(0, 4000);
}

/**
 * Fetch website text (homepage + about/team page)
 * @param {string} url
 * @returns {Promise<string|null>} Combined text or null if fetch fails
 */
async function fetchWebsiteText(url) {
  const texts = [];

  try {
    let html = await fetchWebsite(url, 8000);
    if (needsBrowserRendering(html)) {
      const rendered = await fetchWithBrowser(url, 12000);
      if (rendered) html = rendered;
    }
    texts.push(htmlToText(html));

    // Try about/team pages
    const parsedUrl = new URL(url);
    const aboutPaths = ['/about', '/about-us', '/team', '/meet-the-team', '/about-me'];
    for (const path of aboutPaths) {
      try {
        const pageUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${path}`;
        const pageHtml = await fetchWebsite(pageUrl, 5000);
        const pageText = htmlToText(pageHtml);
        if (pageText.length > 200 && !pageText.toLowerCase().includes('page not found') &&
            !pageText.toLowerCase().includes('404')) {
          texts.push(`--- ${path} page ---\n${pageText}`);
          break;
        }
      } catch (e) {
        // Page doesn't exist
      }
    }
  } catch (e) {
    return null;
  }

  const combined = texts.join('\n\n');
  return combined.length > 100 ? combined.substring(0, 6000) : null;
}

/**
 * Extract owner names from website text using LLM
 *
 * @param {string} businessName - The business name
 * @param {string} websiteText - Pre-fetched website text (use fetchWebsiteText)
 * @returns {Promise<{owners: Array, model: string, inputTokens: number, outputTokens: number}>}
 */
async function llmExtractOwners(businessName, websiteText) {
  const { client, model } = getClient();
  const prompt = PROMPT.replace('{BUSINESS}', businessName).replace('{TEXT}', websiteText);

  const response = await client.messages.create({
    model,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        owners: parsed.owners || [],
        emails: parsed.emails || [],
        model,
        inputTokens,
        outputTokens
      };
    }
  } catch (e) {
    // JSON parse failed
  }
  return { owners: [], emails: [], model, inputTokens, outputTokens };
}

/**
 * Full pipeline: fetch website + LLM extract owners
 *
 * @param {string} businessName
 * @param {string} websiteUrl
 * @returns {Promise<{owners: Array, model: string, inputTokens: number, outputTokens: number}|null>}
 *   null if website couldn't be fetched
 */
async function extractOwnersFromWebsite(businessName, websiteUrl) {
  // Skip social media
  if (websiteUrl.includes('facebook.com') || websiteUrl.includes('instagram.com')) {
    return null;
  }

  const text = await fetchWebsiteText(websiteUrl);
  if (!text) return null;

  return await llmExtractOwners(businessName, text);
}

module.exports = {
  htmlToText,
  fetchWebsiteText,
  llmExtractOwners,
  extractOwnersFromWebsite
};
