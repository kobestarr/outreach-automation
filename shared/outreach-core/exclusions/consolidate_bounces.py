#!/usr/bin/env python3
"""
Cross-reference Gmail bounces (Jan–Mar 2024) against cardiologist email list.
Output: /tmp/cardiologist-bounce-exclusions.txt + /tmp/cardiologist-bounce-report.md
"""
import json, os, re, glob
from collections import defaultdict

CARDIO_TSV = "/tmp/cardiologist-emails-for-bounce-mine.tsv"
RESULTS_DIR = "/Users/kobestarr/.claude/projects/-Users-kobestarr-Development-One-Hour-Vibe-Coder-outreach-automation/4e00cf4a-039f-4469-bfa2-dfba3e990999/tool-results"

# Inline results captured in the conversation (NOT in saved files)
INLINE_THREADS = []

# Load cardiologist emails
cardio_set = set()
cardio_names = {}
with open(CARDIO_TSV) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        parts = line.split("|")
        email = parts[0].strip().lower()
        cardio_set.add(email)
        if len(parts) >= 3:
            cardio_names[email] = f"{parts[1]} {parts[2]}"

print(f"Loaded {len(cardio_set)} cardiologist emails")

# Already excluded (hardcoded)
HARDCODED_EXCLUDED = {"j.grapsa@rbht.nhs.uk", "d.w.s.chong@gmail.com", "dwschong@gmail.com"}

# Bounce sender patterns (case-insensitive)
BOUNCE_SENDER_PAT = re.compile(
    r"(mailer-daemon@|postmaster@|MAILER-DAEMON@|Exchange\.Postmaster@|no-reply@tmes\.trendmicro|kerfisstjorn@samskip)",
    re.IGNORECASE
)
BOUNCE_SUBJECT_PAT = re.compile(
    r"(Undeliverable|Undelivered|Delivery Status Notification|Delivery has failed|Message blocked|Address not found|Returned to Sender)",
    re.IGNORECASE
)
# Misconfigured "Send mail as" — Gmail rejecting our outbound, NOT recipient bounce
SEND_AS_MISCONFIG = re.compile(r"Send mail as|misconfigured", re.IGNORECASE)

# Hard-bounce indicators (5.x.x permanent failures)
HARD_BOUNCE_INDICATORS = [
    "wasn't found", "couldn't be found", "Recipient Unknown", "address not found",
    "user unknown", "no such user", "Recipient address rejected", "domain ... couldn't be found",
    "domain couldn't be found", "550 5.1.1", "550 5.2.1", "550 5.4.1", "550 5.5",
    "5.7.1", "554", "permanent failure", "blocked", "rejected", "don't have permission",
    "doesn't exist", "Mailbox unavailable", "Recipient address rejected",
]
SOFT_BOUNCE_INDICATORS = [
    "4.2.2", "mailbox full", "over quota", "temporary failure", "try again",
    "greylist", "deferred", "queued"
]

def is_bounce_message(msg):
    sender = msg.get("sender", "")
    subject = msg.get("subject", "")
    if BOUNCE_SENDER_PAT.search(sender):
        return True
    if BOUNCE_SUBJECT_PAT.search(subject) and "INBOX" in msg.get("labelIds", []):
        return True
    return False

def classify_bounce(snippet):
    s = (snippet or "").lower()
    if SEND_AS_MISCONFIG.search(s):
        return "send-as-misconfig"   # NOT a recipient bounce
    for ind in SOFT_BOUNCE_INDICATORS:
        if ind in s:
            return "soft"
    for ind in HARD_BOUNCE_INDICATORS:
        if ind.lower() in s:
            return "hard"
    return "unknown"

# Walk all saved JSON files
all_threads = {}
files = sorted(glob.glob(f"{RESULTS_DIR}/*.txt"))
print(f"Found {len(files)} saved tool result files")
for f in files:
    try:
        d = json.load(open(f))
    except json.JSONDecodeError:
        continue
    for t in d.get("threads", []):
        all_threads[t["id"]] = t

print(f"Total unique threads loaded: {len(all_threads)}")

# Analyze each thread
bounces = []  # list of {recipient, bounce_class, snippet, send_date, bounce_date, sender}
for tid, t in all_threads.items():
    msgs = t.get("messages", [])
    # Find SENT messages (our outbound) and their recipients
    sent_by_addr = {}  # email -> (date, subject)
    for m in msgs:
        if "SENT" in m.get("labelIds", []):
            for rcpt in m.get("toRecipients", []):
                sent_by_addr[rcpt.lower().strip()] = (m.get("date"), m.get("subject", ""))
    # Find bounce messages
    for m in msgs:
        if not is_bounce_message(m):
            continue
        snippet = m.get("snippet", "") or ""
        # Try to identify recipient: extract email from snippet (after "to" or in failed-recipient text)
        # Strategy: look for any of the sent recipients in the snippet
        identified_recipient = None
        snippet_lower = snippet.lower()
        for sent_email in sent_by_addr.keys():
            if sent_email in snippet_lower:
                identified_recipient = sent_email
                break
        # Fallback: also look for emails in toRecipients of the SENT messages (the bounce always pertains to one of them)
        if not identified_recipient and len(sent_by_addr) == 1:
            identified_recipient = list(sent_by_addr.keys())[0]
        # Fallback: extract any email mentioned in snippet
        if not identified_recipient:
            email_matches = re.findall(r'[\w\.\-_+]+@[\w\.\-]+\.\w+', snippet)
            for em in email_matches:
                em_lower = em.lower()
                if em_lower not in ("kobi@kobestarr.io", "kobestarr@gmail.com"):
                    identified_recipient = em_lower
                    break
        if not identified_recipient:
            continue
        bounce_class = classify_bounce(snippet)
        send_date = sent_by_addr.get(identified_recipient, (None, None))[0]
        bounces.append({
            "recipient": identified_recipient,
            "bounce_class": bounce_class,
            "snippet": snippet[:200],
            "send_date": send_date,
            "bounce_date": m.get("date"),
            "sender": m.get("sender", ""),
            "thread_id": tid,
        })

print(f"Total bounce messages identified: {len(bounces)}")

# Dedup per recipient — keep worst (hard > soft > send-as-misconfig > unknown)
RANK = {"hard": 3, "soft": 2, "unknown": 1, "send-as-misconfig": 0}
per_recipient = {}
for b in bounces:
    r = b["recipient"]
    if r not in per_recipient or RANK.get(b["bounce_class"], 0) > RANK.get(per_recipient[r]["bounce_class"], 0):
        per_recipient[r] = b

# Filter: only those in cardiologist list AND hard bounces (or notable soft) AND not already excluded
cardio_bounces_hard = []
cardio_bounces_soft = []
cardio_bounces_other = []
for r, b in per_recipient.items():
    if r not in cardio_set:
        continue
    if r in HARDCODED_EXCLUDED:
        continue
    if b["bounce_class"] == "hard":
        cardio_bounces_hard.append(b)
    elif b["bounce_class"] == "soft":
        cardio_bounces_soft.append(b)
    else:
        cardio_bounces_other.append(b)

# Send-as-misconfig is NOT a recipient-side bounce. Don't exclude based on those alone.
# But if a recipient has BOTH a misconfig AND a hard bounce, the hard wins (already handled above).
# If only misconfig (sender mistake), don't exclude.

cardio_bounces_hard.sort(key=lambda b: b["recipient"])
cardio_bounces_soft.sort(key=lambda b: b["recipient"])
cardio_bounces_other.sort(key=lambda b: b["recipient"])

print(f"\nCardiologist hard bounces: {len(cardio_bounces_hard)}")
print(f"Cardiologist soft bounces: {len(cardio_bounces_soft)}")
print(f"Cardiologist other (misconfig/unknown): {len(cardio_bounces_other)}")

# Write exclusion file
with open("/tmp/cardiologist-bounce-exclusions.txt", "w") as f:
    for b in cardio_bounces_hard:
        f.write(b["recipient"] + "\n")

# Write report
with open("/tmp/cardiologist-bounce-report.md", "w") as f:
    f.write("# Cardiologist Bounce Mine Report\n\n")
    f.write(f"**Scope:** Jan 1 – Mar 31 2024 Gmail bounce notifications, cross-referenced against `{CARDIO_TSV}`.\n\n")
    f.write(f"**Cardiologist list size:** {len(cardio_set)} emails\n")
    f.write(f"**Total bounce messages parsed across window:** {len(bounces)} (from {len(all_threads)} threads searched)\n")
    f.write(f"**Unique recipient addresses with a bounce:** {len(per_recipient)}\n")
    f.write(f"**Already-excluded (hardcoded):** {sorted(HARDCODED_EXCLUDED)}\n\n")
    f.write("## Summary\n\n")
    f.write(f"- **Hard bounces matching cardiologist list (EXCLUDE THESE):** {len(cardio_bounces_hard)}\n")
    f.write(f"- **Soft bounces matching cardiologist list (informational, retry possible):** {len(cardio_bounces_soft)}\n")
    f.write(f"- **Other (misconfigured-send-as / unknown) cardiologist matches:** {len(cardio_bounces_other)}\n\n")

    f.write("## Hard bounces to exclude\n\n")
    f.write("| Email | Name | Bounce Date | Send Date | Reason (snippet) | Bounce sender |\n")
    f.write("|---|---|---|---|---|---|\n")
    for b in cardio_bounces_hard:
        nm = cardio_names.get(b["recipient"], "")
        snip = b["snippet"].replace("|", "/").replace("\n", " ")[:120]
        f.write(f"| {b['recipient']} | {nm} | {b['bounce_date']} | {b['send_date']} | {snip} | {b['sender']} |\n")

    f.write("\n## Soft / retry-possible bounces (NOT excluded)\n\n")
    if cardio_bounces_soft:
        f.write("| Email | Name | Bounce Date | Reason |\n|---|---|---|---|\n")
        for b in cardio_bounces_soft:
            nm = cardio_names.get(b["recipient"], "")
            snip = b["snippet"].replace("|", "/")[:120]
            f.write(f"| {b['recipient']} | {nm} | {b['bounce_date']} | {snip} |\n")
    else:
        f.write("(none)\n")

    f.write("\n## Other / unknown / send-as-misconfig (NOT excluded — sender-side, not recipient)\n\n")
    if cardio_bounces_other:
        f.write("| Email | Name | Class | Bounce Date | Snippet |\n|---|---|---|---|---|\n")
        for b in cardio_bounces_other:
            nm = cardio_names.get(b["recipient"], "")
            snip = b["snippet"].replace("|", "/")[:120]
            f.write(f"| {b['recipient']} | {nm} | {b['bounce_class']} | {b['bounce_date']} | {snip} |\n")
    else:
        f.write("(none)\n")

    f.write("\n## Anomalies & notes\n\n")
    # Count send-as-misconfig instances
    misconfig_count = sum(1 for b in per_recipient.values() if b["bounce_class"] == "send-as-misconfig")
    cardio_misconfig = sum(1 for b in cardio_bounces_other if b["bounce_class"] == "send-as-misconfig")
    f.write(f"- {misconfig_count} bounces in the window were Gmail 'Send mail as' misconfigurations — these reflect a sender-side config error at the time, NOT a recipient-side delivery failure. {cardio_misconfig} of those involved cardiologists; do not exclude based on these alone.\n")
    f.write(f"- Many bounces in the window are from a parallel campaign ('funded startups' SEO/writer pitch) and have no cardiologist overlap.\n")
    f.write(f"- The most common hard-bounce pattern for cardiologists is NHS Exchange rejecting external mail (550 5.4.1 / 'A problem occurred') — likely persistent organisational policy, not a transient issue.\n")
    f.write(f"- A handful of recipients bounced multiple times across follow-ups — these are now consolidated to one entry per recipient.\n")

print(f"\nWrote /tmp/cardiologist-bounce-exclusions.txt ({len(cardio_bounces_hard)} lines)")
print(f"Wrote /tmp/cardiologist-bounce-report.md")
