#!/usr/bin/env python3
"""
reply-watcher.py — catch replies to our cold outreach and route them into GHL + ping Kobi.

Send -> Track -> Notify. Mailead/Lemlist SEND; replies land in kobi@kobestarr.io.
This polls that inbox over IMAP, finds messages FROM someone on our outreach list
(the allowlist), and for each new one calls ghl-router.js so the prospect becomes a
tracked GHL contact+opportunity (tag source:outreach-reply) and Kobi gets a WhatsApp.

Matching against the allowlist is what keeps it to real prospect replies, not normal inbox mail.

Runs unattended on clawdbot via cron. Zero third-party deps (stdlib imaplib).

Env:
  GMAIL_USER            kobi@kobestarr.io
  GMAIL_APP_PASSWORD    16-char app password (no spaces)
  GHL_PIT, GHL_LOCATION_ID   passed through to the router
  ROUTER_PATH           path to ghl-router.js (default ./ghl-router.js)
  ALLOWLIST_PATH        default ./data/outreach-allowlist.txt
  STATE_PATH            default ./data/reply-watcher-state.json

Flags:
  --seed      mark everything currently matching as seen, route nothing (first run)
  --dry-run   print matches, route nothing, don't write state
  --all       route every inbound human reply, ignore the allowlist (debug)
  --days N    how many days back to scan (default 3)
"""
import os, sys, json, imaplib, subprocess, email
from email.utils import parseaddr
from email.header import decode_header, make_header
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
GMAIL_USER = os.environ.get("GMAIL_USER", "kobi@kobestarr.io")
GMAIL_PW = os.environ.get("GMAIL_APP_PASSWORD", "")
ROUTER = os.environ.get("ROUTER_PATH", os.path.join(HERE, "ghl-router.js"))
ALLOWLIST = os.environ.get("ALLOWLIST_PATH", os.path.join(HERE, "data", "outreach-allowlist.txt"))
STATE = os.environ.get("STATE_PATH", os.path.join(HERE, "data", "reply-watcher-state.json"))

args = set(sys.argv[1:])
SEED = "--seed" in args
DRY = "--dry-run" in args
ALL = "--all" in args
DAYS = 3
if "--days" in sys.argv:
    try: DAYS = int(sys.argv[sys.argv.index("--days") + 1])
    except Exception: pass

# automated senders we never treat as a prospect reply (belt-and-braces; allowlist already filters)
AUTOMATED = ("noreply", "no-reply", "donotreply", "mailer-daemon", "twinehq.com",
             "linkedin.com", "zapier.com", "google.com", "bark.com", "notifications")

# out-of-office / auto-reply detection: a prospect's address is on the allowlist, but an OOO
# is NOT a real reply — routing it creates junk GHL contacts + WhatsApp pings. Match the
# RFC 3834 header first (most reliable), then common subject patterns as a fallback.
AUTOREPLY_SUBJECTS = ("out of office", "out of the office", "automatic reply", "auto-reply",
                      "autoreply", "auto reply", "automatic response", "away from my desk",
                      "annual leave", "on holiday", "on leave", "on vacation", "maternity leave",
                      "i am currently away", "currently out of the office", "ooo:")


def is_auto_reply(msg, subject):
    autosub = (msg.get("Auto-Submitted", "") or "").lower()
    if "auto-replied" in autosub or "auto-generated" in autosub or "auto-notified" in autosub:
        return True
    if msg.get("X-Autoreply") or msg.get("X-Autorespond") or msg.get("X-Autoresponder"):
        return True
    if (msg.get("Precedence", "") or "").lower() in ("auto_reply", "bulk"):
        return True
    s = (subject or "").lower()
    return any(p in s for p in AUTOREPLY_SUBJECTS)


def load_allowlist():
    try:
        with open(ALLOWLIST) as f:
            return set(l.strip().lower() for l in f if l.strip())
    except FileNotFoundError:
        return set()


def load_state():
    try:
        return set(json.load(open(STATE)).get("seen", []))
    except Exception:
        return set()


def save_state(seen):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    arr = list(seen)[-8000:]
    json.dump({"updated": datetime.now(timezone.utc).isoformat(), "seen": arr}, open(STATE, "w"))


def hdr(msg, name):
    raw = msg.get(name, "")
    try:
        return str(make_header(decode_header(raw)))
    except Exception:
        return raw or ""


def route(sender_email, sender_name, subject):
    env = dict(os.environ)
    cmd = ["node", ROUTER, "--source", "outreach-reply", "--pipeline", "outbound",
           "--email", sender_email, "--note", f"Reply: {subject[:160]}"]
    if sender_name:
        cmd += ["--name", sender_name]
    subprocess.run(cmd, env=env, timeout=40, check=False)


def main():
    if not GMAIL_PW:
        print("Set GMAIL_APP_PASSWORD.", file=sys.stderr); sys.exit(1)
    allow = load_allowlist()
    seen = load_state()
    since = (datetime.now(timezone.utc) - timedelta(days=DAYS)).strftime("%d-%b-%Y")

    M = imaplib.IMAP4_SSL("imap.gmail.com", 993)
    M.login(GMAIL_USER, GMAIL_PW)
    M.select("INBOX", readonly=True)
    typ, data = M.uid("search", None, f'(SINCE "{since}")')
    uids = data[0].split() if data and data[0] else []

    matched, routed, skipped = 0, 0, 0
    for uid in uids:
        typ, fetched = M.uid("fetch", uid, "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID FROM SUBJECT DATE AUTO-SUBMITTED X-AUTOREPLY X-AUTORESPOND X-AUTORESPONDER PRECEDENCE)])")
        if typ != "OK" or not fetched or not fetched[0]:
            continue
        msg = email.message_from_bytes(fetched[0][1])
        msgid = hdr(msg, "Message-ID") or uid.decode()
        if msgid in seen:
            continue
        sender_name, sender_email = parseaddr(hdr(msg, "From"))
        sender_email = (sender_email or "").lower()
        subject = hdr(msg, "Subject")

        is_automated = any(a in sender_email for a in AUTOMATED)
        is_prospect = (sender_email in allow) if not ALL else (sender_email and not is_automated)

        if sender_email and is_prospect and not is_automated:
            if is_auto_reply(msg, subject):
                skipped += 1
                print(f"SKIP auto-reply: {sender_email} | {subject[:60]}")
            else:
                matched += 1
                print(f"MATCH: {sender_email} | {subject[:70]}")
                if not SEED and not DRY:
                    route(sender_email, sender_name, subject); routed += 1
        seen.add(msgid)

    M.logout()
    print(f"scanned {len(uids)} msgs since {since}, {matched} outreach replies, {routed} routed, "
          f"{skipped} auto-replies skipped."
          + (" [seed]" if SEED else "") + (" [dry-run]" if DRY else ""))
    if not DRY:
        save_state(seen)


if __name__ == "__main__":
    main()
