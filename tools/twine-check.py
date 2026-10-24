#!/usr/bin/env python3
"""Twine Instant alert check: scan Gmail for new Twine job alerts, post the fits to Buzz ~outreach.

Run every 4 hours by LaunchAgent com.kobestarr.twine-check. Read-only on Gmail (IMAP, app password from
~/.credentials/api-keys.json). Never applies, never replies. Kobi decides.
Seen alerts are ledgered by Message-ID in ~/.config/outreach-alerts/twine-seen.txt.

Usage: twine-check.py [--dry-run] [--since-days N]   (first run looks back N days, default 2)
"""
import argparse, datetime, email, imaplib, json, os, re, subprocess, sys, urllib.parse
from email.header import decode_header, make_header

STATE = os.path.expanduser("~/.config/outreach-alerts/twine-seen.txt")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = "/usr/local/bin/node"
# Fit rule: remote/digital only, not developer, not on-site, not UGC creator.
SKIP = re.compile(r"on[- ]?site|in[- ]person|in the office|\bUGC\b|developer|engineer|videograph|photograph|\bactor\b|\bmodel\b|influencer|\bcreator\b|translator", re.I)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--since-days", type=int, default=2)
    a = ap.parse_args()
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    seen = set(open(STATE).read().split()) if os.path.exists(STATE) else set()
    d = json.load(open(os.path.expanduser("~/.credentials/api-keys.json")))["gmailAccounts"]["kobestarr@gmail.com"]
    m = imaplib.IMAP4_SSL("imap.gmail.com"); m.login(d["user"], d["appPassword"]); m.select('"[Gmail]/All Mail"', readonly=True)
    since = (datetime.date.today() - datetime.timedelta(days=a.since_days)).strftime("%d-%b-%Y")
    ids = m.search(None, f'(FROM "twinehq.com" SINCE {since})')[1][0].split()
    fits, skipped, new_ids = [], 0, []
    for i in ids:
        msg = email.message_from_bytes(m.fetch(i, "(RFC822)")[1][0][1])
        mid = (msg["Message-ID"] or "").strip()
        if not mid or mid in seen: continue
        new_ids.append(mid)
        subj = str(make_header(decode_header(msg["Subject"]))).replace("\n", " ")
        title = re.sub(r"^\W*New .*? Opportunity:\s*", "", subj)
        html = next((p.get_payload(decode=True).decode(errors="replace") for p in msg.walk() if p.get_content_type() == "text/html"), "")
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"(?s)<style.*?</style>", "", html)))
        blurb = re.search(r"A new job matches your profile \d*\s*(.{20,220}?)(?:\s{2,}|$)", text)
        blurb = blurb.group(1).strip() if blurb else ""
        link = ""
        for h in re.findall(r'href="([^"]+)"', html):
            u = urllib.parse.unquote(h)
            r = re.search(r"(https://www\.twine\.net/projects/[^?&\s]+)", u)
            if r: link = r.group(1); break
        if SKIP.search(subj) or SKIP.search(blurb[:120]): skipped += 1; continue
        fits.append(f"- {title}" + (f" ({blurb})" if blurb else "") + f"\n  {link}")
    if fits:
        msg = f"Twine: {len(fits)} new brief(s) to read in full ({skipped} filtered out: on-site, developer, UGC). Not applied.\n" + "\n".join(fits)
    else:
        msg = None
    print(msg or f"No new fits ({len(new_ids)} new alerts, {skipped} filtered).")
    if a.dry_run: return
    if msg:
        subprocess.run([NODE, os.path.join(REPO, "mailead-alerts-buzz.js"), "--post", msg], cwd=REPO, check=True, env={**os.environ, "PATH": "/usr/local/bin:/opt/homebrew/bin:" + os.environ["PATH"]})
    with open(STATE, "a") as f:
        f.write("\n".join(new_ids) + ("\n" if new_ids else ""))

if __name__ == "__main__": main()
