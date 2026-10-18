# The reply engine, in plain English

## What it does
When someone answers one of your cold emails, the engine reads the answer, works out what it is, and does the sensible thing. It never sends an email. You always send your own answers.

## What happens when someone replies
1. A small program on the server reads your Gmail every few minutes and keeps a copy of replies to the 27 sending mailboxes. It also notes when you reply to someone.
2. Every 5 minutes your Mac checks for new replies, and also looks at what Mailead reports.
3. Each reply is sorted into one of six kinds, then handled as below.

## The six kinds, and what you will see in Buzz (~outreach)
| Kind | What it means | What the engine does |
|---|---|---|
| Warm reply | They want to see it, hear more, or asked for a proposal. | Posts who they are, their company, the campaign, which mailbox it went to, what they said, and a drafted answer in your style. |
| Maybe, needs your read | A question, a price enquiry, a sceptical "how did you get my details", or "not right now". | Same as warm, with a draft. It is never blocked. If they ask where we got their details, the draft says so and offers to remove them. |
| Referral | They point you to someone else or copy a colleague in. | Same as warm, with a draft. |
| No | A firm no, "remove me", or "I am retired". | Blocks them everywhere (below) and posts a short note. |
| Left the company | The person has gone. | Blocks the address everywhere and posts a short note. If they name a colleague, it is shown but nobody is contacted. |
| Auto reply | Out of office, a ticket system, a canned answer, in any language. | One combined line per check listing who is away and when they are back (and any colleague they name). Nothing is needed from you. |

Other messages you may see:
- **Reminder:** the reminder text tells you how to silence it if you answered another way.
- **Reply from <name> at <company>:** Mailead sent a reply notice with no email address, so the engine cannot read it. Read it in the Mailead Unibox.
- **Reply with no copy in Gmail:** Mailead saw a reply but no copy reached your Gmail within 15 minutes. Read it in the Mailead Unibox.
- **Still unanswered after 24h:** a warm, maybe or referral reply has had no answer from you. You get this reminder once, not repeatedly.
- **PARTLY blocked:** one of the four blocks failed. The note says which, so you can fix it by hand.

## What gets blocked, and why
Only "No" and "Left the company", and only when the reply is one short removal or left notice with nothing else in it (no question, no "but", nobody saying "I now look after this"). Anything more mixed goes to the AI, and if the AI says no on a reply that asks for anything, it becomes "Maybe". Each address is added to four places so it can never be emailed again:
1. The Mailead blocklist.
2. The email finder's do not contact list.
3. `data/do-not-contact.txt` (with the reason and date).
4. `data/sent-ledger.txt`.

Running it twice never makes duplicate lines. "Not now", price questions, scepticism and threats that still ask for a proposal are never blocked. When the engine is unsure, it labels the reply "Maybe" so you read it.

## The drafts
Short, warm, first name, no dashes, one real proof point (Nigel, Twiggy, Proxymity, Entain, Thallo or the window cleaner), a soft call to action. The booking link shows as `[BOOKING LINK]` until you put it in `config/harvey.json` (`"bookingUrl"`). Always read a draft before using it. If someone asks how we got their details, the draft names the source for that campaign (set in `config/harvey.json` under `sources`). If the campaign is not in that list the draft shows `[SOURCE: check]`: fill it in yourself. The draft only uses proof points from the list above, never an invented one.

## Answering
Answer from Gmail, as you do now, by replying to the thread. The engine watches your Gmail Sent folder: once you have replied to that person, the 24 hour reminder is cancelled. If you answered somewhere else (the Mailead Unibox), tell it with `node reply-engine.js --answered their@email.com`.

## The old reply alerts
The existing 5 minute Mailead alert (`mailead-alerts-buzz`) also posts "Reply:" lines. When this engine goes live, those reply alerts are retired (the old job is cut down to bounces only), so you do not get two alerts for one reply.

## Setting it up, in this order
1. Deploy the collector to the server (`vps/reply-collector.py`), set its Gmail login in the environment file, and run it once by hand with `--dry-run`, then for real. The first real run creates `/root/data/replies.jsonl`.
2. Put the collector on a 5 minute cron.
3. Run the engine once by hand: `node reply-engine.js --dry-run --once`. Check the output.
4. Load the LaunchAgent. Its first run only notes where the logs end, so none of the old replies are reposted.
5. Last, cut the old reply alerts down to bounces only.

## Turning it on and off
The engine runs from a LaunchAgent that is not loaded yet.
- **Try it safely first:** `cd` to the project and run `node reply-engine.js --dry-run --once`. It prints what it would do and changes nothing.
- **Turn on:** `launchctl load ~/Library/LaunchAgents/com.kobestarr.reply-engine.plist` after copying the plist from `config/launchd/`.
- **Turn off:** `launchctl unload ~/Library/LaunchAgents/com.kobestarr.reply-engine.plist`.
- The first real run starts from "now". It will not repost old replies.

## If something looks wrong
- Logs: `~/.config/dev-autosave/logs/reply-engine.out.log` and `.err.log`.
- Its memory of what it has seen: `~/.config/outreach-alerts/reply-engine-state.json`. Entries older than 30 days are tidied away. Deleting it makes it forget (it will not repost old ones because of the saved position files next to it).
- If the tracker for GHL is not installed yet you get one Buzz warning a day until it is.
- The block lists (`data/do-not-contact.txt` and `data/sent-ledger.txt`) are always the ones in the main project folder, whatever folder the engine runs from. A live run from a work copy refuses to start unless told where they are.
