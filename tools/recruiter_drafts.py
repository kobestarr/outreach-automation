#!/usr/bin/env python3
"""Turn the recruiter research (one live role per named recruiter) into Gmail drafts.json.

Each email opens on a role the recruiter is working on. Variants:
  fit     the role suits Kobi and the location works: "I think I'd be a strong fit"
  close   suits him but needs office days elsewhere: "if the client is flexible on location"
  other   not his role: "probably not me for that one, but here's my CV for other roles"
  desk    no live role found: opens on the desk they run
The CV attached matches the role's category. Unverifiable emails are held, never drafted.

Usage: python3 tools/recruiter_drafts.py <recruiters.csv> <out drafts.json> [--available "December"]
recruiters.csv columns: first_name,last_name,email,email_ok,agency,role,client,location,variant,category
"""
import csv, json, os, sys

CV_DIR = os.path.expanduser("~/Easy Access Files to Share/CVs 2026-10")
CVS = {
    "automation": "Kobi Omenaka CV - Marketing Automation and CRM.pdf",
    "paid": "Kobi Omenaka CV - Paid Media.pdf",
    "ai": "Kobi Omenaka CV - AI Automation.pdf",
    "seo": "Kobi Omenaka CV - SEO and AI Search.pdf",
    "fractional": "Kobi Omenaka CV - Fractional Marketing Ops.pdf",
    "master": "Kobi Omenaka CV.pdf",
}
WHY = {
    "automation": "I run marketing automation and CRM day to day (Marketo, Salesforce, HubSpot), and at Bluprintx I built AI lead scoring and routing that gets scored leads to sales within 15 minutes.",
    "paid": "I managed a £100k-a-week paid search budget at Entain and now run B2B LinkedIn and Reddit Ads at Bluprintx.",
    "ai": "I build marketing automation with Claude and Claude Code, including an AI marketer that lifted qualified leads by 40% at Bluprintx.",
    "seo": "I've led SEO and AI search work, most recently a ground-up website rebuild that took inbound leads from under 1 to 10 a month.",
    "fractional": "I plug into in-house teams and run the systems behind them: outbound, marketing automation, reporting and AI.",
    "master": "I've spent 10+ years in B2B growth, most recently in a 5-person team that generated over £2.5m of net-new pipeline at Bluprintx this year.",
}
PROOF = ("Short version: most recently at Bluprintx, in a 5-person marketing team that generated over £2.5m of "
         "net-new pipeline this year. Before that, a £100k-a-week paid search budget at Entain.")
DESK = {"automation": "marketing automation and CRM", "paid": "paid media", "seo": "SEO and organic",
        "ai": "marketing automation and AI", "master": "digital marketing and growth", "fractional": "interim and freelance marketing"}
SENIOR = ("head of", "senior", "lead", "director", "vp ")
SIGN = "Cheers,\nKobi\n\nKobi Omenaka\n+44 7989 746146\nlinkedin.com/in/kobiomenaka"


def role_phrase(r):
    return f"the {r['role']} role" + (f" at {r['client']}" if r.get("client") else "")


def build(r, available):
    hi = f"Hi {r['first_name']}," if r.get("first_name") else "Hi there,"
    v, cat = r["variant"], r["category"]
    # Kobi is not going for head, senior, lead or director roles: those hooks always use the "not this one" version
    if v in ("fit", "close") and any(w in r["role"].lower() for w in SENIOR):
        v = "other"
    close = "If anything you're working on could suit, I'd love a quick chat."
    if v == "desk":
        subject = f"Candidate for your {DESK[cat]} desk, available {available}"
        opener = f"I saw you look after {DESK[cat]} roles at {r['agency']}."
        middle = (f"I'm available for remote contract or permanent work from {available}, across marketing automation and CRM, "
                  f"AI automation, paid media and SEO. My CV's attached.\n\n{PROOF}")
    elif v in ("fit", "close"):
        subject = f"{r['role']}: candidate, available {available}"
        opener = f"I saw you're recruiting for {role_phrase(r)}."
        if v == "fit":
            middle = (f"I think I'd be a strong fit, so I've attached my CV. {WHY[cat]}\n\n"
                      f"Remote from Manchester, contract or permanent, available from {available}.")
            close = "Happy to talk it through this week, or put me forward if it looks right."
        else:
            middle = (f"It's close to my background, so I've attached my CV. {WHY[cat]}\n\nI'm based in Manchester and work "
                      f"remotely, so if the client is flexible on location I'd love to be put forward. If not, I'd be a good fit "
                      f"for other {DESK[cat]} roles. Available from {available}.")
    else:
        subject = f"Saw your {r['role']} post (candidate, available {available})"
        opener = f"I saw you're recruiting for {role_phrase(r)}."
        middle = (f"That one's not quite me, but I'm available for remote contract or permanent work from {available}, "
                  f"and I'd be a good fit for other {DESK[cat]} roles. My CV's attached.\n\n{PROOF}")
    if r.get("first_name"):  # Kobi: their first name always leads the subject
        subject = f"{r['first_name']}, {subject[0].lower() + subject[1:] if subject.startswith(('Saw', 'Candidate')) else subject}"
    extra = (r.get("extra") or "").strip()  # one hand-written line for this recruiter, after the opener
    body = f"{hi}\n\n{opener} {middle}\n\n" + (f"{extra}\n\n" if extra else "") + f"{close}\n\n{SIGN}"
    return {"to": r["email"], "subject": subject, "body": body, "attach": os.path.join(CV_DIR, CVS[cat])}


def main(argv):
    if len(argv) < 3:
        raise SystemExit(__doc__)
    available = argv[argv.index("--available") + 1] if "--available" in argv else "December"
    rows = list(csv.DictReader(open(argv[1])))
    drafts, held = [], []
    for r in rows:
        (drafts if r["email_ok"] == "yes" else held).append(r)
    if "--day1" in argv:  # one recruiter per agency today; the rest go out two or more days later
        seen, first, later = set(), [], []
        for r in drafts:
            (later if r["agency"] in seen else first).append(r)
            seen.add(r["agency"])
        drafts = first
        print(f"day 1: {len(first)} (one per agency); later: " + ", ".join(f"{r['first_name']} ({r['agency']})" for r in later))
    out = [build(r, available) for r in drafts]
    json.dump(out, open(argv[2], "w"), indent=1, ensure_ascii=False)
    print(f"{len(out)} drafts written, {len(held)} held (email not verifiable): "
          + ", ".join(f"{h['first_name']} {h['last_name']} ({h['agency']})" for h in held))


if __name__ == "__main__":
    main(sys.argv)
