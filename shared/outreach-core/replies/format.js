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
    r.mailbox ? `Went to: ${clean(r.mailbox)}. Answer as that mailbox (Gmail sends as kobi@kobestarr.io; or use the Mailead Unibox).` : null,
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

function formatAutoNote(r) {
  if (!r.colleague) return null;
  return `Auto reply: ${who(r)} ${r.resume ? `back ${r.resume}. ` : ''}Names a colleague: ${clean(r.colleague)} (not contacted).`;
}

function formatUnibox(r) {
  return `Reply with no copy in Gmail: ${who(r)}\n${ctx(r)}\nRead it in the Mailead Unibox${r.mailbox ? ` (${clean(r.mailbox)})` : ''}. I cannot see the text.`;
}

function formatReAlert(r) {
  return `Still unanswered after ${r.hours || 24}h: ${who(r)} (${HEAD[r.label] || r.label})\n${ctx(r)}\nNo reply from you has gone out to ${clean(r.email)} yet. This is the only reminder.`;
}

module.exports = { formatActionable, formatBlocked, formatAutoNote, formatUnibox, formatReAlert };
