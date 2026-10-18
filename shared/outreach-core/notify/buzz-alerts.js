/**
 * Mailead webhook events -> Buzz messages (replaces the WhatsApp leg, down since 13 Oct 2026).
 * The VPS receiver still logs every event to /opt/mailead-webhook/events.jsonl and cleans bounces itself;
 * this only formats what it logged. Never shows lastName: it is the per-lead insight carrier, not a surname.
 */
const clean = s => String(s == null ? '' : s).replace(/%%+/g, '%').trim();

function formatEvent(ev) {
  if (!ev || !ev.event_type) return null;
  const email = clean(ev.lead_email_account || ev.email);
  const company = clean(ev.companyName);
  const campaign = clean(ev.campaign_name);
  if (ev.event_type === 'email_answered') {
    const who = [clean(ev.firstName), company && `(${company})`].filter(Boolean).join(' ');
    return [
      `Reply: ${who || email}`,
      `${email}`,
      `${campaign}${ev.step ? `, step ${ev.step}` : ''}`,
      ev.from_email_account ? `Answer from ${clean(ev.from_email_account)} in the Mailead Unibox` : '',
    ].filter(Boolean).join('\n');
  }
  if (ev.event_type === 'email_bounced') {
    return `Bounce: ${email}${company ? ` (${company})` : ''} in ${campaign}. Removed and blocklisted.`;
  }
  return null;
}

function parseNewEvents(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch (e) { /* half-written or junk line: skip */ }
  }
  return out;
}

module.exports = { formatEvent, parseNewEvents };
