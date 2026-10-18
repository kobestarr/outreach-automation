/**
 * Reply engine core. Given new Gmail records (inbound replies and Kobi's sent mail, from the VPS collector)
 * and new Mailead webhook events, decide what each reply is and act:
 *   no / left_company  -> block everywhere + short Buzz note
 *   auto               -> remember the resume date, stay silent (unless it names a colleague)
 *   warm/maybe/referral-> draft an answer + Buzz alert, then one reminder if unanswered after 24h
 * Webhook replies with no Gmail copy after 15 minutes get a "read it in the Unibox" alert (the Atif case).
 * Every effect is injected (classify, draft, block, post, tracker, now) so tests touch nothing real.
 * Never sends email. Never shows lastName (Mailead insight carrier).
 */
const { isOurMailbox, brandOf, ownMailboxIn, addrOf } = require('./mailboxes');
const fmt = require('./format');

const MIN = 60_000, HOUR = 3_600_000;
const UNIBOX_AFTER = 15 * MIN;
const REALERT_AFTER = 24 * HOUR;
const EVENT_DEDUP = 24 * HOUR;
const ACTIONABLE = ['warm', 'maybe', 'referral'];
const IGNORED_SENDERS = /^(?:mailer-daemon|postmaster|noreply|no-reply|donotreply)@|@(?:googlemail|google)\.com$/i;

const emptyState = () => ({ seen: {}, events: {}, pending: {}, gmailLeads: {}, blocked: {}, resume: {}, awaiting: {}, sent: {} });

function normaliseState(s) {
  const base = emptyState();
  for (const k of Object.keys(base)) if (!s[k]) s[k] = base[k];
  return s;
}

// The lead on a Mailead event: whichever of the two address fields is not one of our own mailboxes.
function leadOf(ev) {
  for (const c of [ev.lead_email_account, ev.email, ev.from_email_account]) {
    const a = addrOf(c);
    if (a && !isOurMailbox(a) && a.includes('@')) return a;
  }
  return null;
}
const eventMailbox = ev => [ev.from_email_account, ev.lead_email_account].map(addrOf).find(isOurMailbox) || null;
const eventKey = ev => [leadOf(ev), ev.campaign_name || '', ev.step || ''].join('|');
const eventTime = (ev, fallback) => { const t = Date.parse(ev.receivedAt || ev.timestamp || ''); return Number.isFinite(t) ? t : fallback; };

const firstNameFrom = (rec) => {
  if (rec.firstName) return rec.firstName;
  const n = String(rec.from_name || '').trim().split(/\s+/)[0];
  if (n && !n.includes('@')) return n;
  const local = String(rec.from || '').split('@')[0].split(/[._-]/)[0];
  return local ? local[0].toUpperCase() + local.slice(1) : '';
};

async function processNew({ replies = [], events = [], state }, deps) {
  normaliseState(state);
  const now = deps.now();
  const nowMs = now.getTime();
  const out = { actions: [], errors: [] };
  const act = (a) => out.actions.push(a);
  const safeTrack = async (e) => {
    if (!deps.tracker || !deps.tracker.trackReply) return;
    try { await deps.tracker.trackReply(e); } catch (err) { out.errors.push({ where: 'tracker', email: e.email, message: err.message }); }
  };

  // 1. Kobi's sent replies: remember the latest per recipient
  for (const r of replies.filter(x => x.kind === 'sent')) {
    for (const to of [].concat(r.to || [])) {
      const a = addrOf(to);
      const t = Date.parse(r.date);
      if (a && Number.isFinite(t) && t > (state.sent[a] || 0)) state.sent[a] = t;
    }
  }

  // 2. new webhook replies go to the pending pool (duplicates inside 24h are ignored)
  for (const ev of events) {
    if (!ev || ev.event_type !== 'email_answered') continue;
    const lead = leadOf(ev);
    if (!lead) continue;
    const key = eventKey(ev);
    if (state.events[key] && nowMs - state.events[key] < EVENT_DEDUP) continue;
    state.events[key] = nowMs;
    state.pending[key] = { ev, at: eventTime(ev, nowMs) };
  }

  // 3. Gmail replies: classify and act, taking any matching webhook event along
  const inbound = replies.filter(x => x.kind !== 'sent');
  for (const rec of inbound) {
    const from = addrOf(rec.from);
    if (!rec.msgid || state.seen[rec.msgid]) continue;
    if (!from || isOurMailbox(from) || from === 'kobi@kobestarr.io' || IGNORED_SENDERS.test(from)) { state.seen[rec.msgid] = nowMs; continue; }
    try {
      const matched = Object.entries(state.pending).filter(([, p]) => leadOf(p.ev) === from);
      const ev = matched.length ? matched[0][1].ev : null;
      await handleReply({ rec, from, ev });
      for (const [k] of matched) { delete state.pending[k]; }
      state.seen[rec.msgid] = nowMs;
      state.gmailLeads[from] = Date.parse(rec.date) || nowMs;
    } catch (e) {
      out.errors.push({ where: 'reply', email: from, message: e.message });
    }
  }

  // 4. pending webhook replies: consumed by a recent Gmail copy, or alerted after 15 minutes
  for (const [key, p] of Object.entries(state.pending)) {
    const lead = leadOf(p.ev);
    const g = state.gmailLeads[lead];
    if (g && Math.abs(p.at - g) < 6 * HOUR) { delete state.pending[key]; continue; }
    if (nowMs - p.at < UNIBOX_AFTER) continue;
    const base = { email: lead, firstName: p.ev.firstName, company: p.ev.companyName, campaign: p.ev.campaign_name, step: p.ev.step, mailbox: eventMailbox(p.ev) };
    try {
      await deps.post(fmt.formatUnibox(base));
      act({ type: 'unibox', label: 'unread', email: lead });
      await safeTrack({ email: lead, firstName: base.firstName || '', company: base.company || '', brand: brandOf(base.mailbox), campaign: base.campaign || '', label: 'unread', text: '', mailbox: base.mailbox, date: new Date(p.at).toISOString() });
      delete state.pending[key];
    } catch (e) { out.errors.push({ where: 'unibox', email: lead, message: e.message }); }
  }

  // 5. one reminder for warm/maybe/referral that Kobi has not answered within 24h
  for (const [email, a] of Object.entries(state.awaiting)) {
    if ((state.sent[email] || 0) >= a.ts) { delete state.awaiting[email]; continue; }
    if (a.reAlerted || nowMs - a.ts < REALERT_AFTER) continue;
    try {
      await deps.post(fmt.formatReAlert({ ...a, email, hours: Math.floor((nowMs - a.ts) / HOUR) }));
      a.reAlerted = true;
      act({ type: 'realert', label: a.label, email });
    } catch (e) { out.errors.push({ where: 'realert', email, message: e.message }); }
  }

  return out;

  async function handleReply({ rec, from, ev }) {
    const lead = {
      email: from,
      firstName: (ev && ev.firstName) || firstNameFrom({ ...rec, from }),
      company: (ev && ev.companyName) || '',
      campaign: (ev && ev.campaign_name) || '',
      step: ev && ev.step,
      mailbox: (ev && eventMailbox(ev)) || ownMailboxIn(rec.to) || ownMailboxIn(rec.cc) || null,
    };
    lead.brand = brandOf(lead.mailbox);
    const msg = { subject: rec.subject, body: rec.body, from, cc: rec.cc, auto_submitted: rec.auto_submitted, precedence: rec.precedence };
    const c = await deps.classify(msg);
    const label = c.label;
    const dateIso = Number.isFinite(Date.parse(rec.date)) ? new Date(rec.date).toISOString() : now.toISOString();
    const trackerEvt = (extra = {}) => ({ email: from, firstName: lead.firstName || '', company: lead.company, brand: lead.brand, campaign: lead.campaign, label, text: String(rec.body || ''), mailbox: lead.mailbox, date: dateIso, ...extra });
    act({ type: 'classified', label, email: from, reason: c.reason });

    if (label === 'no' || label === 'left_company') {
      let result = { complete: true, skipped: 'already blocked' };
      if (!state.blocked[from]) {
        result = await deps.block(from, c.reason || (label === 'no' ? 'asked to be removed' : 'left the company'), label);
        await deps.post(fmt.formatBlocked({ ...lead, label, reason: c.reason, referral_email: c.referral_email, result }));
        if (result.complete) state.blocked[from] = nowMs; // after the post, so a failed post retries (blocking is idempotent)
      }
      await safeTrack(trackerEvt());
      return;
    }

    if (label === 'auto') {
      if (c.resume_date) state.resume[from] = c.resume_date;
      const note = fmt.formatAutoNote({ ...lead, colleague: c.colleague_email, resume: c.resume_date });
      if (note) await deps.post(note);
      return;
    }

    // warm, maybe, referral
    const d = await deps.draft({ reply: { subject: rec.subject, body: rec.body, from }, lead, label });
    await deps.post(fmt.formatActionable({ ...lead, label, reason: c.reason, text: rec.body, draft: d.text, draftError: d.error }));
    await safeTrack(trackerEvt());
    const replyMs = Date.parse(rec.date) || nowMs;
    if ((state.sent[from] || 0) < replyMs) state.awaiting[from] = { ts: replyMs, label, firstName: lead.firstName, company: lead.company, campaign: lead.campaign, step: lead.step, mailbox: lead.mailbox, reAlerted: false };
  }
}

module.exports = { processNew, emptyState, leadOf };
