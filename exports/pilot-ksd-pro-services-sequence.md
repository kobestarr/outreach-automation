# Pilot Sequence: NW Professional Services (Accountants + Solicitors)

**Drafted:** 2026-06-10 (overnight) · For the 85-firm pilot list `exports/pilot-ksd-pro-services-nw-2026-06-10.csv`
House style: [[feedback-cold-email-house-style]] (no dashes, warm, Nigel + Twiggy, real quote, specific observation, soft CTA).
**Channel (Kobi's chosen approach, 2026-06-12):** LinkedIn connection request AND email on the SAME day. The email openly references the LinkedIn request, so the two touches reinforce each other instead of looking like separate cold hits. Prosp sends the LI request; Mailead sends the email same day (or at the latest next day). All 85 have email; 84 have a LinkedIn URL (the 1 without just gets the email).

> ⚠️ **SUBJECT LINES ARE DRAFTS, NOT FINAL.** Project rule: nothing sends without a cold-reader audit ([[feedback-subject-lines-cold-reader]]). Options below are starting points for that audit, not approved copy.

---

## The hook for this segment

Accountants and solicitors live or die on "who do people trust." Their buyers increasingly ask ChatGPT and Perplexity "best accountant in Stockport" / "employment solicitor near me" before they ever Google. Most of these firms have a tired site with no structured data, so the AI skips them. That is the wedge: not "you need a new website," but "you are invisible to the way your clients now search, and your competitor down the road isn't."

Same playbook as Nigel Stephens (cardiologist who wanted to control how he showed up when patients compared him to other consultants). Professional, reputation-driven, identical problem.

---

## Day 0, touch 1 — LinkedIn connection request (Prosp)

**NO NOTE.** Send a blank connection request (no message). Blank connects accept at higher rates than pitched ones, and the same-day email does the talking.

## Day 1 (if they accept and reply on LinkedIn before the email lands)

> Thanks for connecting {{first_name}}. Did the email reach you? Happy to just share the three things here instead. When someone asks an AI tool "who's a good {{category}} in {{town}}", {{company_name}} doesn't really come up yet, because the site hasn't got the structure these tools read. Very fixable, and most firms round here haven't noticed it. Same thing I did for Dr Nigel Stephens (consultant cardiologist) and Twiggy.

---

## Day 0, touch 2 — Email (same day as the LinkedIn request)

The opener references the LinkedIn request so the two land as one warm approach, not two cold ones.

**Subject (cold-reader audit done 2026-06-22, Kobi's pick):** `AI search for {{company_name}} {{first_name}}`
*(Mailead tokens confirmed live 2026-06-22: First Name = `{{first_name}}`, Company Name = `{{company_name}}` (NOT `{{company}}` — would render blank), custom vars `{{category}}` / `{{town}}`. A/B alt: same line with a trailing `?` for a curiosity test.)*

**Body (Kobi's own final version, 2026-06-16 — locked):**

> Hi {{first_name}},
>
> I had a quick look and saw {{company_name}} doesn't really come up in AI Search such as Google AI Overview or ChatGPT when people ask for a good {{category}} in {{town}}.
>
> Easily sorted though.
>
> I recently did exactly this for Twiggy (yes, that Twiggy), and also for my window cleaner near me in South Manchester. He's a lovely guy and now his phone won't stop ringing! I'm sure if I can get him found, I can definitely do the same for you and {{company_name}}.
>
> Want me to share the three things I'd start with? No worries if not. I'm also happy to share the WhatsApp messages from the window cleaner telling me about all the phone calls if that helps...
>
> Cheers,
> Kobi

*(Prosp sends a no-note connect the same morning; the email doesn't reference it, keeps it short.)*
*Proof escalation: window cleaner here in email 1 → Dr Nigel Stephens + Twiggy in email 3, the real pitch.*

---

## Email 2 — Day 3, nudge (reply on the same thread, subject blank)

> Hi {{first_name}},
>
> Just bumping this up your inbox in case it got buried.
>
> Quick version: a couple of {{town}} {{category}}s are starting to show up when people ask AI for a recommendation, and most aren't yet. Much easier to be early than to play catch-up later.
>
> Want me to show you where {{company_name}} sits right now?
>
> Cheers,
> Kobi

## Email 3 — Day 6, the real pitch (highest performer; same thread)

> Hi {{first_name}},
>
> Last proper one from me on this, promise.
>
> This is what I do for a living, most recently for Dr Nigel Stephens (a consultant cardiologist) and Twiggy, yes, that Twiggy. Nigel just wanted to control how he came across when people compared him to other consultants, and honestly that's all this is.
>
> For {{company_name}} I'd pull together a quick audit showing exactly where you're invisible in AI search and the three things I'd fix first. Takes me an hour, yours free, no strings.
>
> Want it?
>
> Cheers,
> Kobi

## Email 4 — Day 12, breakup (same thread)

> Hi {{first_name}},
>
> I'll leave you in peace after this one.
>
> If getting {{company_name}} found in AI search is ever worth a look, just reply "audit" and I'll sort it. If not, no worries at all, I'll stop landing in your inbox.
>
> Either way, all the best with the firm.
>
> Cheers,
> Kobi
> Kobestarr Digital

---

## Merge variables (from the CSV)
- `{{first_name}}` → first_name
- `{{company_name}}` → company
- `{{category}}` → "accountant" or "solicitor" (from category)
- `{{town}}` → location
- The `{{three things}}` audit is the lead magnet: auto-generate per firm from a quick site + AI-search check (this is the free AI-visibility audit the funded-startups doc already specs). For the pilot, Kobi can eyeball each in seconds since it's only 85.

## Sending notes
- **Mailead campaign:** `KSD · AI Search · Professional Services` (DB tag `ksd-aisearch-proservices`). ONE growing campaign — naming convention `KSD · AI Search · <Vertical>`; siblings (Medical, Trades) slot in later. 81 now → append the ~1,896 accountants+solicitors → thousands, all into this one.
- **List:** 81 clean firms, naturalised company names — upload `exports/pilot-mailead-2026-06-22.csv` (company = short name e.g. "Sheppards", `company_full` retains the legal name; has `town` for `{{town}}`).
- **Sending window (standing rule, set 2026-06-22):** Mon-Fri, with ONE caveat — the FIRST email of the sequence is never sent on a Friday (first touch Mon-Thu only; follow-ups any weekday). Configure Mailead sending days accordingly.
- **Cadence:** Email 1 Day 0 → Email 2 Day 3 → Email 3 Day 6 → Email 4 Day 12. All replies on the same thread (subjects blank after email 1).
- **Pacing:** ~8-10/box/day across the 9 KSD mailboxes; gentle ramp, don't blast.
- **Channel:** Prosp no-note connect same morning as Email 1.
- **Sender = Mailead** (manual load ~20 min, then it auto-drips the whole sequence). No Mailead API exists; TaskMagic can automate the load later but is flaky. Smartlead/Instantly = the API-driven self-running route for the future (needs new mailbox warmup).
- **Reply handling:** replies → GHL via the reply-watcher + WhatsApp ping. Same-day response. Goal = booked call, not closing in-thread.
