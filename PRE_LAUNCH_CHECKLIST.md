# 🚀 PRE-LAUNCH CHECKLIST - Monday Feb 16, 8:30 AM

**Campaign:** Professional Services Outreach
**Target:** 52 businesses in Bramhall SK7
**Launch Time:** Monday, February 16, 2026 at 8:30 AM

---

## 🚨 CRITICAL ISSUES (MUST FIX BEFORE LAUNCH)

### ❌ Issue 1: ALL EMAILS UNVERIFIED
**Status:** 52/52 leads show "Not verified" in Lemlist
**Risk:** High bounce rate → spam folder → account suspension
**Root Cause:** Export script skips email verification

**OPTIONS:**

#### Option A: Verify in Lemlist (RECOMMENDED - Quick)
1. Go to: https://app.lemlist.com/campaigns/cam_bJYSQ4pqMzasQWsRb
2. Select all 52 leads
3. Click "Verify emails" (bulk action)
4. Wait for verification (5-10 minutes)
5. Review results - remove any "invalid" or "risky" emails

**Expected Results:**
- ✅ Valid: ~40-45 leads (77-87%)
- ⚠️ Risky: ~5-7 leads (10-13%)
- ❌ Invalid: ~0-5 leads (0-10%)

**Action:** Remove "invalid" emails, consider keeping "risky" if personal Gmail addresses

---

#### Option B: Re-export with Verification (BETTER - Takes 30 min)
Create new export script that verifies BEFORE sending to Lemlist:

```bash
# I can create this script for you
node export-with-verification.js
```

**Benefits:**
- Only exports verified emails
- Saves Lemlist verification credits
- Higher quality leads
- Better tracking

---

### ❌ Issue 2: Missing Phone Numbers
**Status:** ~15-20 leads show "FIND PHONE" button
**Risk:** Lower engagement (phone enrichment helps)
**Fix:** Optional - can enrich later if needed

---

## ✅ LEMLIST CAMPAIGN CHECKLIST

### 1. Email Template Review
- [ ] Open campaign in Lemlist
- [ ] Check email template is set correctly
- [ ] Verify all merge variables populate ({{firstName}}, {{companyName}}, etc.)
- [ ] Send TEST email to yourself first!
- [ ] Check spam score (should be < 3)

**Expected merge variables:**
```
{{firstName}} - Owner name (or "there")
{{lastName}} - Last name
{{companyName}} - Business name
{{location}} - Bramhall, Stockport
{{businessType}} - accountants, solicitors, etc.
{{localIntro}} - Proximity-based intro
{{observationSignal}} - Business-specific hook
{{meetingOption}} - "meet in person" or "have a chat"
{{microOfferPrice}} - £97 to £485 (tiered)
{{multiOwnerNote}} - Acknowledgment if multiple contacts
{{noNameNote}} - Fallback if no name found
```

---

### 2. Campaign Schedule Settings
- [ ] Set start time: Monday, Feb 16, 2026 at 8:30 AM
- [ ] Set timezone: (UTC) Edinburgh, London
- [ ] Set sending window: 8:30 AM - 6:00 PM (business hours)
- [ ] Enable "Skip weekends" (don't send Sat/Sun)

---

### 3. Sending Limits & Warmup
**CRITICAL:** Don't send all 52 at once - warm up your account!

**Recommended Schedule:**
- **Week 1 (Feb 16-20):** 10 emails/day = 50 total
- **Week 2 (Feb 23-27):** 20 emails/day = 100 total
- **Week 3 (Mar 2-6):** 30 emails/day = 150 total
- **Week 4+:** 50 emails/day

**For Monday Feb 16 Launch:**
```
Day 1 (Mon): 10 emails
Day 2 (Tue): 10 emails
Day 3 (Wed): 10 emails
Day 4 (Thu): 10 emails
Day 5 (Fri): 12 emails
Total: 52 emails over 5 days
```

**Settings to configure:**
- [ ] Daily send limit: 10 emails/day (Week 1)
- [ ] Delay between emails: 5-10 minutes (randomized)
- [ ] Stop sending if bounce rate > 5%
- [ ] Stop sending if spam rate > 1%

---

### 4. Follow-up Sequences
- [ ] Set up Step 2 (follow-up after 3 days if no reply)
- [ ] Set up Step 3 (final follow-up after 7 days if no reply)
- [ ] Enable "Stop on reply" (don't send follow-ups if they respond)

**Recommended follow-up template (Step 2 - 3 days later):**
```
Hi {{firstName}},

Just wanted to quickly follow up on my message from earlier this week about {{companyName}}'s online presence.

I know you're busy, but I genuinely think I could help you get more {{businessType}} through your website.

Still open to {{meetingOption}} if you're interested?

Best,
Kobi
```

---

### 5. Tracking & Monitoring
- [ ] Enable open tracking
- [ ] Enable click tracking
- [ ] Enable reply detection
- [ ] Set up email notifications for replies
- [ ] Add calendar link for easy booking

---

## 📊 QUALITY REVIEW

### Lead Quality Breakdown (Expected)
Based on your 52 leads:

**By Category (5 per category × 12 = 60, actual = 52):**
- Accountants: ~5
- Solicitors: ~5
- Estate Agents: ~5
- Financial Advisors: ~4
- Insurance Brokers: ~4
- Mortgage Brokers: ~4
- Business Consultants: ~4
- IT Support: ~4
- Recruitment Agencies: ~4
- Architects: ~4
- Surveyors: ~4
- Engineers: ~4

**By Email Quality:**
- Personal emails (name@business.com): ~30 (58%)
- Generic emails (info@, enquiries@): ~22 (42%)
- Gmail addresses: ~15 (29%)

**By Name Quality:**
- Valid names: ~35 (67%)
- Fallback "there": ~17 (33%)

**By Pricing Tier:**
- Tier 1 (£97): ~10 (19%)
- Tier 2 (£145): ~8 (15%)
- Tier 3 (£194): ~12 (23%)
- Tier 4 (£291): ~14 (27%)
- Tier 5 (£485): ~8 (15%)

---

## 🎯 SUCCESS METRICS

### What to Track (First 2 Weeks)

**Email Performance:**
- Open rate target: >30% (industry avg: 20-25%)
- Reply rate target: >5% (industry avg: 1-3%)
- Bounce rate limit: <5% (acceptable)
- Spam rate limit: <1% (critical)

**Engagement Targets:**
- Positive replies: 3-5 (6-10%)
- Meetings booked: 1-2 (2-4%)
- Deals closed: 1 (2%)

**Red Flags to Watch:**
- Bounce rate >10% = Stop and fix
- Spam complaints >2 = Stop immediately
- Open rate <15% = Subject line issue
- No replies after 1 week = Template issue

---

## ⚠️ RISK ASSESSMENT

### HIGH RISK
1. **Unverified emails** - Fix immediately (see Issue 1)
2. **No warmup plan** - Don't send 52 at once!
3. **Generic subject line** - May get filtered

### MEDIUM RISK
1. **Missing phone numbers** - Can enrich later
2. **Multiple owners per business** - Some may get 2-3 emails
3. **Gmail addresses** - May have lower deliverability

### LOW RISK
1. **Fallback names** - "Hi there" is acceptable
2. **Tiered pricing** - Good personalization
3. **Local targeting** - All Bramhall SK7

---

## 🔧 TECHNICAL CHECKLIST

### Before Launch
- [ ] Backup current Lemlist campaign
- [ ] Test email deliverability (send to mail-tester.com)
- [ ] Verify SPF/DKIM/DMARC records are set
- [ ] Check sender reputation (Google Postmaster Tools)
- [ ] Prepare reply templates (quick responses)

### Monitoring Tools
- [ ] Lemlist dashboard (daily check)
- [ ] Email deliverability monitor
- [ ] Google Analytics (website traffic)
- [ ] Calendar booking system ready

---

## 📝 FINAL REVIEW (Sunday Night - Feb 15)

### T-12 Hours Checklist
1. [ ] All emails verified in Lemlist
2. [ ] Test email sent and reviewed
3. [ ] Campaign schedule set for 8:30 AM
4. [ ] Daily limit set to 10/day (Week 1)
5. [ ] Follow-up sequences configured
6. [ ] Phone on and ready to respond to replies
7. [ ] Calendar cleared for potential meetings
8. [ ] Reply templates prepared
9. [ ] Backup of campaign exported
10. [ ] Good night's sleep! 😴

---

## 🚀 LAUNCH DAY (Monday Feb 16, 8:30 AM)

### Morning Routine
1. **8:00 AM** - Final check of Lemlist settings
2. **8:15 AM** - Send test email to yourself
3. **8:25 AM** - Verify campaign is ready
4. **8:30 AM** - Campaign starts automatically
5. **9:00 AM** - Check first batch sent successfully
6. **12:00 PM** - Check open rates (first 2-3 hours)
7. **5:00 PM** - Check reply rate and respond immediately

### Throughout the Day
- Check Lemlist every 2-3 hours
- Respond to replies within 30 minutes
- Monitor bounce/spam rates
- Note any patterns in replies

---

## 🎉 SUCCESS CRITERIA

**Week 1 Goals:**
- ✅ 50+ emails sent (all verified)
- ✅ <5% bounce rate
- ✅ 0 spam complaints
- ✅ 30%+ open rate
- ✅ 3+ positive replies
- ✅ 1+ meeting booked

**If all green - continue to Week 2 with 20/day**
**If any red flags - pause and adjust**

---

## 📞 EMERGENCY CONTACTS

If something goes wrong:
- Lemlist Support: support@lemlist.com
- Email deliverability issues: Check sender reputation
- High bounce rate: Pause campaign immediately
- Spam complaints: Pause and review email content

---

**Last Updated:** February 14, 2026
**Campaign Manager:** Kobi Omenaka
**Campaign ID:** cam_bJYSQ4pqMzasQWsRb
**Total Leads:** 52
**Launch:** Monday, Feb 16, 2026 at 8:30 AM

---

**GOOD LUCK! 🚀**
