# Mailead + TaskMagic: Sending Playbook & Research

**Created:** 2026-06-12 · Research from live vendor pages + AppSumo founder Q&As (Jeremy Redman).
Goal: unblock standing up campaigns and sending from Monday. The bottleneck is execution, not leads.

## The headline: your ideal flow IS supported, and it's free

TaskMagic is **built into Mailead by the same founder**. Using TaskMagic *within a Mailead flow costs nothing* extra ("As long as you are using mailead within your flow it doesn't cost" — Jeremy Redman). Mailead deliberately has **no Zapier** (Zapier removed them from their store), so TaskMagic is the intended automation layer. TaskMagic does **both** API app-connections (Google Sheets, Gmail, 200+ apps, like Zapier) **and** browser automation (clicks/types/scrapes anything in Chrome). So "Google Sheet of leads → automation → add to Mailead campaign" is exactly the designed use case.

## Two gotchas that change how we build it

1. **Mailead overwrites leads on re-upload.** Uploading a second CSV to the *same* campaign **deletes the first** (founder confirmed; blamed variable-column matching). So you **cannot keep appending** to one evergreen campaign by re-uploading. Cleanest pattern: **one campaign per batch** (name it by date, e.g. `pro-services-nw-2026-06-15`). To truly append, you must use TaskMagic to add leads via Mailead's in-app form/automation, not CSV re-upload.

2. **TaskMagic runs locally by default, BUT Kobi has TaskMagic Cloud.** The free/desktop tier runs on your Mac (needs it on). **Cloud hours run unattended on a remote worker, no machine on, properly scheduled** — "execute at any time without the need for your computer to be on." Hours are a monthly-refreshing lifetime allowance; a 45-min local job = 45 cloud-min. A Sheet→campaign import is a few minutes, so Kobi's allowance covers it easily. So for Kobi, the always-on/scheduled automation IS viable. (Caveat still: long *browser-automation* runs are reported flaky; prefer TaskMagic's Mailead app-action over UI clicking where possible.)

## Recommended architecture (built around those constraints)

**For Monday (fastest path to revenue, zero automation risk):**
Skip automation entirely for the 85-firm pilot. Manual is faster than building a robot for 85 rows:
1. Export the pilot CSV (done: `exports/pilot-ksd-pro-services-nw-2026-06-10.csv`).
2. Create ONE new Mailead campaign, upload the 85, paste the sequence, set sending schedule, launch.
3. ~30 minutes, no moving parts. This is the unblock.

**For the recurring machine (build in parallel, use from batch 2 onward):**
- Google Sheet = the staging tab. New verified leads land here (from the DB export, firm-filtered).
- TaskMagic automation, run **on-demand per batch**: read the Sheet rows → in Mailead, **create a new dated campaign** → import → (optionally) start it. One click when a batch is ready, not an always-on poller.
- Because of the overwrite rule, each weekly batch = its own campaign. Fine, and actually cleaner for tracking reply rates per cohort.

**Replies (already half-solved):** you've repointed Mailead senders so replies land in your normal Gmail. Good, the Mailead inbox is bypassed. Remaining step: a same-day response habit + one place to track them (GHL pipeline stage, or Gmail label for now).

## Honest caveat on Mailead itself
Reviews are mixed ("not ready for market"), and you've said the UI is rough. But you have warmed mailboxes + a lifetime deal there, and re-warming on Smartlead/Instantly (which have proper cloud APIs and would make this automation trivial) costs weeks. **Verdict: stay on Mailead to send Monday.** Revisit a migration to Smartlead only once revenue is flowing and the automation pain is the binding constraint, not before.

## Sources
- [mailead.io](https://mailead.io/) · [taskmagic.com how-it-works](https://taskmagic.com/#how-it-works)
- AppSumo founder Q&As: [What about TaskMagic](https://appsumo.com/products/mailead/questions/what-about-taskmagic-1245357/) · [Cooperation with mailead](https://appsumo.com/products/taskmagicai/questions/cooperation-with-mailead-1248090/) · [Lead import overwrite](https://appsumo.com/products/mailead/questions/lead-import-1250799/)
