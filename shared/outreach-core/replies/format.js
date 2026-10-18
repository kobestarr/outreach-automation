/**
 * Buzz messages for the reply engine. Plain text, short. Never shows lastName (the Mailead insight carrier).
 */
const clean = s => String(s == null ? '' : s).replace(/%%+/g, '%').replace(/[–—]/g, ',').trim();
const trim = (s, n) => { const t = clean(s); return t.length > n ? t.slice(0, n).trimEnd() + '...' : t; };
const who = r => [clean(r.firstName), r.company && `(${clean(r.company)})`].filter(Boolean).join(' ') || clean(r.email);
const ctx = r => `${clean(r.email)}\n${clean(r.campaign) || 'unknown campaign'}${r.step ? `, step ${r.step}` : ''}`;

const HEAD = { warm: 'Warm reply', maybe: 'Maybe, needs your read', referral: 'Referral' };

function formatActionable(r) {
  const lines = [
    `${HEAD[r.label] || r.label}: ${who(r)}`,
    ctx(r),
    r.mailbox ? `Went to: ${clean(r.mailbox)}. Answer in Gmail, reply to the thread.` : null,
    r.reason ? `Why: ${trim(r.reason, 160)}` : null,
    '',
    'They said:',
    `"${trim(r.text, 700)}"`,
    '',
    r.draft ? `Suggested reply (not sent):\n${trim(r.draft, 1200)}` : `No draft (${clean(r.draftError) || 'model unavailable'}). Write this one yourself.`,
  ];
  return lines.filter(l => l !== null).join('\n');
}

function formatBlocked(r) {
  const head = r.label === 'left_company' ? 'Left the company' : 'No';
  const colleague = r.referral_email ? `\nNamed colleague: ${clean(r.referral_email)} (not contacted, your call).` : '';
  if (r.result && r.result.complete) {
    return `${head}: ${who(r)}, ${clean(r.email)}\n${trim(r.reason, 120)}. Blocked everywhere (Mailead, email finder, do not contact list, ledger).${colleague}`;
  }
  const bad = Object.entries(r.result || {}).filter(([k, v]) => typeof v === 'string' && v.startsWith('failed')).map(([k, v]) => `${k} ${v}`).join('; ');
  return `${head}: ${who(r)}, ${clean(r.email)}\nPARTLY blocked, fix by hand: ${bad || 'unknown'}.${colleague}`;
}

function formatAutoDigest(items) {
  const lines = items.map(i => `${who(i)}${i.email && !who(i).includes(i.email) ? ` ${clean(i.email)}` : ''}${i.resume ? `, back ${clean(i.resume)}` : ''}${i.colleague ? `, names ${clean(i.colleague)} (not contacted)` : ''}`);
  return `Auto replies (${items.length}), nothing needed:\n${lines.map(l => `- ${l}`).join('\n')}`;
}

function formatUnibox(r) {
  if (!r.email) {
    return `Reply from ${clean(r.firstName) || 'someone'}${r.company ? ` at ${clean(r.company)}` : ''}, read it in the Mailead Unibox${r.mailbox ? ` (${clean(r.mailbox)})` : ''}.\n${clean(r.campaign) || 'unknown campaign'}${r.step ? `, step ${r.step}` : ''}. Mailead gave no email address, so I cannot see the text.`;
  }
  return `Reply with no copy in Gmail: ${who(r)}\n${ctx(r)}\nRead it in the Mailead Unibox${r.mailbox ? ` (${clean(r.mailbox)})` : ''}. I cannot see the text.`;
}

function formatReAlert(r) {
  return `Still unanswered after ${r.hours || 24}h: ${who(r)} (${HEAD[r.label] || r.label})\n${ctx(r)}\nNo reply from you has gone out to ${clean(r.email)} yet. This is the only reminder. Answered some other way (say the Unibox)? Run: node reply-engine.js --answered ${clean(r.email)}`;
}

module.exports = { formatActionable, formatBlocked, formatAutoDigest, formatUnibox, formatReAlert };
