#!/usr/bin/env python3
"""Hiring-manager email 1 as Gmail drafts (Kobi sends them himself from kobestarr@gmail.com).

Agreed wording, 20 Oct 2026: the role itself, interim cover while they hire, one proof line, a soft ask.
Day 3 and day 7 follow-ups are drafted later as replies in the same thread (see FOLLOW_UPS).

Usage: python3 tools/hiring_manager_drafts.py <managers.csv> <out drafts.json>
managers.csv columns: first_name,email,company,role,category   (category picks the CV and the proof line)
"""
import csv, json, os, sys

CV_DIR = os.path.expanduser("~/Easy Access Files to Share/CVs 2026-10")
CVS = {
    "automation": "Kobi Omenaka CV - Marketing Automation and CRM.pdf",
    "paid": "Kobi Omenaka CV - Paid Media.pdf",
    "ai": "Kobi Omenaka CV - AI Automation.pdf",
    "seo": "Kobi Omenaka CV - SEO and AI Search.pdf",
    "master": "Kobi Omenaka CV.pdf",
}
PROOF = {
    "default": "For a bit of context, I've spent the last year building the marketing automation and AI side at Bluprintx, where we've brought in over £2.5m of new pipeline this year.",
    "paid": "For a bit of context, I've run paid media from small budgets right up to $500k a month, and I've spent the last year building the marketing automation and AI side at Bluprintx, where we've brought in over £2.5m of new pipeline this year.",
}
SIGN = "Cheers,\nKobi\n\nKobi Omenaka\n+44 7989 746146\nlinkedin.com/in/kobiomenaka"

FOLLOW_UPS = {
    "day3": ("Hi {first}, just floating this back up in case it got lost. Even if the role isn't quite the right fit, I help teams with "
             "a fair bit beyond it: marketing automation and CRM, AI automation, paid media (from small budgets right up to $500k a month), "
             "SEO, and podcasts and content. For a sense of results, an AI marketer I built lifted qualified leads by 40%, and one podcast "
             "we produced brought its business over £500k. If any of that would help, I'd love to chat."),
    "day7": ("Hi {first}, last nudge from me, promise. If you've already found someone, congratulations. And if there's other marketing "
             "work where an extra pair of hands would help, I'm around from November and would love to hear about it."),
}


def build(r):
    first, role, company, cat = r["first_name"], r["role"], r["company"], r["category"]
    body = (f"Hi {first},\n\n"
            f"I saw you're hiring a {role} at {company}, and it looks right up my street, so I've attached my CV in case it's a fit.\n\n"
            f"If it helps while you're hiring, I could also step in on an interim basis and keep things moving until the right person starts.\n\n"
            f"{PROOF.get(cat, PROOF['default'])} I'm based in Manchester, work remotely, and I'm free from November.\n\n"
            f"Would a quick chat be useful before you go through the applications?\n\n{SIGN}")
    return {"to": r["email"], "subject": f"{first}, your {role} role", "body": body, "attach": os.path.join(CV_DIR, CVS[cat])}


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    rows = list(csv.DictReader(open(sys.argv[1])))
    json.dump([build(r) for r in rows], open(sys.argv[2], "w"), indent=1, ensure_ascii=False)
    print(f"{len(rows)} hiring-manager drafts written to {sys.argv[2]}")
