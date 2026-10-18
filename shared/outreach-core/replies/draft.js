/**
 * Draft Kobi's answer to a warm, maybe or referral reply, in his house style. The draft is a suggestion
 * posted to Buzz: nothing is ever sent from here. The model is injected (Sonnet in production).
 * Never passes lastName to the model: in Mailead it is the per-lead insight carrier, not a surname.
 */
const { ASKS_SOURCE } = require('./classify');

const DRAFTABLE = ['warm', 'maybe', 'referral'];
const BOOKING_TOKEN = '[BOOKING LINK]';

const DATA_SOURCE_LINE = 'You asked how I found you: I used publicly available business details, your company website and public listings, and I only emailed you about your business. If you would rather I did not, tell me and I will remove you straight away.';

const PROOF = [
  'Nigel and Twiggy: long running clients Kobi can point to',
  'Proxymity (Citi backed fintech): a compliance credential, use for regulated or cautious buyers',
  'Entain: Kobi managed £100k a week of Google ads (PPC)',
  'Thallo (blockchain): a client',
  'a local window cleaner whose phone "won\'t stop ringing" since the work',
];

const SYSTEM = `You write email replies as Kobi Omenaka (Kobestarr Digital, a UK marketing consultant), answering someone who replied to his cold email.
House style, strictly:
- Start "Hi <first name>," and end with just "Kobi".
- Short: under 110 words. Plain English, warm, human. No jargon, no hype.
- No dashes of any kind: no em dash, no en dash, no hyphen. Use commas, full stops or colons. Write "Citi backed" not "Citi-backed".
- One specific observation about THEM or their business, taken from their reply or company. Do not invent facts about them.
- Exactly one real proof point, chosen to fit the person, from this list only (invent nothing):
${PROOF.map(p => `  * ${p}`).join('\n')}
- A soft call to action with the booking link written exactly as ${BOOKING_TOKEN}.
- Answer what they actually asked. If they asked a price, give no number: say it depends on what is worth doing and offer a short call.
- If they asked how we got their details, answer it honestly (public business details) and offer to remove them.
Return only the email body text.`;

const LABEL_NOTES = {
  warm: 'They want to see what was offered. Say it is coming (or attach nothing: just promise it for today) and suggest a quick call.',
  maybe: 'They are unsure, sceptical or asking a question. Answer it directly, lower the stakes, soft CTA.',
  referral: 'They pointed us to someone else (or copied a colleague). Thank them briefly and write so the new person can read it too.',
};

// Remove every kind of dash. Emails and links are protected; hyphens between letters become a space.
function cleanDraft(text) {
  const protectedBits = [];
  let t = String(text).replace(/(?:https?:\/\/\S+|\S+@\S+)/g, m => { protectedBits.push(m); return `\u0000${protectedBits.length - 1}\u0000`; });
  t = t.replace(/\s*[–—]\s*/g, ', ')
    .replace(/(\s)-+(\s)/g, ',$2')
    .replace(/(?<=[A-Za-z])-(?=[A-Za-z])/g, ' ')
    .replace(/-/g, ' ')
    .replace(/ {2,}/g, ' ').replace(/ ,/g, ',').replace(/,,/g, ',');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => protectedBits[+i]).trim();
}

async function draftReply({ reply, lead = {}, label }, { llm, config = {} } = {}) {
  if (!DRAFTABLE.includes(label)) throw new Error(`draftReply refuses label "${label}"`);
  const asksDataSource = ASKS_SOURCE.test(String(reply.body || ''));
  const user = [
    `Label: ${label}. ${LABEL_NOTES[label]}`,
    `Their first name: ${lead.firstName || '(unknown)'}`,
    `Their company: ${lead.company || '(unknown)'}`,
    lead.website ? `Website: ${lead.website}` : '',
    `Campaign: ${lead.campaign || '(unknown)'} (brand ${lead.brand || 'unknown'})`,
    asksDataSource ? 'They asked how we got their details: answer that.' : '',
    '',
    `Their reply (subject: ${reply.subject || ''}):`,
    String(reply.body || '').slice(0, 2500),
  ].filter(l => l !== '').join('\n');

  let raw;
  try { raw = await llm({ system: SYSTEM, user }); } catch (e) { return { text: '', error: e.message, asksDataSource }; }

  let paras = cleanDraft(raw).split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (asksDataSource && !paras.some(p => /remove you|take you off|remove you/i.test(p) && /found|source|publicly|listing|from/i.test(p))) {
    const line = lead.source ? DATA_SOURCE_LINE.replace('publicly available business details, your company website and public listings', `${lead.source}`) : DATA_SOURCE_LINE;
    paras.splice(Math.min(2, Math.max(1, paras.length - 1)), 0, cleanDraft(line));
  }
  let text = paras.join('\n\n');
  if (!text.includes(BOOKING_TOKEN)) {
    const at = text.lastIndexOf('\n\n');
    const cta = `If it helps, you can pick a time here: ${BOOKING_TOKEN}`;
    text = at > 0 ? `${text.slice(0, at)}\n\n${cta}${text.slice(at)}` : `${text}\n\n${cta}`;
  }
  if (config.bookingUrl) text = text.split(BOOKING_TOKEN).join(config.bookingUrl);
  return { text, asksDataSource };
}

module.exports = { draftReply, cleanDraft, DATA_SOURCE_LINE, BOOKING_TOKEN, DRAFTABLE };
