#!/usr/bin/env python3
"""Put ready-to-send drafts into Kobi's Gmail Drafts (IMAP APPEND), with optional attachments.

Kobi reviews each draft in Gmail and clicks send himself: this never sends anything.
Credentials: ~/.credentials/api-keys.json .gmail.user / .gmail.appPassword (never printed).

Usage: python3 tools/gmail_drafts.py <drafts.json> [--from you@gmail.com] [--dry-run]
drafts.json: [{"to": "...", "subject": "...", "body": "...", "attach": "/path/file.pdf" (optional)}]
"""
import imaplib, json, mimetypes, os, sys, time
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

DRAFTS = "[Gmail]/Drafts"
FROM = "Kobi Omenaka <kobi@kobestarr.io>"


def build_message(d, sender=FROM):
    m = EmailMessage()
    m["From"] = sender
    m["To"] = d["to"]
    m["Subject"] = d["subject"]
    m["Date"] = formatdate(localtime=True)
    m["Message-ID"] = make_msgid(domain="kobestarr.io")
    if d.get("in_reply_to"):
        m["In-Reply-To"] = d["in_reply_to"]
        m["References"] = d["in_reply_to"]
    m.set_content(d["body"])
    path = d.get("attach")
    if path:
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        maintype, subtype = ctype.split("/", 1)
        with open(path, "rb") as f:
            m.add_attachment(f.read(), maintype=maintype, subtype=subtype, filename=os.path.basename(path))
    return m


def append_drafts(imap, drafts, sender=FROM):
    done = 0
    for d in drafts:
        msg = build_message(d, sender)
        # Gmail needs mailbox names with spaces or brackets quoted
        typ, _ = imap.append(f'"{DRAFTS}"', "\\Draft", imaplib.Time2Internaldate(time.time()), msg.as_bytes())
        if typ != "OK":
            raise RuntimeError(f"append failed for {d['to']}: {typ}")
        done += 1
    return done


def load_creds(account=None):
    """Vault .gmail is kobi@kobestarr.io; other mailboxes live under .gmailAccounts[<address>]."""
    with open(os.path.expanduser("~/.credentials/api-keys.json")) as f:
        vault = json.load(f)
    g = vault.get("gmail") or {}
    if account and account != g.get("user"):
        g = (vault.get("gmailAccounts") or {}).get(account) or {}
        g.setdefault("user", account)
    if not g.get("user") or not g.get("appPassword"):
        raise SystemExit("No gmail.user / gmail.appPassword in ~/.credentials/api-keys.json")
    return g["user"], g["appPassword"]


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    drafts = json.load(open(argv[1]))
    for d in drafts:
        if d.get("attach") and not os.path.exists(d["attach"]):
            raise SystemExit(f"attachment missing: {d['attach']}")
    if "--dry-run" in argv:
        for d in drafts:
            print(f"[dry-run] draft to {d['to']} | {d['subject']} | attach: {os.path.basename(d['attach']) if d.get('attach') else 'none'}")
        return
    account = argv[argv.index("--from") + 1] if "--from" in argv else None
    user, pw = load_creds(account)
    sender = f"Kobi Omenaka <{user}>"
    imap = imaplib.IMAP4_SSL("imap.gmail.com")
    imap.login(user, pw)
    try:
        n = append_drafts(imap, drafts, sender)
    finally:
        imap.logout()
    print(f"{n} drafts added to Gmail Drafts. Nothing was sent.")


if __name__ == "__main__":
    main(sys.argv)
