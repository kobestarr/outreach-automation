# Mailead sequence — ksd-pro-services-2026-07-02 (PASTE-READY, v2 audit-first)

Campaign id **8890**. Paste each email into the Mailead sequence editor.
v2 (2026-07-06, Kobi's call): the **free audit offer moves to Email 1** ("I've started your audit,
want it when it's done?") instead of being held to Email 3. Cold-reader pass done 2026-07-06 —
key rule: the specific insight line must come BEFORE the words "free audit" in Email 1, so the
offer reads as evidence of work done, not a spam lure. Do not reorder.

The insight phrase is packed into each lead's **Last Name**, so `{{last_name}}` renders the insight, NOT a surname.

**Tokens available in this upload (only these 4 — anything else renders blank):**
`{{first_name}}` · `{{last_name}}` (= insight phrase) · `{{email}}` · `{{company_name}}`

The 2 empty-Last-Name canaries (peter@bevan.co.uk, nmistry@hurst.co.uk) were removed from the
campaign via API on 2026-07-06. Campaign holds 814 leads, all with insight carriers.

Send rules: first touch **Mon-Thu only** (never Friday), send from the KSD identity mailboxes.

---

## Email 1 — Day 0

**Subject:** `AI search for {{company_name}} {{first_name}}`

> Hi {{first_name}},
>
> I had a quick look and saw {{company_name}} {{last_name}}.
>
> Easily sorted though. That look was actually the start of a free audit I'm pulling together for {{company_name}}: where you show up in AI search, where you don't, and the three things I'd fix first.
>
> I recently did exactly this for Twiggy (yes, that Twiggy), and also for my window cleaner near me in South Manchester. He's a lovely guy and now his phone won't stop ringing! If I can get him found, I can definitely do the same for {{company_name}}.
>
> Want me to send the audit over when it's done? No worries if not.
>
> Cheers,
> Kobi

*Renders e.g.:* "I had a quick look and saw Langricks doesn't really come up in AI Search such as Google AI Overview or ChatGPT when people ask for a good accountant in Wilmslow."

---

## Email 2 — Day 3 (same thread, blank subject)

> Hi {{first_name}},
>
> Just bumping this up your inbox in case it got buried.
>
> That audit for {{company_name}} is still sitting here with your name on it. A couple of firms near you are starting to show up when people ask AI tools for a recommendation, and it's much easier to be early than to play catch-up later.
>
> Want it?
>
> Cheers,
> Kobi

---

## Email 3 — Day 6 (same thread)

> Hi {{first_name}},
>
> Last proper one from me on this, promise.
>
> This is what I do for a living, most recently for Dr Nigel Stephens (a consultant cardiologist) and Twiggy, yes, that Twiggy. Nigel just wanted to control how he came across when people compared him to other consultants, and honestly that's all this is.
>
> The audit's free, takes you two minutes to read, and it's yours whether you ever work with me or not.
>
> Want me to send it over?
>
> Cheers,
> Kobi

---

## Email 4 — Day 12 (same thread, breakup)

> Hi {{first_name}},
>
> I'll leave you in peace after this one.
>
> The audit I started for {{company_name}} is just sitting here, so if you ever want it, reply "audit" and I'll finish it up and send it over. If not, no worries at all, I'll stop landing in your inbox.
>
> Either way, all the best with the firm.
>
> Cheers,
> Kobi
> Kobestarr Digital

---

## Reply playbook

Every "yes" / "audit" reply needs an actual audit delivered same-day: where {{company_name}}
shows up in ChatGPT / Google AI Overview for "good {category} in {town}", where competitors do,
three fixes. Goal of every reply = booked call. Future build: auto-generate these per lead
(pipeline already has name/category/town) so the audit exists before they even reply.
