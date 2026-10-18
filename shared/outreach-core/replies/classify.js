/**
 * Reply classifier: rules first (cheap, predictable), the model only for what rules cannot decide.
 * Labels: warm | maybe | referral | no | auto | left_company
 *   warm          wants to see / hear / buy something
 *   maybe         question, price, sceptical, not now: a human should read it, NEVER blocked
 *   referral      points us at someone else
 *   no            firm no, remove me, retired: blocked everywhere
 *   auto          out of office, ticket system, canned responder
 *   left_company  person no longer there: blocked everywhere
 * Safe direction: when unsure the answer is "maybe", which alerts Kobi and blocks nothing.
 * Never reads or shows lastName (it is the per-lead insight carrier in Mailead, not a surname).
 */
const LABELS = ['warm', 'maybe', 'referral', 'no', 'auto', 'left_company'];

const MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Return date from an out-of-office text, ISO yyyy-mm-dd, or null. Missing year = next occurrence after now.
function parseResumeDate(text, now = new Date()) {
  const t = String(text || '');
  const lead = '(?:until|till|back(?:\\s+(?:on|in the office on|at work on))?|return(?:ing|s)?(?:\\s+on)?|from|on)\\s+(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?,?\\s+)?';
  const resolve = (d, mi, y) => {
    if (y) return iso(y, mi, d);
    let yr = now.getUTCFullYear();
    if (Date.UTC(yr, mi, d) < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) yr += 1;
    return iso(yr, mi, d);
  };
  let m = t.match(new RegExp(`${lead}(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON}\\b,?(?:\\s+(\\d{4}))?`, 'i'));
  if (m) return resolve(+m[1], MONTHS[m[2].toLowerCase()], m[3] && +m[3]);
  m = t.match(new RegExp(`${lead}${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'i'));
  if (m) return resolve(+m[2], MONTHS[m[1].toLowerCase()], m[3] && +m[3]);
  m = t.match(new RegExp(`${lead}(\\d{1,2})[/.](\\d{1,2})[/.](\\d{4})`, 'i'));
  if (m) return iso(+m[3], +m[2] - 1, +m[1]); // UK day/month/year
  return null;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const emailsIn = (text, exclude = []) => (String(text || '').match(EMAIL_RE) || [])
  .map(e => e.toLowerCase().replace(/[.,;:)]+$/, '')).filter(e => !exclude.includes(e));

// What a reply looks like when the person actually wants something. Guards every "negative" rule.
const POSITIVE = [
  /\bplease (?:feel free to )?send (?:me |us )?(?:over|it|that|this|the|your|a (?=[a-z])|through|across|\d)/i, /\bsend (?:it |that |this |the |your |us |me )?(?:over|through|across)\b/i,
  /\bgo ahead\b/i, /\bkeen to\b/i, /\b(?:like|love|want|happy) to (?:see|hear|watch|know|chat|talk|learn)\b/i,
  /\blet(?:'|’)?s (?:see|talk|chat|have a)\b/i, /\blet see\b/i, /\binterested in (?:seeing|hearing|learning|your)\b/i,
  /\btell me more\b/i, /\bcurious\b/i, /\brecord the video\b/i, /\bhow much\b/i, /\bwhat (?:are|is) the (?:package )?(?:price|cost)/i, /\bprices?\b/i,
];
const hasPositive = s => POSITIVE.some(r => r.test(s));
const ASKS_SOURCE = /how did you (?:get|find|obtain)|where did you (?:get|find)|got my (?:details|email|address|data)|my (?:details|data)\b.*\b(?:from|get)\b/i;

// ---- auto-reply rules ----
const AUTO_SUBJECT = [
  /automatic (?:reply|response)|auto[- ]?(?:reply|response|respond)|automated (?:reply|response|message)|^\s*auto\s*:/i,
  /out[- ]of[- ](?:the[- ])?office|\booo\b|away from (?:my |the )?(?:desk|office)/i,
  /\b(?:annual|maternity|paternity|medical|sick|parental|study) leave\b|\bmat leave\b|\bon (?:leave|holiday|vacation|sabbatical)\b|\bholiday\b|\bvacation\b|\bafk\b/i,
  /delayed repl|slow to respond|slightly delayed|delayed response|limited access to email/i,
  /thank(?:s| you) for (?:contacting|your (?:note|message|email|enquiry|inquiry|interest))|thanks for (?:getting in touch|reaching out)/i,
  /request (?:received|created|logged)|ticket (?:received|created|opened)|your (?:request|ticket|enquiry|inquiry|case) (?:has been|was)|enquiry reference|case (?:number|#)|ticket\s*#|\[#\d+\]/i,
  // other languages
  /automatische antwort|automatisch antwoord|abwesenheit|afwezig|r[ée]ponse automatique|absence du bureau|demande (?:bien )?re[cç]ue|respuesta autom[aá]tica|solicitud (?:recibida|ha sido creada|creada)|fuera de la oficina|risposta automatica|fuori ufficio|resposta autom[aá]tica|autosvar|automatiskt svar|fraværsmelding|automatisch/i,
];
const AUTO_BODY = [
  /this is an automa(?:ted|tic)|automatically generated|auto[- ]?(?:reply|response)|do not reply to this/i,
  /(?:i am|i'm|we are|we're) (?:currently )?(?:out of (?:the )?office|away from)/i,
  /(?:will|'ll) (?:respond|reply|get back to you|be in touch)(?: to you)? (?:within|as soon as|when i return|on my return)/i,
  /(?:receive|get) a response within/i,
  /thank you for emailing .{0,80}(?:address|inbox|mailbox|team)/i,
  /your (?:request|enquiry|inquiry|message) (?:has been|was) (?:received|logged|created)/i,
];
// Subject is "<custom text> Re: <our subject>": an auto-responder prepended its own words. A human reply starts with Re:.
function midReply(subject) {
  const m = String(subject || '').match(/^(.*?)\b(?:re|aw|sv|rv)\s*:\s/i);
  if (!m) return false;
  const prefix = m[1].replace(/\[[^\]]*\]/g, '').trim();
  return prefix.length > 0 && !/^(?:re|fw|fwd|aw|sv|vs|rv)\s*:?$/i.test(prefix);
}

// ---- other rules ----
const LEFT = [
  /\bno longer (?:with|at|works? (?:at|for|with)|employed|part of|working)\b/i,
  /\b(?:has|have)\s+(?:now\s+)?left (?:the )?(?:company|organi[sz]ation|business|firm|us)\b/i, /\bleft the (?:company|organi[sz]ation|business|firm)\b/i,
  /\bmoved on from\b/i, /\bhas departed\b/i,
];
const LEFT_SUBJECT = /\bexit\b|\bdeparture\b/i;
const MAILBOX_DEAD = /(?:mailbox|address|account|inbox) (?:is |has been )?(?:no longer (?:in use|monitored|checked|active|valid)|(?:closed|deactivated|disabled))/i;
const RETIRED = /\b(?:i am|i'm|i have|i've|have|has|now|am)\s+(?:now\s+)?retired\b|\bretired\b.*\bno longer\b/i;
const NO_FIRM = [
  /\b(?:take|remove|delete|strike) (?:us|me|my (?:name|email|details|address)) (?:off|from|out)\b/i, /\bremove (?:us|me)\b/i, /\bunsubscribe\b/i,
  /\bstop (?:emailing|contacting|sending|messaging)\b/i, /\bdo(?: not|n'?t) (?:contact|email|message) (?:me|us)\b/i, /\bopt(?: me| us)? out\b/i, /\bremoved? (?:me|us) from\b/i,
];
const NO_SOFT = [/\bnot interested\b/i, /\bno,? thanks?\b/i, /\bno thank you\b/i];
const NOT_NOW = /\b(?:right now|at the moment|at present|currently|for now|this time|in the future|next year|later|at this stage|for the time being)\b/i;

// Short, clear "yes, send it" replies. Anything with a question, price or doubt is left to the model.
const WARM_DOUBT = /\?|don'?t understand|not sure|who are you|not for me|too (?:busy|expensive)|how much|prices?|budget|cost/i;
const WARM_ONEWORD = /^(?:audit|yes|yes please|sure|go ahead|ok|okay|please do|please)[.!\s]*$/i;
const WARM_RULES = [
  /\bplease (?:feel free to )?send (?:me |us )?(?:over|it|that|this|the|your|a (?=[a-z])|through|across|\d)/i, /\bsend (?:it |that |this |the |your |us |me )?(?:over|video|the video|proposal|audit|details|info)/i, /\bgo ahead (?:and )?send\b/i,
  /\b(?:like|love|want) to (?:see|hear|watch)\b/i, /\blet(?:'|’)?s see (?:your|the)\b|\blet see your\b/i, /\bkeen to hear more\b/i, /\binterested in (?:seeing|hearing)\b/i,
  /\bpass on the (?:audit|video|details|info)\b/i,
];

const stripNoise = body => String(body || '')
  .replace(/^>.*$/gm, '').replace(/\n\s*(?:sent from my .*|get outlook for .*)\s*$/i, '').trim();

function classifyDeterministic(reply, now = new Date()) {
  const subject = String(reply.subject || '');
  const body = stripNoise(reply.body);
  const both = `${subject}\n${body}`;
  const positive = hasPositive(both);

  // 1. machine headers are the most reliable signal
  const hdr = `${reply.auto_submitted || ''}`.toLowerCase();
  const headerAuto = /auto-(?:replied|generated|notified)/.test(hdr) || /auto_reply|bulk/.test(`${reply.precedence || ''}`.toLowerCase()) || reply.x_autoreply;

  // 2. retired / left company / dead mailbox (these are often sent by robots too, so they come before auto)
  if (!positive) {
    if (RETIRED.test(both)) return decorate({ label: 'no', reason: 'retired' }, both, reply);
    if (LEFT.some(r => r.test(both)) || LEFT_SUBJECT.test(subject) || MAILBOX_DEAD.test(both)) {
      return decorate({ label: 'left_company', reason: 'person no longer there' }, both, reply);
    }
  }
  if (headerAuto) return autoResult('auto-reply header', both, now);

  // 3. out of office, ticket systems, canned responders, in any language
  if (!positive) {
    if (AUTO_SUBJECT.some(r => r.test(subject))) return autoResult('auto-reply subject', both, now);
    if (midReply(subject)) return autoResult('auto-responder prefix before Re:', both, now);
    if (AUTO_BODY.some(r => r.test(body))) return autoResult('auto-reply wording', both, now);
  }

  // 4. firm no (never when they also ask for something, and never for "not now")
  if (!positive) {
    if (NO_FIRM.some(r => r.test(both))) return decorate({ label: 'no', reason: 'asked to be removed' }, both, reply);
    if (NO_SOFT.some(r => r.test(body)) && !NOT_NOW.test(body) && body.length < 400) return decorate({ label: 'no', reason: 'not interested' }, both, reply);
  }

  // 5. short clear yes
  if (!ASKS_SOURCE.test(body) && !WARM_DOUBT.test(body) && !NO_SOFT.some(r => r.test(body))) {
    if (WARM_ONEWORD.test(body) || (body.length < 500 && WARM_RULES.some(r => r.test(body)))) return { label: 'warm', reason: 'asked to see it' };
  }
  return null;
}

function autoResult(reason, text, now) {
  const out = { label: 'auto', reason };
  const resume = parseResumeDate(text, now);
  if (resume) out.resume_date = resume;
  const colleague = emailsIn(text)[0];
  if (colleague) out.colleague_email = colleague;
  return out;
}
function decorate(out, text, reply) {
  const e = emailsIn(text, [String(reply.from || '').toLowerCase()])[0];
  if (e) out.referral_email = e;
  return out;
}

// ---- model layer ----
const SYSTEM = `You label replies to cold emails from Kobi (a UK marketing consultant). Reply with ONE JSON object only.
Labels:
- warm: wants to see, hear or buy what was offered (even rudely, even with a threat, even one word like "Audit").
- maybe: a question, price enquiry, scepticism ("how did you get my details"), a small budget, or "not right now / we are sorting it ourselves". A human must read it. NEVER treat these as no.
- referral: says someone else is the right person, or copies in a colleague.
- no: firm no, remove me, stop emailing, or retired. Only when it is clearly final.
- auto: out of office, ticket system, canned responder, any language. Include resume_date (YYYY-MM-DD) if they say when they are back.
- left_company: this person no longer works there.
If unsure between no and anything else, choose maybe. Add referral_email only if the reply names an email address of another person.
Format: {"label":"...","reason":"short plain English","resume_date":"YYYY-MM-DD or omit","referral_email":"or omit"}`;

function buildPrompt(reply) {
  const body = stripNoise(reply.body).slice(0, 3000);
  return { system: SYSTEM, user: `From: ${reply.from || ''}\nSubject: ${reply.subject || ''}\n${reply.cc ? `Cc: ${[].concat(reply.cc).join(', ')}\n` : ''}\n${body || '(empty body)'}` };
}

function parseModelJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

function fallback(reason) { return { label: 'maybe', reason, fallback: true }; }

async function classifyReply(reply, { llm, now } = {}) {
  const det = classifyDeterministic(reply, now);
  if (det) return det;
  if (!llm) return fallback('no model available, read it yourself');
  let raw;
  try { raw = await llm(buildPrompt(reply)); } catch (e) { return fallback(`classifier unavailable (${e.message}), read it yourself`); }
  const j = parseModelJson(raw);
  if (!j || !LABELS.includes(j.label)) return fallback('classifier gave no usable answer, read it yourself');
  const out = { label: j.label, reason: String(j.reason || '').slice(0, 200) };
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(j.resume_date || ''))) out.resume_date = j.resume_date;
  if (j.referral_email && new RegExp(`^${EMAIL_RE.source}$`).test(String(j.referral_email))) out.referral_email = String(j.referral_email).toLowerCase();
  // Safety net: a reply that asks for something is never auto, no or left_company.
  const text = `${reply.subject || ''}\n${stripNoise(reply.body)}`;
  if (['no', 'auto', 'left_company'].includes(out.label) && hasPositive(text)) {
    return { ...out, label: 'maybe', reason: `model said ${j.label} but the reply asks for something: ${out.reason}` };
  }
  return out;
}

module.exports = { LABELS, classifyDeterministic, classifyReply, parseResumeDate, buildPrompt, hasPositive, ASKS_SOURCE, emailsIn };
