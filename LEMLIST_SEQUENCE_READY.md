# Lemlist Email Sequence - Production Ready
## Single Template with Dynamic Merge Variables

**Last Updated:** 2026-02-10
**Status:** ✅ Ready to Deploy

---

## 🎯 Copy-Paste This Into Lemlist

### Email 1 (Day 0) - Initial Outreach

**Subject Line:**
```
hi {{firstName}} quick thought for {{companyName}}
```

**Email Body:**
```
Hi {{firstName}},

{{multiOwnerNote}}{{localIntro}} I noticed {{companyName}} and {{observationSignal}}.

I help with things like keeping clients coming back, managing bookings, and getting your online presence sorted. I've worked with some interesting clients over the years (including Twiggy, yes the 60s fashion icon!), but I keep my prices pretty reasonable because I don't have the agency overheads.

From just {{microOfferPrice}} to get started – happy to {{meetingOption}} or I can share links to my work and we can have a chat on the phone.

Just reply to this email if you're interested.

Cheers,
Kobi

Sent from my iPhone
```

---

### Email 2 (Day 3) - Follow-Up

**Subject Line:**
```
re: {{companyName}}
```

**Email Body:**
```
Hi {{firstName}},

Following up on my email about {{companyName}} – I know you're probably busy, but wanted to check if you saw my message about helping with client retention and your online presence.

I've been working with {{businessType}} in the area, and it's been going really well. From just {{microOfferPrice}} to get started.

If you're interested, let me know and I can share links to my work or {{meetingOption}}.

Cheers,
Kobi

Sent from my iPhone
```

---

### Email 3 (Day 7) - Different Angle

**Subject Line:**
```
one more thing {{firstName}}
```

**Email Body:**
```
Hi {{firstName}},

I sent you a couple emails about {{companyName}} – didn't want to be a pest, but I had one more thought.

A lot of {{businessType}} I work with struggle with managing bookings and keeping track of clients. The systems I set up could help with that too – pretty flexible and straightforward.

From just {{microOfferPrice}} to get set up. Worth a quick chat?

Let me know if you're interested.

Cheers,
Kobi

Sent from my iPhone
```

---

### Email 4 (Day 14) - Final Attempt

**Subject Line:**
```
last one {{firstName}}
```

**Email Body:**
```
Hi {{firstName}},

This'll be my last email – I know I've reached out a few times about {{companyName}}.

If you're not interested in help with your online presence and client retention, no worries. But if you are curious, I'm happy to share links to my work or {{meetingOption}}. From just {{microOfferPrice}}.

Let me know – otherwise, I'll leave you alone!

Cheers,
Kobi

Sent from my iPhone
```

---

## 📊 Merge Variables Explained

These variables are **automatically populated** by the export script based on business data:

| Variable | Description | Example (Nearby) | Example (Far Away) |
|----------|-------------|------------------|---------------------|
| `{{firstName}}` | Owner first name | "Sarah" | "John" |
| `{{companyName}}` | Humanized business name | "KissDental" | "Elite Fitness" |
| `{{location}}` | City/town | "Bramhall" | "London" |
| `{{businessType}}` | Plural business type | "dentists" | "gyms" |
| `{{localIntro}}` | **Proximity-based intro** | "I'm Kobi, a digital marketing consultant based in Poynton, so pretty close to you!" | "I'm Kobi, a digital marketing consultant working with local businesses across the UK." |
| `{{observationSignal}}` | **Business-specific hook** | "saw you've built up a solid reputation online" | "noticed you don't have a website yet" |
| `{{meetingOption}}` | **Meeting offer** | "meet in person if that's easier" | "have a chat" |
| `{{microOfferPrice}}` | **Tiered pricing** | "£97" (tier5) or "£291" (tier2) | "$635" (tier1, US business) |
| `{{multiOwnerNote}}` | **Multi-owner acknowledgment** | "" (blank if single owner) | "Quick note – I'm also reaching out to Sarah and John since I wasn't sure who handles this at Elite Fitness. " |

---

## 🗺️ How Proximity Detection Works

**Nearby Postcodes (45 minutes from Poynton SK12):**

```
SK7   Bramhall, Hazel Grove
SK12  Poynton (your location)
SK6   High Lane, Disley
SK8   Cheadle
SK9   Alderley Edge, Wilmslow
SK10  Macclesfield
SK17  Buxton
SK22  New Mills, Hayfield
SK23  Whaley Bridge, Chapel-en-le-Frith
SK1-4 Stockport (all areas)
WA14  Altrincham
WA15  Hale, Bowdon
WA16  Knutsford
M20   Didsbury
M21   Chorlton
M22   Wythenshawe
M23   Baguley
M19   Levenshulme
M14   Fallowfield
M13   Ardwick, Longsight
```

**If business postcode starts with any of these → "based in Poynton, so pretty close to you!"**

**Otherwise → "working with local businesses across the UK."**

---

## 💰 How Tiered Pricing Works

The system calculates pricing based on business revenue tier:

| Tier | Business Profile | Multiplier | UK Price | US Price |
|------|-----------------|------------|----------|----------|
| **tier1** | High revenue (£500K+) | 5× | **£485** | **$635** |
| **tier2** | Medium-high (£250K-500K) | 3× | **£291** | **$381** |
| **tier3** | Medium (£100K-250K) | 2× | **£194** | **$254** |
| **tier4** | Medium-low (£50K-100K) | 1.5× | **£145** | **$190** |
| **tier5** | Low revenue (<£50K) | 1× | **£97** | **$127** |

**System automatically assigns tier based on:**
- Google rating (higher rating = higher tier)
- Review count (more reviews = higher tier)
- Website quality (better website = higher tier)
- Business category (professional services = higher tier)

---

## 🔍 Observation Signals

The system detects business characteristics and generates personalized hooks:

| Signal | Detection Criteria | Example Text |
|--------|-------------------|--------------|
| **highReviews** | 50+ reviews | "saw you've built up a solid reputation online" |
| **lowReviews** | < 10 reviews | "saw you're building up your online reputation" |
| **noWebsite** | No website listed | "noticed you don't have a website yet" |
| **poorWebsite** | HTTP only or DIY builder | "thought your website could use a refresh" |
| **noSocialMedia** | No Instagram/Facebook | "saw you could use help with social media" |
| **lowRating** | < 4.0 stars | "noticed you could improve your online presence" |

**System picks the most relevant signal per business automatically.**

---

## ✅ Setup Instructions

### Step 1: Configure Lemlist Campaign

1. Go to Lemlist → Create new campaign (or use existing)
2. Campaign Name: "Local Outreach - [Location]" (e.g., "Local Outreach - Bramhall SK7")

### Step 2: Add Email Sequence

1. Go to "Sequence" tab in campaign
2. Add **Email Step 1** (Day 0):
   - Copy-paste **Subject** and **Body** from Email 1 above
   - Delay: **0 days** after previous step
   - Enable tracking: Opens ✓, Clicks ✓

3. Add **Email Step 2** (Day 3):
   - Copy-paste **Subject** and **Body** from Email 2 above
   - Delay: **3 days** after previous step
   - Enable tracking: Opens ✓, Clicks ✓

4. Add **Email Step 3** (Day 7):
   - Copy-paste **Subject** and **Body** from Email 3 above
   - Delay: **7 days** after previous step
   - Enable tracking: Opens ✓, Clicks ✓

5. Add **Email Step 4** (Day 14):
   - Copy-paste **Subject** and **Body** from Email 4 above
   - Delay: **14 days** after previous step
   - Enable tracking: Opens ✓, Clicks ✓

6. Save campaign

### Step 3: Verify Merge Variables

Lemlist will auto-detect these merge variables:
- `{{firstName}}`
- `{{companyName}}`
- `{{location}}`
- `{{businessType}}`
- `{{localIntro}}`
- `{{observationSignal}}`
- `{{meetingOption}}`
- `{{microOfferPrice}}`

**No manual configuration needed!** The export script populates these automatically.

### Step 4: Export Businesses to Campaign

```bash
# Export single business
node ksd/local-outreach/orchestrator/utils/export-business.js "KissDental Bramhall"

# Or use resume-approval after approval workflow
node ksd/local-outreach/orchestrator/utils/resume-approval.js Bramhall SK7
```

The script will:
1. Calculate proximity (nearby vs far)
2. Detect observation signal (highReviews, noWebsite, etc.)
3. Calculate tiered pricing (tier1-tier5)
4. Generate all merge variables
5. Export lead to Lemlist with custom fields populated

### Step 5: Launch Campaign

1. Go to Lemlist campaign → "Settings"
2. Review sending schedule (e.g., Mon-Fri, 9am-5pm)
3. Click "Start Campaign"

**Done!** Emails will be sent automatically with personalized content.

---

## 📈 Expected Results

### Email 1 Examples

**Nearby Business (SK7 Bramhall dentist, tier2, single owner):**
> Hi Sarah,
>
> I'm Kobi, a digital marketing consultant based in Poynton, so pretty close to you! I noticed KissDental and saw you've built up a solid reputation online.
>
> I help with things like keeping clients coming back, managing bookings, and getting your online presence sorted. I've worked with some interesting clients over the years (including Twiggy, yes the 60s fashion icon!), but I keep my prices pretty reasonable because I don't have the agency overheads.
>
> From just £291 to get started – happy to meet in person if that's easier or I can share links to my work and we can have a chat on the phone.

**Nearby Business (SK7 Bramhall dentist, tier2, multiple owners):**
> Hi Sarah,
>
> Quick note – I'm also reaching out to John and Emma since I wasn't sure who handles this at KissDental. I'm Kobi, a digital marketing consultant based in Poynton, so pretty close to you! I noticed KissDental and saw you've built up a solid reputation online.
>
> I help with things like keeping clients coming back, managing bookings, and getting your online presence sorted. I've worked with some interesting clients over the years (including Twiggy, yes the 60s fashion icon!), but I keep my prices pretty reasonable because I don't have the agency overheads.
>
> From just £291 to get started – happy to meet in person if that's easier or I can share links to my work and we can have a chat on the phone.

**Far Business (London gym, tier1):**
> Hi John,
>
> I'm Kobi, a digital marketing consultant working with local businesses across the UK. I noticed Elite Fitness and thought your website could use a refresh.
>
> I help with things like keeping clients coming back, managing bookings, and getting your online presence sorted. I've worked with some interesting clients over the years (including Twiggy, yes the 60s fashion icon!), but I keep my prices pretty reasonable because I don't have the agency overheads.
>
> From just £485 to get started – happy to have a chat or I can share links to my work and we can have a chat on the phone.

---

## 🧪 Testing Before Launch

### Test with Sample Businesses

1. **Nearby Business:**
   ```bash
   node ksd/local-outreach/orchestrator/utils/export-business.js "KissDental Bramhall" --dry-run
   ```
   - Verify: `localIntro` mentions "Poynton, so pretty close to you!"
   - Verify: `meetingOption` says "meet in person"
   - Verify: Pricing matches tier (check `microOfferPrice`)

2. **Far Business (Manual Test):**
   - Create test business with London postcode (SW1)
   - Export to test campaign
   - Verify: `localIntro` mentions "across the UK"
   - Verify: `meetingOption` says "have a chat"

### Check Lemlist UI

1. Go to campaign → Leads tab
2. Click on a test lead
3. Preview Email 1
4. Verify all merge variables populated correctly
5. Check that {{firstName}}, {{localIntro}}, {{observationSignal}} all make sense

---

## 🔧 Troubleshooting

### Issue: Merge variables showing as {{variable}} in sent emails

**Cause:** Custom fields not populated during export

**Fix:**
1. Check export script ran successfully
2. Verify `getAllMergeVariables()` is being called
3. Check logs: `tail -f logs/outreach.log` for merge variable generation
4. Re-export lead with corrected script

### Issue: Pricing shows wrong tier

**Cause:** Business tier not assigned correctly

**Fix:**
1. Check business data has: `assignedOfferTier` field
2. If missing, system defaults to tier5 (£97)
3. Re-run tier assignment: `node utils/assign-tiers.js`
4. Re-export business

### Issue: "based in Poynton" showing for London business

**Cause:** Postcode not detected correctly

**Fix:**
1. Check business has `postcode` field populated
2. Verify postcode format (e.g., "SW1A 1AA", not "SW1A1AA")
3. Add postcode prefix to nearby list if needed: `addNearbyPostcode('SW1')`

---

## 📝 Notes

- **Twiggy social proof** is included in ALL emails (universal credibility)
- **"Sent from my iPhone"** adds authenticity (looks like real person, not automated)
- **No AI mentions** in emails (focus is on digital marketing services)
- **Tone is casual** but professional (UK business owner style)
- **Prices are reasonable** message disarms "too expensive" objection upfront

---

## 🎉 You're Ready!

1. ✅ Copy-paste email templates into Lemlist
2. ✅ Merge variables configured automatically
3. ✅ Proximity detection working
4. ✅ Tiered pricing implemented
5. ✅ Observation signals personalized

**Just export your businesses and launch the campaign!**

Questions? Check the logs or read `email-merge-variables.js` for implementation details.
