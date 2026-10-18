# The email finder: how it works, in plain English

## What it does

For each firm on a list, we know the owner's name and the firm's website. The finder works out the owner's email address and checks it is real before anything is sent. It remembers everything it learns, so it gets cheaper and better every week.

## How an address is found

1. **We look on the website first.** If the owner's own address is printed there (for example tony@ for Anthony), we use it and the finder is never called. That is the best case.
2. **If not, the finder guesses sensibly.** It tries the formats real companies use (first name, first.last, and so on), starting with the one that works for most small UK firms. Each guess is checked with Reoon, the checking service. The first one Reoon confirms wins. Most people cost one or two checks.
3. **Some firms accept any address** (their mail server says yes to everything), so a check proves nothing. For those the finder asks Icypeas, which is paid and currently switched off, so those firms are simply set aside for now.
4. **If no personal address exists,** it tries the shared inbox (info@, hello@ and so on). That still counts as a result: we send to the shared inbox and greet the owner by first name.

The finder is only asked about a firm when we have an owner name and Google Maps has confirmed it is the right business.

## What each route means

Every address ends up on one of four routes. The route depends on how sure we are.

| Route | What is in it | What happens |
|---|---|---|
| **Main** | Addresses we are confident are the owner's: scraped from their site, or found and confirmed | Goes to the main campaign |
| **Shared inbox** | info@ style addresses | Goes to its own campaign, same emails with one tweaked opening line (you approve the line first) |
| **Probable** | Icypeas "probably right" finds | Held in a file, not sent, until Icypeas is topped up |
| **Excluded** | Everything we are not sure about | Never sent. Listed in a file with the reason |

The held and excluded files appear in the data folder (`held-<campaign>-<route>.csv` and `excluded-<campaign>-<date>.csv`), so nothing disappears quietly.

## What never gets sent

- **A guess.** If the finder could not confirm an address, its best guess is kept in a separate column for your eyes only. It is never used.
- **Someone who has probably left.** If the address exists but the mailbox is switched off, we do not send.
- **Anyone on the do-not-contact list**, by address or by whole company website. Checked at the very last step, whatever way the address was found.
- **Anyone the finder has marked as suppressed** (they bounced, asked to be removed, or you added them). If a firm is suppressed we do not fall back to another address at that firm.
- **Nothing slips past the loader.** `load-to-mailead.js` runs every one of these checks again, address by address, just before it adds a lead, so a hand edit to the Google Sheet cannot bypass them. A row that was never put there by send-batch is refused.
- **The same firm twice.** One firm gets one email, even if it appears twice in the list, under two websites, or was loaded in an earlier wave. If one firm has both a personal and a shared address, the personal one wins. Big shared addresses (NHS, universities, doctors.org.uk, TaxAssist, BT and similar) are never treated as one firm. The list lives in `config/shared-domains.json`, add to it any time.
- **Anything unclear.** If a list has the new "how was this found" column but a row's value is blank, the row is excluded rather than assumed fine. Old lists without that column behave exactly as before.

## Credits and safety limits

- It spends only the **daily** Reoon credits. The big reserve is locked and cannot be touched by this tool.
- By default a run keeps **300 credits back**, because the daily funded batch uses the same account.
- Before checking addresses for a send, the tool looks at today's balance. If there are not enough credits it stops, tells you, and pushes nothing.
- Addresses the finder already confirmed in the last 30 days are not paid for a second time.
- Icypeas spending is **off by default**. You have to ask for it.
- Live sends refuse to run from a work-in-progress copy of the project, and refuse if the list of past sends, the do-not-contact list or the finder's memory file is missing, so an empty list can never be mistaken for "nobody to avoid".
- Dry runs never write into the data folder. Their held and excluded files go to a temporary folder (or the one you name with `--out-dir`).

## How bounces teach it

When an email bounces, the Buzz alert still arrives as before. In addition, the address is handed to the finder, which:

- never suggests or accepts that address again,
- forgets that the address was ever confirmed,
- marks the format that produced it as less trustworthy for that company.

Only hard bounces are passed on (a full mailbox or a temporary failure is just logged). Each bounced address is passed on once only, and the older bounce list from July is imported the first time it runs. If the finder cannot be reached at that moment, the address waits in a queue file, you get a single Buzz message saying so, and it is passed on automatically at the next run. Nothing is lost.

## What you run

1. **Compare first (wave 1 benchmark).** This shows which firms would go to the finder and the worst-case cost, and spends nothing:

   `node scripts/finder-benchmark.js <the wave 1 final list> --out <a new file name>`

   Add `--live` to run it for real with the daily credits. It only compares, it never loads anything.
2. **Wave 2.** Find the firms, find the owners, then `enrich-owner-emails.js`, `assemble-local-mailead.js`, and finally `send-batch.js --dry-run`. The dry run lists what would go where, and writes the held and excluded files for you to read.
3. **Nothing is loaded into Mailead until you say go.**

## If something looks wrong

- "Campaign sheet missing": a campaign needs its blank Google Sheet registered before anything is sent. The message tells you the exact command.
- "Refusing a live run": either the finder could not be found, or you are in a work-in-progress copy. The message says which.
- "Reoon daily credits too low": wait until tomorrow or send fewer.
