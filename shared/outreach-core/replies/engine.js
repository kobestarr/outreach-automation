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
const { likelyOptOut, stripBody } = require('./classify');

const MIN = 60_000, HOUR = 3_600_000;
const UNIBOX_AFTER = 15 * MIN;
const REALERT_AFTER = 24 * HOUR;
const EVENT_DEDUP = 24 * HOUR;
const CLASSIFIER_ALERT_AFTER = 15 * MIN;     // a single timeout or 529 must not raise a false alarm
const CLASSIFIER_GIVE_UP_AFTER = 24 * HOUR;  // then post it as a "maybe" with its text: no poison reply retried forever
const MAX_CLASSIFIER_FAILURES_PER_RUN = 3;   // a hung API cannot keep one run (and its lock) busy
const ACTIONABLE = ['warm', 'maybe', 'referral'];
const IGNORED_SENDERS = /^(?:mailer-daemon|postmaster)@/i; // not a whole domain: real people use googlemail.com

const DAY = 24 * HOUR;
const emptyState = () => ({ seen: {}, events: {}, pending: {}, gmailLeads: {}, blocked: {}, resume: {}, awaiting: {}, sent: {}, partial: {}, drafts: {}, warned: {}, evIds: {}, classifyWait: {}, aiAlertAt: 0 });

// Drop anything older than 30 days so the state file stays small.
function pruneState(st, nowMs, days = 30) {
  const cutoff = nowMs - days * DAY;
  for (const k of ['seen', 'events', 'evIds', 'gmailLeads', 'blocked', 'sent', 'partial']) for (const [key, v] of Object.entries(st[k] || {})) if (v < cutoff) delete st[k][key];
  for (const [key, v] of Object.entries(st.awaiting || {})) if (v.ts < cutoff) delete st.awaiting[key];
  for (const [key, v] of Object.entries(st.drafts || {})) if (v.ts < cutoff) delete st.drafts[key];
  for (const [key, v] of Object.entries(st.classifyWait || {})) if (v.first < cutoff) delete st.classifyWait[key];
  for (const [key, v] of Object.entries(st.pending || {})) if (v.at < cutoff) delete st.pending[key];
  for (const [key, v] of Object.entries(st.resume || {})) if (Date.parse(v) < cutoff) delete st.resume[key];
  return st;
}

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
const eventKey = ev => [leadOf(ev) || `${ev.firstName || ''}@${ev.companyName || ''}`, ev.campaign_name || '', ev.step || ''].join('|');
const eventTime = (ev, fallback) => { const t = Date.parse(ev.receivedAt || ev.timestamp || ''); return Number.isFinite(t) ? t : fallback; };

const firstNameFrom = (rec) => {
  if (rec.firstName) return rec.firstName;
  let name = String(rec.from_name || '').replace(/["']/g, '').trim();
  if (name.includes(',')) name = name.split(',').slice(1).join(' ').trim() || name; // "Smith, John"
  const n = name.split(/\s+/)[0];
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
    const key = eventKey(ev);
    // an exact event line seen before (say the log rotated and was read again) is never alerted twice
    const stamp = ev.receivedAt || ev.timestamp;
    if (stamp) {
      const idKey = `${key}|${stamp}`;
      if (state.evIds[idKey]) continue;
      state.evIds[idKey] = nowMs;
    }
    if (state.events[key] && nowMs - state.events[key] < EVENT_DEDUP) continue;
    state.events[key] = nowMs;
    state.pending[key] = { ev, at: eventTime(ev, nowMs) };
  }

  // 3. Gmail replies: classify and act, taking any matching webhook event along
  const inbound = replies.filter(x => x.kind !== 'sent');
  const autos = [];
  let classifierFailures = 0;
  const noteWait = (rec, from) => {
    if (!state.classifyWait[rec.msgid]) {
      const body = stripBody(rec.body);
      state.classifyWait[rec.msgid] = {
        first: nowMs, alerted: false, from, subject: String(rec.subject || '').slice(0, 120),
        snippet: String(body || rec.body || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        optOut: likelyOptOut({ subject: rec.subject, body: rec.body }),
      };
    }
    return state.classifyWait[rec.msgid];
  };
  for (const rec of inbound) {
    const from = addrOf(rec.from);
    if (!rec.msgid || state.seen[rec.msgid]) continue;
    if (!from || isOurMailbox(from) || from === 'kobi@kobestarr.io' || IGNORED_SENDERS.test(from)) { state.seen[rec.msgid] = nowMs; continue; }
    if (classifierFailures >= MAX_CLASSIFIER_FAILURES_PER_RUN) { noteWait(rec, from); continue; }
    try {
      const matched = Object.entries(state.pending).filter(([, p]) => leadOf(p.ev) === from);
      const ev = matched.length ? matched[0][1].ev : null;
      const label = await handleReply({ rec, from, ev, autos });
      if (label !== 'auto') {                 // an auto reply is not "the" reply: the webhook fallback stays armed
        for (const [k] of matched) delete state.pending[k];
        state.gmailLeads[from] = Date.parse(rec.date) || nowMs;
        state.seen[rec.msgid] = nowMs;
        delete state.drafts[rec.msgid];
      }
      if (label !== 'auto') delete state.classifyWait[rec.msgid];
    } catch (e) {
      out.errors.push({ where: 'reply', email: from, message: e.message });
    }
  }
  // Replies the model could not read for 15 minutes or more: announce each one once, naming the sender, so a
  // new stuck reply is never hidden behind an earlier alert. A likely opt-out is flagged, never blocked on a guess.
  const due = Object.entries(state.classifyWait).filter(([, w]) => !w.alerted && nowMs - w.first >= CLASSIFIER_ALERT_AFTER);
  if (due.length) {
    const why = due.some(([, w]) => w.kind === 'budget') ? 'AI cap hit' : 'AI unavailable';
    const lines = due.map(([, w]) => `- ${w.from} | "${w.subject}" | ${w.optOut ? 'possible opt-out, not blocked yet, check the inbox | ' : ''}${w.snippet}`);
    try {
      await deps.post(`${why}, ${due.length} repl${due.length === 1 ? 'y' : 'ies'} unclassified. The engine retries them every run until the model is back; after 24 hours each is posted as a maybe.\n${lines.join('\n')}`);
      for (const [, w] of due) w.alerted = true;
      state.aiAlertAt = nowMs;
      act({ type: 'ai-down', label: 'alert', email: due.map(([, w]) => w.from).join(',') });
    } catch (e) { out.errors.push({ where: 'reply', email: 'ai alert', message: e.message }); }
  }
  if (autos.length) {
    try {
      await deps.post(fmt.formatAutoDigest(autos));
      for (const a of autos) state.seen[a.msgid] = nowMs;
      act({ type: 'auto-digest', label: 'auto', email: autos.map(a => a.email).join(',') });
    } catch (e) { out.errors.push({ where: 'reply', email: 'auto digest', message: e.message }); }
  }

  // 4. pending webhook replies: consumed by a recent Gmail copy, or alerted after 15 minutes
  for (const [key, p] of Object.entries(state.pending)) {
    const lead = leadOf(p.ev);
    const g = lead && state.gmailLeads[lead];
    if (g && Math.abs(p.at - g) < 6 * HOUR) { delete state.pending[key]; continue; }
    if (lead && nowMs - p.at < UNIBOX_AFTER) continue;   // no email address means no Gmail match is possible: alert now
    const base = { email: lead, firstName: p.ev.firstName, company: p.ev.companyName, campaign: p.ev.campaign_name, step: p.ev.step, mailbox: eventMailbox(p.ev) };
    try {
      await deps.post(fmt.formatUnibox(base));
      act({ type: 'unibox', label: 'unread', email: lead });
      if (lead) await safeTrack({ email: lead, firstName: base.firstName || '', company: base.company || '', brand: brandOf(base.mailbox), campaign: base.campaign || '', label: 'unread', text: '', mailbox: base.mailbox, date: new Date(p.at).toISOString() });
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

  // 6. the GHL tracker module is another engineer's: warn once a day if it is not there
  if (deps.trackerMissing && nowMs - (state.warned.tracker || 0) > DAY) {
    try {
      await deps.post('Reply engine: the GHL tracker module is not installed, so replies are not being logged in GHL. This warning repeats once a day until it is.');
      state.warned.tracker = nowMs;
    } catch (e) { out.errors.push({ where: 'warning', message: e.message }); }
  }

  return out;

  async function handleReply({ rec, from, ev, autos }) {
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
    if (c.retry) {
      classifierFailures++;
      const w = noteWait(rec, from);
      w.kind = c.retry;
      if (nowMs - w.first < CLASSIFIER_GIVE_UP_AFTER) throw new Error(`classifier unavailable (${c.retry}), left unseen to retry next run: ${c.reason}`);
      c.reason = `classifier down for over 24 hours, read it yourself: ${c.reason}`;
    }
    const label = c.label;
    const dateIso = Number.isFinite(Date.parse(rec.date)) ? new Date(rec.date).toISOString() : now.toISOString();
    const trackerEvt = (extra = {}) => ({ email: from, firstName: lead.firstName || '', company: lead.company, brand: lead.brand, campaign: lead.campaign, label, text: String(rec.body || ''), mailbox: lead.mailbox, date: dateIso, ...extra });
    act({ type: 'classified', label, email: from, reason: c.reason });

    if (label === 'no' || label === 'left_company') {
      if (!state.blocked[from]) {
        const result = await deps.block(from, c.reason || (label === 'no' ? 'asked to be removed' : 'left the company'), label);
        const note = { ...lead, label, reason: c.reason, referral_email: c.referral_email, result };
        if (!result.complete) {
          // keep the reply unseen so the next run retries the block (it is idempotent); shout only once
          if (!state.partial[from]) { await deps.post(fmt.formatBlocked(note)); state.partial[from] = nowMs; }
          throw new Error('block incomplete, will retry');
        }
        await deps.post(fmt.formatBlocked(note));
        state.blocked[from] = nowMs; // after the post, so a failed post retries (blocking is idempotent)
        delete state.partial[from];
      }
      await safeTrack(trackerEvt());
      return label;
    }

    if (label === 'auto') {
      if (c.resume_date) state.resume[from] = c.resume_date;
      autos.push({ msgid: rec.msgid, email: from, firstName: lead.firstName, company: lead.company, resume: c.resume_date, colleague: c.colleague_email });
      return label;
    }

    // warm, maybe, referral
    let d = state.drafts[rec.msgid];   // cached while Buzz is down, so Sonnet is not asked again every run
    if (!d) {
      d = await deps.draft({ reply: { subject: rec.subject, body: rec.body, from }, lead, label });
      if (!d.error) state.drafts[rec.msgid] = { text: d.text, ts: nowMs };
    }
    await deps.post(fmt.formatActionable({ ...lead, label, reason: c.reason, text: rec.body, draft: d.text, draftError: d.error }));
    await safeTrack(trackerEvt());
    const replyMs = Date.parse(rec.date) || nowMs;
    if ((state.sent[from] || 0) < replyMs) state.awaiting[from] = { ts: replyMs, label, firstName: lead.firstName, company: lead.company, campaign: lead.campaign, step: lead.step, mailbox: lead.mailbox, reAlerted: false };
    return label;
  }
}

module.exports = { processNew, emptyState, pruneState, leadOf };
