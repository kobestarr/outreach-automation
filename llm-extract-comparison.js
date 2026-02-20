/**
 * LLM-based Owner Name Extraction — Comparison Script
 *
 * Fetches each business website, sends text to an LLM,
 * and stores results alongside regex extraction for comparison.
 *
 * Usage:
 *   node llm-extract-comparison.js               # Process all missing-owner businesses (OpenAI default)
 *   node llm-extract-comparison.js --limit=20     # Test with first 20
 *   node llm-extract-comparison.js --all          # Process ALL businesses (even those with owners)
 *   node llm-extract-comparison.js --report       # Just show comparison report (no scraping)
 *   node llm-extract-comparison.js --provider=anthropic  # Use Anthropic instead of OpenAI
 *   node llm-extract-comparison.js --model=sonnet # Use Sonnet (Anthropic only)
 */

const Database = require('better-sqlite3');
const { fetchWebsite } = require('./shared/outreach-core/enrichment/website-scraper');
const { needsBrowserRendering, fetchWithBrowser, closeBrowser } = require('./shared/outreach-core/enrichment/browser-fetcher');
const fs = require('fs');

const DB_PATH = './ksd/local-outreach/orchestrator/data/businesses.db';
const CREDS = JSON.parse(fs.readFileSync(require('os').homedir() + '/.credentials/api-keys.json', 'utf8'));
const DELAY_MS = 300; // Between LLM calls

// Parse CLI args
const args = process.argv.slice(2);
const limit = args.find(a => a.startsWith('--limit='))?.split('=')[1];
const processAll = args.includes('--all');
const reportOnly = args.includes('--report');
const useAnthropic = args.includes('--provider=anthropic');
const useSonnet = args.includes('--model=sonnet');

// Provider config
let PROVIDER, MODEL, client;
if (useAnthropic) {
  const Anthropic = require('@anthropic-ai/sdk');
  PROVIDER = 'anthropic';
  MODEL = useSonnet ? 'claude-sonnet-4-5-20250514' : 'claude-haiku-4-5-20251001';
  client = new Anthropic({ apiKey: CREDS.anthropic.apiKey });
} else {
  const OpenAI = require('openai');
  PROVIDER = 'openai';
  MODEL = 'gpt-4o-mini';
  client = new OpenAI({ apiKey: CREDS.openai.apiKey });
}

/**
 * Strip HTML to clean text for LLM consumption
 */
function htmlToText(html) {
  if (!html) return '';
  return html
    // Remove script/style blocks
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Convert common elements to text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    // Remove all remaining HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    // Clean up whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim()
    // Cap at ~4000 chars to keep costs low
    .substring(0, 4000);
}

/**
 * Fetch website text (homepage + about/team page)
 */
async function fetchWebsiteText(url) {
  const texts = [];

  try {
    // Fetch homepage
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
        // Only include if it has substantial content and isn't a 404
        if (pageText.length > 200 && !pageText.toLowerCase().includes('page not found') &&
            !pageText.toLowerCase().includes('404')) {
          texts.push(`--- ${path} page ---\n${pageText}`);
          break; // One about/team page is enough for the LLM
        }
      } catch (e) {
        // Page doesn't exist, continue
      }
    }
  } catch (e) {
    // Main page fetch failed
    return null;
  }

  const combined = texts.join('\n\n');
  return combined.length > 100 ? combined.substring(0, 6000) : null;
}

/**
 * Ask LLM to extract owner names from website text
 */
const PROMPT = `You are extracting business owner/founder/director information from a website.

Business name: "{BUSINESS}"

Website text:
{TEXT}

Extract the owner, founder, director, or principal person's name(s) and their role.
Only extract REAL PERSON NAMES — not business names, team descriptions, or generic text.
If no person name is clearly identifiable, return an empty array.

Return ONLY valid JSON, no other text:
{"owners":[{"name":"Full Name","title":"Role"}]}`;

async function llmExtractOwners(businessName, websiteText) {
  const prompt = PROMPT.replace('{BUSINESS}', businessName).replace('{TEXT}', websiteText);
  let text, inputTokens, outputTokens;

  if (PROVIDER === 'anthropic') {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    });
    text = response.content[0].text.trim();
    inputTokens = response.usage.input_tokens;
    outputTokens = response.usage.output_tokens;
  } else {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    });
    text = response.choices[0].message.content.trim();
    inputTokens = response.usage.prompt_tokens;
    outputTokens = response.usage.completion_tokens;
  }

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        owners: parsed.owners || [],
        model: MODEL,
        provider: PROVIDER,
        inputTokens: inputTokens || 0,
        outputTokens: outputTokens || 0
      };
    }
  } catch (e) {
    // JSON parse failed
  }
  return { owners: [], model: MODEL, provider: PROVIDER, inputTokens: inputTokens || 0, outputTokens: outputTokens || 0 };
}

/**
 * Generate comparison report from stored data
 */
function generateReport(db) {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              REGEX vs LLM EXTRACTION COMPARISON                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const allBiz = db.prepare(`
    SELECT id, name, website, owner_first_name, owner_last_name, business_data
    FROM businesses
    WHERE website IS NOT NULL AND length(website) > 0
    ORDER BY name
  `).all();

  let regexOnly = 0, llmOnly = 0, both = 0, neither = 0;
  let regexTotal = 0, llmTotal = 0;
  let totalInputTokens = 0, totalOutputTokens = 0;
  const llmWins = []; // Cases where LLM found names that regex missed
  const regexWins = []; // Cases where regex found names that LLM missed
  const disagreements = []; // Both found names but different ones

  for (const biz of allBiz) {
    let data = {};
    try { data = biz.business_data ? JSON.parse(biz.business_data) : {}; } catch (e) {}

    const regexName = `${biz.owner_first_name || ''} ${biz.owner_last_name || ''}`.trim();
    const hasRegex = regexName.length > 0;
    const llmResult = data.llmExtraction;
    const hasLlm = llmResult && llmResult.owners && llmResult.owners.length > 0;

    if (hasRegex) regexTotal++;
    if (hasLlm) llmTotal++;

    if (llmResult) {
      totalInputTokens += llmResult.inputTokens || 0;
      totalOutputTokens += llmResult.outputTokens || 0;
    }

    if (hasRegex && hasLlm) {
      both++;
      // Check if names match
      const regexLower = regexName.toLowerCase();
      const llmNames = llmResult.owners.map(o => o.name.toLowerCase());
      if (!llmNames.some(n => n.includes(regexLower) || regexLower.includes(n))) {
        disagreements.push({ name: biz.name, regex: regexName, llm: llmResult.owners.map(o => o.name).join(', ') });
      }
    } else if (hasRegex && !hasLlm) {
      regexOnly++;
      if (llmResult) { // LLM tried but found nothing
        regexWins.push({ name: biz.name, regex: regexName });
      }
    } else if (!hasRegex && hasLlm) {
      llmOnly++;
      llmWins.push({ name: biz.name, llm: llmResult.owners.map(o => `${o.name} (${o.title})`).join(', ') });
    } else {
      if (llmResult) neither++; // Both tried, neither found anything
    }
  }

  const llmProcessed = allBiz.filter(b => {
    try { const d = JSON.parse(b.business_data || '{}'); return d.llmExtraction; } catch { return false; }
  }).length;

  // Cost calculation — detect which providers were used from stored data
  // Use blended rate: weight towards whichever provider processed more
  const inputCostPer1M = PROVIDER === 'openai' ? 0.15 : (useSonnet ? 3.00 : 0.80);
  const outputCostPer1M = PROVIDER === 'openai' ? 0.60 : (useSonnet ? 15.00 : 4.00);
  const inputCost = (totalInputTokens / 1_000_000) * inputCostPer1M;
  const outputCost = (totalOutputTokens / 1_000_000) * outputCostPer1M;

  console.log('OVERALL STATS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Total businesses with websites:  ${allBiz.length}`);
  console.log(`  LLM processed:                   ${llmProcessed}`);
  console.log(`  Regex found owners:              ${regexTotal}`);
  console.log(`  LLM found owners:                ${llmTotal}`);
  console.log();
  console.log('COMPARISON (where both approaches ran)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Both found names:                ${both}`);
  console.log(`  Regex only (LLM missed):         ${regexOnly}`);
  console.log(`  LLM only (regex missed):         ${llmOnly}`);
  console.log(`  Neither found anything:          ${neither}`);
  console.log();
  console.log('COST');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Model:        ${MODEL}`);
  console.log(`  Input tokens:  ${totalInputTokens.toLocaleString()} ($${inputCost.toFixed(3)})`);
  console.log(`  Output tokens: ${totalOutputTokens.toLocaleString()} ($${outputCost.toFixed(3)})`);
  console.log(`  Total cost:    $${(inputCost + outputCost).toFixed(3)}`);

  if (llmWins.length > 0) {
    console.log(`\n\n=== LLM WINS (${llmWins.length} — found names that regex missed) ===\n`);
    for (const w of llmWins.slice(0, 30)) {
      console.log(`  ${w.name.substring(0, 40).padEnd(40)}  → ${w.llm}`);
    }
    if (llmWins.length > 30) console.log(`  ... and ${llmWins.length - 30} more`);
  }

  if (regexWins.length > 0) {
    console.log(`\n\n=== REGEX WINS (${regexWins.length} — found names that LLM missed) ===\n`);
    for (const w of regexWins.slice(0, 20)) {
      console.log(`  ${w.name.substring(0, 40).padEnd(40)}  → ${w.regex}`);
    }
    if (regexWins.length > 20) console.log(`  ... and ${regexWins.length - 20} more`);
  }

  if (disagreements.length > 0) {
    console.log(`\n\n=== DISAGREEMENTS (${disagreements.length} — both found different names) ===\n`);
    for (const d of disagreements.slice(0, 20)) {
      console.log(`  ${d.name.substring(0, 35).padEnd(35)}  Regex: ${d.regex.padEnd(25)}  LLM: ${d.llm}`);
    }
  }
}

async function main() {
  const db = new Database(DB_PATH);

  if (reportOnly) {
    generateReport(db);
    db.close();
    return;
  }

  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log(`║     LLM OWNER EXTRACTION (${MODEL.substring(0, 20).padEnd(20)})          ║`);
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get businesses to process
  const whereClause = processAll
    ? 'WHERE website IS NOT NULL AND length(website) > 0'
    : 'WHERE (owner_first_name IS NULL OR length(owner_first_name) = 0) AND website IS NOT NULL AND length(website) > 0';

  let query = `
    SELECT id, name, website, owner_first_name, owner_last_name, business_data
    FROM businesses
    ${whereClause}
    ORDER BY name
  `;
  if (limit) query += ` LIMIT ${parseInt(limit)}`;

  const businesses = db.prepare(query).all();

  // Filter out those already LLM-processed (unless --all)
  const toProcess = businesses.filter(b => {
    try {
      const data = b.business_data ? JSON.parse(b.business_data) : {};
      return !data.llmExtraction; // Skip if already has LLM result
    } catch { return true; }
  });

  console.log(`  Businesses to process: ${toProcess.length} (of ${businesses.length} matching)`);
  console.log(`  Provider: ${PROVIDER} / ${MODEL}`);
  const estCost = PROVIDER === 'openai' ? toProcess.length * 0.001 : toProcess.length * 0.005;
  console.log(`  Estimated cost: ~$${estCost.toFixed(2)}\n`);

  let processed = 0, found = 0, errors = 0;
  let totalInputTokens = 0, totalOutputTokens = 0;

  for (const biz of toProcess) {
    const label = biz.name.substring(0, 40).padEnd(40);

    // Skip social media
    if (biz.website.includes('facebook.com') || biz.website.includes('instagram.com')) {
      console.log(`  SKIP  ${label}  (social media)`);
      continue;
    }

    try {
      // Fetch website text
      const text = await fetchWebsiteText(biz.website);
      if (!text) {
        console.log(`  NOFETCH  ${label}`);
        continue;
      }

      // LLM extraction
      const result = await llmExtractOwners(biz.name, text);
      processed++;
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;

      // Store result in business_data
      let data = {};
      try { data = biz.business_data ? JSON.parse(biz.business_data) : {}; } catch (e) {}
      data.llmExtraction = result;

      db.prepare('UPDATE businesses SET business_data = ? WHERE id = ?')
        .run(JSON.stringify(data), biz.id);

      if (result.owners.length > 0) {
        found++;
        const names = result.owners.map(o => `${o.name} (${o.title})`).join(', ');
        const regexName = `${biz.owner_first_name || ''} ${biz.owner_last_name || ''}`.trim();
        const comparison = regexName ? `[regex: ${regexName}]` : '[regex: NONE]';
        console.log(`  FOUND ${label}  ${names}  ${comparison}`);
      } else {
        console.log(`  ---   ${label}  no names found`);
      }
    } catch (err) {
      errors++;
      console.log(`  ERR   ${label}  ${err.message.substring(0, 60)}`);
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // Close browser if used
  try { await closeBrowser(); } catch (e) {}

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('LLM EXTRACTION COMPLETE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Processed:     ${processed}`);
  console.log(`  Found owners:  ${found}`);
  console.log(`  Errors:        ${errors}`);
  console.log(`  Input tokens:  ${totalInputTokens.toLocaleString()}`);
  console.log(`  Output tokens: ${totalOutputTokens.toLocaleString()}`);

  const inRate = PROVIDER === 'openai' ? 0.15 : (useSonnet ? 3.00 : 0.80);
  const outRate = PROVIDER === 'openai' ? 0.60 : (useSonnet ? 15.00 : 4.00);
  const inputCost = (totalInputTokens / 1_000_000) * inRate;
  const outputCost = (totalOutputTokens / 1_000_000) * outRate;
  console.log(`  Provider:      ${PROVIDER} / ${MODEL}`);
  console.log(`  Total cost:    $${(inputCost + outputCost).toFixed(3)}`);

  // Now run comparison report
  generateReport(db);

  db.close();
}

main().catch(err => {
  console.error('LLM extraction failed:', err);
  process.exit(1);
});
