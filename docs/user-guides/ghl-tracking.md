# GHL tracking for cold email replies

What this does in plain English: when someone replies to a cold email, the reply gets recorded in GoHighLevel so every live conversation is in one place. GHL only records. It never sends anything. Mailead sends, GHL tracks, Buzz tells you.

## Which sub-account gets the reply
It depends on the mailbox the email was sent from.

| Sent from | Sub-account |
|---|---|
| kobestarrdigital.com, kobestarr.digital, trykobestarrdigital.com | Kobestarr |
| strippedmedia.co.uk, strippedmedia.org, gostripped.media | Stripped Media |
| dealflowmedia.co, dealflowmedia.pro, dealflowmedia.group | Dealflow Media |
| anything else, or no mailbox | Nothing is recorded. The reply is reported back as skipped (unknown brand). It is never put in Kobestarr by default. |

Each sub-account has one pipeline called "Cold Email". Before the first write for a brand in each run, the tracker reads the location back from GHL and checks that the id and the name match the brand. If they do not, it refuses to write anything for that brand and raises an error.

## What lands in GHL for every reply
- The person as a contact (email trimmed and lowercased; `name+tag@` addresses are treated as different people). Tags `cold-email`, `campaign:<campaign>`, `brand:<brand>` are added, existing tags are kept.
- One deal per person in the Cold Email pipeline. A person never gets a second deal while one exists, open, won or lost.
- A note with the date, campaign, mailbox and the reply text (first 1,500 characters).
- Out of office and other auto replies (`auto`) are ignored. A reply we know about but could not read (`unread`, seen only in the Mailead Unibox) gets a note saying "Reply in Mailead Unibox, text not captured" and a deal at Replied if there is no deal yet. Any label the tracker does not recognise gets a note only, no stage change.

## The stages
1. Replied: they wrote back, not a clear yes. Also "maybe", referrals (the note names who they pointed you to) and unread replies.
2. Interested: a warm reply.
3. Call booked: a call is in the diary. Moved by the booking watcher or by you.
4. Proposal sent: moved by you or the proposal flow.
5. Won: they said yes. The deal is marked won.
6. Not now: parked. Stays open so a later warm reply can revive it.
7. Lost: a clear no, or they have left the company. The note says why. The deal is marked lost.

## What moves a deal
- Warm goes to Interested. Maybe, referral and unread go to Replied. Deals only move forward, so a later "maybe" never pulls a Call booked deal back.
- No or left-company goes to Lost only from Replied, Interested or Not now. If the deal is already at Call booked or Proposal sent, it is NOT moved. The note says NEEDS REVIEW, the contact gets the tag `needs-review`, and the result carries `needsReview: true` so the reply engine can alert you.
- Won deals are never changed by a reply. A note is added.
- Lost deals: a warm reply reopens the SAME deal at Interested. Any other reply just adds a note.
- Moves you make yourself in GHL, or through `moveStage` (which takes a pipeline name, default Cold Email), are your call. `moveStage` is also forward only unless told otherwise.

## Safety behaviour
- The same reply twice changes nothing. Two replies at the same moment for one person are processed one after the other (in-process queue plus a lock file under `~/.config/outreach-alerts/ghl-locks/`, so a Mac run and a VPS run cannot race; the lock files live on each machine, and a lock older than 60 seconds is treated as stale).
- If a write fails with a server error or a timeout, the tracker first reads back whether it actually landed before trying again. It only blindly retries when GHL says "slow down" (429).
- All calls share one limiter kept under 100 requests per 10 seconds.
- Two pipelines both called Cold Email in one sub-account is reported as an error and nothing is changed.

## Setting it up (once)
- Check what exists (read only): `node ghl-setup.js --check`
- See exactly what would be created: `node ghl-setup.js --plan`
- Create the pipelines: `node ghl-setup.js --apply` (or `--apply --brand kobestarr` first). It never edits or deletes an existing pipeline. Output shows the location id and name GHL returned for each sub-account.

## If something looks wrong
- "Identity check failed": the token or CLI profile for that brand points at the wrong sub-account. Nothing was written.
- "No Cold Email pipeline": run the setup above.
- A reply did not appear: it was labelled auto, or its mailbox domain is not one of the nine above (look for `skipped: unknown_brand`).
