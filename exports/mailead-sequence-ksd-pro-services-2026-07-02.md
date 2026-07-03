# Mailead sequence — ksd-pro-services-2026-07-02 (PASTE-READY)

Campaign id **8890**. Paste each email into the Mailead sequence editor.
Adapted from the locked pilot copy (`pilot-ksd-pro-services-sequence.md`) for the **carrier upload**:
the insight phrase is packed into each lead's **Last Name**, so `{{last_name}}` renders the insight, NOT a surname.

**Tokens available in this upload (only these 4 — anything else renders blank):**
`{{first_name}}` · `{{last_name}}` (= insight phrase) · `{{email}}` · `{{company_name}}`

> ⚠️ Two canary leads (peter@bevan.co.uk, nmistry@hurst.co.uk) have an EMPTY Last Name, so Email 1
> would render "...saw Bevan & Co ." with a gap. **Delete these 2 from the campaign before starting the send.**

Send rules: first touch **Mon-Thu only** (never Friday), send from the KSD identity mailboxes.

---

## Email 1 — Day 0

**Subject:** `AI search for {{company_name}} {{first_name}}`

> Hi {{first_name}},
>
> I had a quick look and saw {{company_name}} {{last_name}}.
>
> Easily sorted though.
>
> I recently did exactly this for Twiggy (yes, that Twiggy), and also for my window cleaner near me in South Manchester. He's a lovely guy and now his phone won't stop ringing! I'm sure if I can get him found, I can definitely do the same for you and {{company_name}}.
>
> Want me to share the three things I'd start with? No worries if not. I'm also happy to share the WhatsApp messages from the window cleaner telling me about all the phone calls if that helps...
>
> Cheers,
> Kobi

*Renders e.g.:* "I had a quick look and saw Langricks doesn't really come up in AI Search such as Google AI Overview or ChatGPT when people ask for a good accountant in Wilmslow."

---

## Email 2 — Day 3 (same thread, blank subject)

**FIXED: removed `{{town}}` and `{{category}}` (not in this upload — would render blank).**

> Hi {{first_name}},
>
> Just bumping this up your inbox in case it got buried.
>
> Quick version: a couple of firms near you are starting to show up when people ask AI for a recommendation, and most aren't yet. Much easier to be early than to play catch-up later.
>
> Want me to show you where {{company_name}} sits right now?
>
> Cheers,
> Kobi

---

## Email 3 — Day 6 (same thread, the real pitch)

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

---

## Email 4 — Day 12 (same thread, breakup)

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
