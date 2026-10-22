/**
 * Claude Email Generation Module
 * Generates personalized email content using Anthropic Claude
 * with micro-offer system: category-specific angles + observation signals
 *
 * DROP-IN REPLACEMENT for gpt-email-generator.js
 *
 * @module claude-email-generator
 */

const { getCredential } = require("../credentials-loader");
const logger = require("../logger");
const { getCategoryGroup, getCategoryEmailAngles } = require("./category-mapper");
const { computeObservationSignals, selectPrimarySignal, getSignalHook } = require("./observation-signals");
const { getCurrencyForLocation } = require("./currency-localization");
const { generateMultiOwnerEmailBody } = require("./multi-owner-templates");
const { humanizeCompanyName } = require("./company-name-humanizer");
const { getBusinessType } = require("./business-type-helper");
const { resolveModel, stripDashes } = require("../llm-models");
const { callAnthropic } = require("../anthropic-call");

const REQUEST_TIMEOUT_MS = 60000;

// 24-Rule Email System Prompt (Micro-Offer System)
const EMAIL_SYSTEM_PROMPT = `You are a cold email copywriter who writes like a busy business owner reaching out to a peer, not a marketer pitching a stranger.

24 RULES (follow strictly):
1. Write like a busy business owner, not a marketer
2. No buzzwords, jargon, or corporate speak
3. Keep emails under 120 words (allows room for social proof while staying concise)
4. Use lowercase subject lines (feels less sales-y)
5. ALWAYS start with casual greeting: "Hi [Name]," or "Hey [Name],"
6. Reference business name ONLY - never add location/postcode (e.g. "The Cutting Room" not "The Cutting Room in Bramhall, SK7")
7. Use plain language: "help keeping clients" not "help with client retention", "rebooking" not "retention"
8. ALWAYS say "From just £X" NEVER "For just £X" or "for just £X" or "Could X for just £X"
9. One clear CTA per email (micro-offer link or calendar)
10. UK English spelling and tone (not American)
11. No "hope this email finds you well" or similar clichés
12. No exclamation marks (feels desperate)
13. Use short sentences and paragraphs
14. Conversational tone (contractions OK: "I've noticed", "you're")
15. Specific over generic ("22 reviews" not "some reviews")
16. Lead with observation, not self-introduction
17. Reference pain point without stating it explicitly
18. Subtle barter mentions (if applicable) - natural connection, not pitch
19. Social proof via competitor mention (if available)
20. ALWAYS end with "Sent from my iPhone" (no name, no other signature)
21. NEVER use em dashes (—) - use regular hyphens (-) or commas instead
22. NEVER mention case studies, links to articles, or resources that don't exist - offer direct help only
23. SOCIAL PROOF: Where natural, mention working with high-profile clients like Twiggy (the iconic 60s model) for credibility - weave it in casually, not as a boast
24. LOCAL PROXIMITY (CRITICAL): Mention "I'm just down the road in Poynton" for nearby locations (Bramhall, Stockport, Hazel Grove, Cheadle) OR "easy to get to from Poynton" for Manchester/city center - builds trust and shows you're genuinely local`;

/**
 * Generate email content using Claude with micro-offer system
 *
 * @param {Object} params - Business data and configuration
 * @param {string} params.model - Claude model (default: OUTREACH_EMAIL_MODEL, then OUTREACH_COPY_MODEL, then claude-sonnet-5-5)
 * @param {{subject: string, body: string}} params.existingEmail - copy already stored for this record; returned as is with no API call
 * @param {string} params.customPrompt - (DEPRECATED) Custom prompt override - bypasses micro-offer system. Only use for testing.
 * @returns {Promise<Object>} Email with subject, body, fullContent, and metadata
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
    country,
    instagramUrl,
    facebookUrl,
    socialMedia,
    model: requestedModel,
    existingEmail, // already generated and stored: reuse, no call
    customPrompt // DEPRECATED: kept for backward compatibility, bypasses micro-offer system
  } = params;

  if (existingEmail && existingEmail.body) {
    return {
      subject: existingEmail.subject,
      body: existingEmail.body,
      fullContent: existingEmail.fullContent || `Subject: ${existingEmail.subject}\n\n${existingEmail.body}`,
      metadata: { reused: true }
    };
  }

  const model = resolveModel("email", requestedModel);
  const apiKey = getCredential("anthropic", "apiKey");

  // Humanize company name for natural tone
  const { humanized: humanizedBusinessName, original: originalBusinessName } = humanizeCompanyName(businessName);

  // Build prompt with humanized company name
  const paramsWithHumanizedName = {
    ...params,
    businessName: humanizedBusinessName,
    originalBusinessName: originalBusinessName
  };

  // Build prompt (use custom prompt if provided for backward compatibility, otherwise use micro-offer system)
  const prompt = customPrompt || buildEmailPrompt(paramsWithHumanizedName);

  const result = await callAnthropic({
    apiKey,
    body: {
      model,
      max_tokens: Number(process.env.OUTREACH_EMAIL_MAX_TOKENS) || 800,
      temperature: 0.7,
      system: EMAIL_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }]
    },
    timeoutMs: REQUEST_TIMEOUT_MS
  });

  const content = result.text;
  if (!content) {
    logger.error('claude-email-generator', 'Unexpected response structure', { stopReason: result.raw.stop_reason });
    throw new Error("Anthropic API returned unexpected response structure");
  }

  const parsed = parseEmailContent(content);
  const metadata = params._metadata || {};

  let finalBody = parsed.body;
  let multiOwner = false;

  if (params.owners && params.owners.length > 1) {
    finalBody = generateMultiOwnerEmailBody(parsed.body, params.owners);
    multiOwner = true;
    logger.info('claude-email-generator', 'Applied multi-owner template', {
      businessName: params.businessName,
      ownerCount: params.owners.length,
      owners: params.owners.map(o => o.fullName)
    });
  }

  return {
    subject: parsed.subject,
    body: finalBody,
    fullContent: stripDashes(content),
    metadata: {
      primaryHook: metadata.primarySignal || null,
      toneRegion: metadata.country || "UK",
      categoryAngle: metadata.primaryAngle || null,
      categoryGroup: metadata.categoryGroup || null,
      observationSignals: metadata.signals || [],
      microOfferPrice: metadata.microOfferPrice || null,
      fullOfferPrice: metadata.fullOfferPrice || null,
      multiOwner: multiOwner,
      ownerCount: params.owners?.length || 1,
      model: model,
      generatedAt: new Date().toISOString()
    }
  };
}

/**
 * Build email prompt from business data using micro-offer system
 * Computes category angles, observation signals, and currency localization
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
    website,
    country // optional country override
  } = params;

  // 1. Determine category group
  const categoryGroup = getCategoryGroup(category);

  // 2. Compute observation signals
  const signals = computeObservationSignals({
    reviewCount,
    rating,
    website,
    instagramUrl: params.instagramUrl,
    facebookUrl: params.facebookUrl,
    socialMedia: params.socialMedia
  });

  // 3. Select primary signal (most important)
  const primarySignal = selectPrimarySignal(signals);
  const signalHook = primarySignal ? getSignalHook(primarySignal) : "growing your business";

  // 4. Get category angles
  const angles = getCategoryEmailAngles(categoryGroup);

  // 5. Select primary angle (use first angle as default)
  const primaryAngle = angles[0] || "optimizing your customer acquisition";

  // 6. Get currency for location
  const currency = getCurrencyForLocation(location, country);

  // 7. Get business type (plural) for generic language
  const businessType = getBusinessType(category);

  // 8. Store metadata for later (attach to params for access in resolve)
  params._metadata = {
    categoryGroup,
    signals,
    primarySignal,
    primaryAngle,
    businessType,
    country: currency.country,
    microOfferPrice: `${currency.symbol}${currency.microOffer}`,
    fullOfferPrice: `${currency.symbol}${currency.fullOffer}`
  };

  // 9. Build barter mention if available
  let barterNote = "";
  if (barterOpportunity && barterOpportunity.available && barterOpportunity.eligible) {
    barterNote = `

Barter Context: This business offers ${barterOpportunity.offering}. If appropriate, mention this subtly and naturally as a connection point (e.g., "I'm a regular at places like yours" or "I love supporting local ${businessType} like ${businessName}"). Keep it conversational, NOT an explicit barter pitch.`;
  }

  // 10. Build micro-offer prompt
  return `Write a cold email for a UK local business using the micro-offer approach.

Business: ${businessName || "their business"}
Owner: ${ownerFirstName || "the owner"}
Category: ${category} (${categoryGroup})
Business Type (for generic language): ${businessType}
Location: ${location}
Observation: ${primarySignal ? `${primarySignal} - ${signalHook}` : "general opportunity"}
Category Angle: ${primaryAngle}
Reviews: ${reviewCount !== undefined && reviewCount !== null ? reviewCount : "Unknown"} (Rating: ${rating || "N/A"})
Website: ${website || "None listed"}
Competitor (social proof): ${competitorName || "None"}
Micro-Offer Price: ${currency.symbol}${currency.microOffer}
Full Offer Price: ${currency.symbol}${currency.fullOffer}${barterNote}

Requirements:
- Lead with the observation: "${signalHook}"
- Use the category angle as context: "${primaryAngle}"
- Micro-offer CTA: "Just ${currency.symbol}${currency.microOffer} to get started" or similar
- Under 120 words total (allows room for social proof)
- Lowercase subject line (no capital letters except names)
- No buzzwords, jargon, or exclamation marks
- UK English spelling and tone
- Conversational, like one business owner to another
- Reference ${location} or local context
- If competitor provided, use as social proof naturally
- Keep barter mention subtle if included
- CRITICAL: NEVER use em dashes (—) - use regular hyphens (-) or commas instead
- CRITICAL: DO NOT mention case studies, links to articles, or resources - offer direct practical help only (e.g., "I can show you how" not "I have a case study about...")
- SOCIAL PROOF: Where it fits naturally, mention working with high-profile clients like Twiggy (the iconic 60s model) - keep it casual: "I've built sites for everyone from local salons to Twiggy" or similar
- CRITICAL LOCAL PROXIMITY: Include casual mention of being based in Poynton to build local trust:
  * For Bramhall/Stockport/Hazel Grove/Cheadle: "I'm just down the road in Poynton"
  * For Manchester city center: "I'm in Poynton so easy to get to Manchester - 20 min on the train"
  * For other nearby towns (within 30 min): "I'm based in Poynton, just a short drive away"
  * Keep it natural and casual, not forced
- CRITICAL GENERIC LANGUAGE: Use generic language for adaptability:
  * Use "local businesses" or the provided business type (e.g., "${businessType}") instead of specific category
  * Example: "including ${businessType} like ${businessName}" NOT "including dentists like KissDental Bramhall"
  * This allows the email to be reused as a template across similar businesses
  * Keep it natural - don't force the generic language if it sounds awkward

Output format:
Subject: [subject line]
Body: [email body]`;
}

/**
 * Parse email content from Claude response
 */
const MARKER = (name) => new RegExp(`^[\\s>#*_\`]*${name}[\\s*_\`]*:[\\s*_\`]*(.*)$`, "i");
const SUBJECT_LINE = MARKER("subject");
const BODY_LINE = MARKER("body");
const DEFAULT_SUBJECT = "Quick question about your business";

function parseEmailContent(content) {
  const lines = content.split("\n");
  const subjectIdx = lines.findIndex((l) => SUBJECT_LINE.test(l));
  let subject = "";
  let rest;

  if (subjectIdx >= 0) {
    subject = lines[subjectIdx].match(SUBJECT_LINE)[1].replace(/[*_`]+$/, "").trim();
    rest = lines.slice(subjectIdx + 1);
    if (!subject) {
      const next = rest.findIndex((l) => l.trim());
      if (next >= 0 && !BODY_LINE.test(rest[next])) {
        subject = rest[next].replace(/^[\s*_`#>]+|[*_`]+\s*$/g, "").trim();
        rest = rest.slice(next + 1);
      }
    }
  } else {
    const parts = content.trim().split("\n\n");
    subject = (parts[0] || "").trim();
    rest = parts.slice(1).join("\n\n").split("\n");
  }

  const bodyIdx = rest.findIndex((l) => BODY_LINE.test(l));
  let bodyLines;
  if (bodyIdx >= 0) {
    const first = rest[bodyIdx].match(BODY_LINE)[1].trim();
    bodyLines = [...(first ? [first] : []), ...rest.slice(bodyIdx + 1)];
  } else {
    bodyLines = rest;
  }

  const body = stripDashes(bodyLines.join("\n").trim());
  if (!body) throw new Error("Generated email has no body");
  if (/^[\s*_#>`]*subject[\s*_`]*:/i.test(body)) {
    throw new Error("Generated email body starts with a Subject line: refusing to return it");
  }
  return { subject: stripDashes(subject || DEFAULT_SUBJECT), body };
}

/**
 * Generate email sequence (4 variations)
 */
async function generateEmailSequence(businessData, sequenceConfig = {}) {
  const emails = [];

  // Email 1: Initial outreach (uses micro-offer system with observation hook)
  const email1 = await generateEmailContent({
    ...businessData,
    customPrompt: sequenceConfig.email1Prompt || undefined
  });
  email1.delayDays = 0;
  emails.push(email1);

  // Email 2: Follow-up with different angle (3-4 days later)
  const email2Prompt = `Write a follow-up email for ${businessData.businessName} (a ${businessData.category || 'business'}).

CONTEXT: This is Email 2 of 4. They didn't respond to the first email about your original observation.

APPROACH: Use a DIFFERENT angle from the first email. Choose one:
- If first email was about social media → talk about reviews or rebooking
- If first email was about reviews → talk about online booking or automation
- If first email was about rebooking → talk about social proof or visibility

Keep it brief, conversational, and reference that you "sent a note before" or "not sure if you saw my last email" casually.

Follow ALL 24 rules (lowercase subject, under 120 words, observation-based, micro-offer format).

CRITICAL OUTPUT FORMAT:
- Return ONLY the email text
- DO NOT include markdown formatting like **Subject:** or **Body:**
- DO NOT include section headers or labels
- Just write the email naturally as if sending it`;

  const email2 = await generateEmailContent({
    ...businessData,
    customPrompt: email2Prompt
  });
  email2.delayDays = 3;
  emails.push(email2);

  // Email 3: Case study/proof (7 days after Email 1)
  const email3Prompt = `Write a follow-up email for ${businessData.businessName} (a ${businessData.category || 'business'}).

CONTEXT: This is Email 3 of 4. Third touch with no response yet.

APPROACH: Share a brief, specific example:
- A similar ${businessData.category || 'business'} you helped
- Specific results (e.g., "went from 40% rebooking to 68% in 6 weeks")
- What you did that worked
- Keep it casual, not a formal case study

Mention you're local (Poynton) and available for a quick chat.

Follow ALL 24 rules (lowercase subject, under 120 words, specific numbers, micro-offer format).

CRITICAL OUTPUT FORMAT:
- Return ONLY the email text as it would be sent
- DO NOT include markdown formatting like **Subject:** or **Body:**
- DO NOT include section headers, labels, or meta-commentary
- Just write the natural email content`;

  const email3 = await generateEmailContent({
    ...businessData,
    customPrompt: email3Prompt
  });
  email3.delayDays = 7;
  emails.push(email3);

  // Email 4: Final touch (14 days after Email 1)
  const email4Prompt = `Write a final follow-up email for ${businessData.businessName} (a ${businessData.category || 'business'}).

CONTEXT: This is Email 4 of 4. Last attempt - no response yet.

APPROACH: Polite breakup email:
- Acknowledge you've sent a few notes
- Give them an easy out ("no worries if not a priority right now")
- One final clear CTA with calendar link
- Respectful tone - not desperate or annoyed
- Make it clear this is the last contact

Keep it SHORT (under 80 words) and graceful.

Follow ALL 24 rules (lowercase subject, brief, casual tone, micro-offer format).

CRITICAL OUTPUT FORMAT:
- Return ONLY the email text as it would be sent
- DO NOT include markdown formatting like **Subject:** or **Body:**
- DO NOT include section headers, labels, or meta-commentary
- Just write the natural email content`;

  const email4 = await generateEmailContent({
    ...businessData,
    customPrompt: email4Prompt
  });
  email4.delayDays = 14;
  emails.push(email4);

  return emails;
}

module.exports = {
  generateEmailContent,
  generateEmailSequence,
  buildEmailPrompt,
  parseEmailContent,
  // Export for testing/debugging
  EMAIL_SYSTEM_PROMPT
};
