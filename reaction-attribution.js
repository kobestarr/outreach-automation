/**
 * reaction-attribution.js — closes the loop on the reactions engine.
 *
 * The Armando Zuccali case (2026-07-22): the batch liked his post at 16:22 from
 * the `search` pool, he viewed the profile, he sent the invite the same evening.
 * Kobi spotted it by eye. This module does it by machine, so we learn which
 * POOL actually converts likes into inbound invites before we scale to 400/day.
 * Without it we would be scaling blind and paying for it in seat risk.
 *
 * Inputs:
 *   invites  - from linkedapi `st.retrieveInvitations` (received invitations).
 *              NOTE: that workflow is SLOW (observed >15 min against an
 *              advertised 2-4). linkedapi runs one workflow at a time per
 *              account, so it may ONLY be called at batch start with the queue
 *              empty — mid-run it starves the likes and trips the 3-consecutive
 *              -failure halt, exactly as happened on 2026-07-21.
 *   persons  - state.persons from the batch: { username: lastLikedISO }
 *   meta     - { username: { pool, keyword } } captured at fire time
 *
 * Pure functions, zero deps — the batch runs standalone on the clawdbot VPS.
 */

const DAY = 86400000;

const usernameOf = (url) => {
  const m = String(url || "").match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : null;
};

/**
 * Match received invites against people we liked.
 * @param {Array<{name?:string, publicUrl?:string}>} invites
 * @param {Object<string,string>} persons  username -> last liked ISO
 * @param {{now?:number, windowDays?:number, meta?:Object}} [opts]
 */
function attribute(invites, persons, opts) {
  const o = Object.assign({ now: Date.now(), windowDays: 21, meta: {}, source: "invite" }, opts || {});
  const attributed = [], unattributed = [], byPool = {};

  for (const inv of invites || []) {
    if (!inv) continue;
    const username = usernameOf(inv.publicUrl || inv.url || inv.profileUrl);
    const likedAt = username && persons ? persons[username] : null;

    if (!username || !likedAt) {
      unattributed.push({ name: inv.name || "?", username: username || null });
      continue;
    }

    const ageMs = o.now - Date.parse(likedAt);
    if (!(ageMs >= 0) || ageMs > o.windowDays * DAY) {
      unattributed.push({ name: inv.name || "?", username, likedAt, staleLike: true });
      continue;
    }

    const m = o.meta[username] || {};
    const pool = m.pool || "unknown";
    byPool[pool] = (byPool[pool] || 0) + 1;
    attributed.push({
      username,
      name: inv.name || "?",
      linkedinUrl: `https://www.linkedin.com/in/${username}`,
      pool,
      keyword: m.keyword || null,
      likedAt,
      invitedAt: new Date(o.now).toISOString(),
      daysToConnect: Math.round(ageMs / DAY),
      source: o.source,
    });
  }

  return { attributed, unattributed, byPool };
}

/**
 * Usernames present in `after` but not `before`.
 *
 * Why this exists: a pending invite disappears the instant it is accepted, so
 * polling st.retrieveInvitations alone misses anyone who connected before the
 * 21:30 run — including Armando Zuccali, who was already 1st-degree when we
 * first looked. Diffing the 1st-degree snapshot catches the accepted ones.
 *
 * An empty/absent `before` returns nothing: the first run establishes the
 * baseline rather than claiming all 1,870 existing connections as new leads.
 */
function diffConnections(before, after) {
  const prev = new Set((before || []).map((u) => String(u).toLowerCase()));
  if (!prev.size) return [];
  return (after || [])
    .map((u) => String(u).toLowerCase())
    .filter((u) => !prev.has(u));
}

/** Idempotent append: a person already in the ledger keeps their FIRST sighting. */
function mergeLedger(existing, incoming) {
  const out = (existing || []).slice();
  const seen = new Set(out.map((r) => r.username));
  for (const r of incoming || []) {
    if (seen.has(r.username)) continue;
    seen.add(r.username);
    out.push(r);
  }
  return out;
}

/** Attributed people not yet handed to Prosp for the 1st-degree follow-up. */
function pendingProspPush(ledger) {
  return (ledger || []).filter((r) => !r.pushedToProsp);
}

module.exports = { attribute, diffConnections, mergeLedger, pendingProspPush, usernameOf };
