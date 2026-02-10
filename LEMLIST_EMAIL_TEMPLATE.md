# Lemlist Email Template

Copy this exact template into your Lemlist campaign.

---

## Subject Line

```
Quick website question for {{companyName}}
```

---

## Email Body

```
Hi {{firstName}},

{{multiOwnerNote}}{{localIntro}}I'm reaching out to {{businessType}} in your area about their online presence.

{{observationSignal}}

I help local {{businessType}} improve their websites and get more {{businessType}} through Google. I'd love to show you what I could do for {{companyName}}.

Would you be open to {{meetingOption}} to discuss?

I can start with a micro-offer at just {{microOfferPrice}} to prove value first.

Best regards,
Kobi

P.S. - I'm based locally in Poynton, so I understand the {{location}} market well.

Sent from my iPhone
```

---

## Fallback Template (No Name)

If `{{firstName}}` is empty, Lemlist will use this:

```
Hi there,

{{noNameNote}}{{localIntro}}I'm reaching out to {{businessType}} in your area about their online presence.

{{observationSignal}}

I help local {{businessType}} improve their websites and get more {{businessType}} through Google. I'd love to show you what I could do for {{companyName}}.

Would you be open to {{meetingOption}} to discuss?

I can start with a micro-offer at just {{microOfferPrice}} to prove value first.

Best regards,
Kobi

P.S. - I'm based locally in Poynton, so I understand the {{location}} market well.

Sent from my iPhone
```

---

## Merge Variables Being Used

All of these are automatically populated by the export script:

- `{{firstName}}` - Owner's first name (or "there" if not found)
- `{{lastName}}` - Owner's last name
- `{{companyName}}` - Business name
- `{{location}}` - City/area (e.g., "Bramhall")
- `{{businessType}}` - Type of business (e.g., "dentists")
- `{{tier}}` - tier1-tier5 (for pricing)
- `{{microOfferPrice}}` - Tiered price (£97-£485)
- `{{isNearby}}` - true/false (within 45 mins)
- `{{localIntro}}` - "I'm Kobi, a digital marketing consultant based in Poynton, so pretty close to you!" or UK-wide version
- `{{observationSignal}}` - Business-specific hook (low reviews, no website, etc.)
- `{{meetingOption}}` - "meet in person if that's easier" or "jump on a quick call"
- `{{multiOwnerNote}}` - "Quick note – I'm also reaching out to X, Y, and Z..." (capped at 5, Oxford comma)
- `{{noNameNote}}` - Fallback acknowledgment when no name found

---

## How to Set Up in Lemlist

1. Go to your campaign: https://app.lemlist.com/campaigns/cam_bJYSQ4pqMzasQWsRb
2. Click "Edit Email Template"
3. Copy the template above
4. Paste into Lemlist email body
5. Lemlist will automatically detect the `{{mergeVariables}}`
6. Save template
7. **Send test email to yourself first!**

---

## Important Notes

- **"Sent from my iPhone"** makes it look more casual/personal
- **Multi-owner note** only shows when multiple owners found (with Oxford comma)
- **Local intro** adjusts based on proximity (nearby vs UK-wide)
- **Observation signal** is personalized per business (reviews, website quality, etc.)
- **Meeting option** changes based on proximity (in-person vs phone)
- **Tiered pricing** adjusts based on business size (£97-£485)

---

## Example Output

**For Arundel Dental Practice (Multi-owner, Nearby, Tier 3):**

> Hi Amanda,
>
> Quick note – I'm also reaching out to Zoe, Christopher, Michael, Barbara, and Nicola since I wasn't sure who handles this at Arundel Dental Practice. I'm Kobi, a digital marketing consultant based in Poynton, so pretty close to you!
>
> I'm reaching out to dentists in your area about their online presence.
>
> saw you're building up your online reputation
>
> I help local dentists improve their websites and get more dentists through Google. I'd love to show you what I could do for Arundel Dental Practice.
>
> Would you be open to meet in person if that's easier to discuss?
>
> I can start with a micro-offer at just £194 to prove value first.
>
> Best regards,
> Kobi
>
> P.S. - I'm based locally in Poynton, so I understand the Bramhall market well.
>
> Sent from my iPhone

---

**Ready to send!** 🚀
