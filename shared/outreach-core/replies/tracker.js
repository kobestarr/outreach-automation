/**
 * replies/tracker.js: tiny adapter the reply engine loads if present.
 *   const { trackReply } = require('./tracker');  await trackReply(evt);
 * Builds ONE ghl-tracker per process with the real credentials (so the identity guard runs once per brand per process)
 * and the GHL CLI as the transport. evt = { email, firstName, company, brand?, campaign, label, text, mailbox, date, referral? }.
 * Mailead sends, GHL tracks, Buzz notifies: this only records.
 */
const { createGhlTracker, loadGhlCreds, makeDefaultCli } = require('../crm/ghl-tracker');

let shared;
function getTracker() {
  if (!shared) {
    const cli = makeDefaultCli();
    shared = createGhlTracker({ creds: loadGhlCreds({ cliDir: cli && cli.dir }), cli, log: (m) => console.error('[ghl]', m) });
  }
  return shared;
}

/** deps.tracker is for tests; production callers pass the event only. */
async function trackReply(evt, deps = {}) { return (deps.tracker || getTracker()).trackReply(evt); }
async function moveStage(email, brand, stage, opts, deps = {}) { return (deps.tracker || getTracker()).moveStage(email, brand, stage, opts); }

module.exports = { trackReply, moveStage };
