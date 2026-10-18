# GHL tracking for cold email replies

What this does in plain English: when someone replies to a cold email, the reply gets recorded in GoHighLevel so you can see every live conversation in one place. GHL only records. It never sends anything. Mailead sends, GHL tracks, Buzz tells you.

## Which sub-account gets the reply
It depends on the mailbox the email was sent from.

| Sent from | Sub-account |
|---|---|
| kobestarrdigital.com, kobestarr.digital, trykobestarrdigital.com | Kobestarr |
| strippedmedia.co.uk, strippedmedia.org, gostripped.media | Stripped Media |
| dealflowmedia.co, dealflowmedia.pro, dealflowmedia.group | Dealflow Media |
| anything else | Kobestarr |

Each sub-account has one pipeline called "Cold Email".

## What lands in GHL for every reply
- The person as a contact, tagged `cold-email`, `campaign:<campaign name>` and `brand:<brand>`. Existing tags are kept.
- One deal (opportunity) per person in the Cold Email pipeline. A second reply from the same person updates the same deal, it does not make another.
- A note with the date, campaign, the mailbox it was sent from, and the reply text (first 1,500 characters).
- Out of office and other automatic replies are ignored.

## The stages
1. Replied: they wrote back but it is not a clear yes. Also used for "maybe" and for referrals (the note names who they pointed you to).
2. Interested: a warm reply, they want to talk or hear more.
3. Call booked: a call is in the diary. Moved by the booking watcher, or by you.
4. Proposal sent: you have sent a proposal. Moved by you or the proposal flow.
5. Won: they said yes. The deal is marked won.
6. Not now: parked, the timing is wrong. Stays open so a later warm reply can revive it.
7. Lost: a clear no, or they have left the company. The note says why. The deal is marked lost.

## What moves a deal
- Their reply: warm goes to Interested, maybe and referral go to Replied, no and left-company go to Lost.
- Deals only move forward. If a deal is at Call booked and they send a vague "maybe" later, it stays at Call booked. A "no" still moves it to Lost, because that is real news.
- Won deals are never touched by replies.
- If someone you marked Lost replies warmly later, a fresh deal opens for them at Interested (the old lost one stays as history).
- You can always drag a deal yourself in GHL.

## Setting it up (once)
Check what exists (read only): `node ghl-setup.js --check`
See exactly what would be created: `node ghl-setup.js --plan`
Create the pipelines: `node ghl-setup.js --apply` (or `--apply --brand kobestarr` to try one sub-account first). It never edits or deletes an existing pipeline. If a Cold Email pipeline exists with the wrong stages it tells you instead of changing it.

## If something looks wrong
- "No Cold Email pipeline" error: run the setup above.
- A reply did not appear: check the label was not "auto", and that the mailbox domain is one of the nine above (otherwise it went to Kobestarr).
- Running the same reply twice is safe, it does not duplicate anything.
