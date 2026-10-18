#!/usr/bin/env python3
"""
reply-collector.py: copy cold-email replies (and Kobi's sent answers) from Gmail into a jsonl file the Mac reply engine reads.

Runs on clawdbot from cron (e.g. every 5 min). stdlib only. Read only on Gmail (mailboxes opened readonly, BODY.PEEK).
Appends one JSON object per line to REPLIES_PATH (default /root/data/replies.jsonl):
  inbound: {kind:"inbound", msgid, date, from, from_name, to[], cc[], subject, body, in_reply_to, references, auto_submitted, precedence}
           only for mail addressed to one of the 27 sending mailboxes, or from an address on the outreach allowlist
  sent:    {kind:"sent", msgid, date, to[], subject, in_reply_to}
           Kobi's own replies (In-Reply-To set or "Re:" subject), so the engine knows a thread was answered
Body is plain text with quoted history stripped.

Env:  GMAIL_USER, GMAIL_APP_PASSWORD          (never printed)
      REPLIES_PATH   default /root/data/replies.jsonl
      STATE_PATH     default /root/data/reply-collector-state.json
      ALLOWLIST_PATH default ./data/outreach-allowlist.txt next to this script (same file reply-watcher.py uses)
Flags: --dry-run  print what would be written, change nothing (no file, no state)
       --days N   first run only: how far back to look (default 3)
"""
import os, sys, re, json, imaplib, email
from email.utils import parseaddr, getaddresses, parsedate_to_datetime
from email.header import decode_header, make_header
from datetime import datetime, timedelta, timezone
from html import unescape

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALS = ["kobi", "kobi.o", "kobi.omenaka"]
DOMAINS = [
    "kobestarrdigital.com", "kobestarr.digital", "trykobestarrdigital.com",      # KSD
    "strippedmedia.co.uk", "strippedmedia.org", "gostripped.media",              # Stripped
    "dealflowmedia.co", "dealflowmedia.pro", "dealflowmedia.group",              # Dealflow
]
OUR_MAILBOXES = {f"{l}@{d}" for d in DOMAINS for l in LOCALS}
INBOX = "INBOX"
SENT = "[Gmail]/Sent Mail"

# Headers that can carry the original recipient when Gmail forwards or aliases mail
ADDRESS_HEADERS = ["To", "Cc", "Delivered-To", "X-Original-To", "X-Forwarded-To", "Resent-To", "Envelope-To"]


def decode(raw):
    try:
        return str(make_header(decode_header(raw or "")))
    except Exception:
        return raw or ""


def addrs(msg, names):
    vals = []
    for n in names:
        vals.extend(msg.get_all(n, []) or [])
    return [a.lower() for _, a in getaddresses([decode(v) for v in vals]) if a]


# ---- body ----
QUOTE_STARTS = [
    re.compile(r"^\s*Le .{5,200}a écrit\s*:\s*$", re.I),
    re.compile(r"^\s*Am .{5,200}schrieb .*:\s*$", re.I),
    re.compile(r"^\s*-{2,}\s*Original Message\s*-{2,}", re.I),
    re.compile(r"^\s*-{2,}\s*Forwarded message\s*-{2,}", re.I),
    re.compile(r"^\s*_{10,}\s*$"),
    re.compile(r"^\s*From:\s.+", re.I),          # Outlook header block
]


def strip_quoted(text):
    """Keep what the person wrote; drop '> ' lines and everything from the first 'On ... wrote:' style marker."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        # 'On Mon, 5 Oct 2026 at 10:00, X <x@y> wrote:' often wraps over two lines
        nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
        if re.match(r"^\s*On .{3,}", ln) and (re.search(r"wrote:\s*$", ln) or re.search(r"wrote:\s*$", ln + " " + nxt)) and len(ln) + len(nxt) < 300:
            break
        if any(p.match(ln) for p in QUOTE_STARTS):
            # a bare 'From:' line only counts as a quote header if a Sent/Date/To line follows
            if QUOTE_STARTS[-1].match(ln) and not any(re.match(r"^\s*(Sent|Date|To|Subject):", x, re.I) for x in lines[i + 1:i + 4]):
                out.append(ln); i += 1; continue
            break
        if ln.lstrip().startswith(">"):
            i += 1; continue
        out.append(ln)
        i += 1
    return "\n".join(out).strip()


def html_to_text(html):
    t = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", html)
    t = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>|</li>", "\n", t)
    t = re.sub(r"(?is)<blockquote.*?</blockquote>", "", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = unescape(t)
    return re.sub(r"[ \t]+", " ", re.sub(r"\n[ \t]*\n+", "\n\n", t)).strip()


def body_text(msg):
    plain, html = None, None
    for part in msg.walk():
        if part.get_content_maintype() == "multipart" or part.get_filename():
            continue
        ctype = part.get_content_type()
        if ctype not in ("text/plain", "text/html"):
            continue
        try:
            payload = part.get_payload(decode=True)
            if payload is None:
                continue
            txt = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        except Exception:
            continue
        if ctype == "text/plain" and plain is None:
            plain = txt
        elif ctype == "text/html" and html is None:
            html = txt
    return strip_quoted(plain if plain is not None else html_to_text(html or ""))


def iso_date(msg):
    try:
        d = parsedate_to_datetime(msg.get("Date"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.astimezone(timezone.utc).isoformat()
    except Exception:
        return datetime.now(timezone.utc).isoformat()


# ---- record building ----
def inbound_record(msg, allow):
    """Return a record dict if this message is a reply we care about, else None."""
    from_name, from_addr = parseaddr(decode(msg.get("From", "")))
    from_addr = (from_addr or "").lower()
    recips = set(addrs(msg, ADDRESS_HEADERS))
    to_ours = bool(recips & OUR_MAILBOXES)
    if not (to_ours or from_addr in allow):
        return None
    if from_addr in OUR_MAILBOXES or from_addr == (os.environ.get("GMAIL_USER") or "kobi@kobestarr.io").lower():
        return None
    return {
        "kind": "inbound",
        "msgid": decode(msg.get("Message-ID", "")).strip(),
        "date": iso_date(msg),
        "from": from_addr,
        "from_name": from_name,
        "to": addrs(msg, ["To", "Delivered-To", "X-Original-To", "X-Forwarded-To"]),
        "cc": addrs(msg, ["Cc"]),
        "subject": decode(msg.get("Subject", "")),
        "body": body_text(msg),
        "in_reply_to": decode(msg.get("In-Reply-To", "")).strip(),
        "references": decode(msg.get("References", "")).strip(),
        "auto_submitted": decode(msg.get("Auto-Submitted", "")).strip(),
        "precedence": decode(msg.get("Precedence", "")).strip(),
    }


def sent_record(msg):
    subject = decode(msg.get("Subject", ""))
    in_reply_to = decode(msg.get("In-Reply-To", "")).strip()
    if not in_reply_to and not re.match(r"^\s*(re|aw|sv)\s*:", subject, re.I):
        return None   # a fresh email, not an answer
    to = [a for a in addrs(msg, ["To", "Cc"]) if a not in OUR_MAILBOXES]
    if not to:
        return None
    return {"kind": "sent", "msgid": decode(msg.get("Message-ID", "")).strip(), "date": iso_date(msg),
            "to": to, "subject": subject, "in_reply_to": in_reply_to}


# ---- state ----
def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def load_allowlist(path):
    try:
        with open(path) as f:
            return set(l.strip().lower() for l in f if l.strip())
    except FileNotFoundError:
        return set()


def fetch_new(M, folder, state_key, state, days, build, seen):
    """Walk UIDs newer than the saved one. Returns (records, new_last_uid)."""
    typ, _ = M.select(folder, readonly=True)
    if typ != "OK":
        return [], state.get(state_key)
    last = state.get(state_key)
    if last is None:
        since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%d-%b-%Y")
        typ, data = M.uid("search", None, f'(SINCE "{since}")')
        floor = 0
    else:
        typ, data = M.uid("search", None, f"UID {int(last) + 1}:*")
        floor = int(last)
    uids = sorted(int(u) for u in (data[0].split() if typ == "OK" and data and data[0] else []))
    uids = [u for u in uids if u > floor]      # IMAP 'n:*' always returns the newest message even if it is old
    records, new_last = [], last
    for u in uids:
        typ, fetched = M.uid("fetch", str(u), "(BODY.PEEK[])")
        if typ != "OK" or not fetched or not fetched[0] or not isinstance(fetched[0], tuple):
            continue
        msg = email.message_from_bytes(fetched[0][1])
        rec = build(msg)
        new_last = u if new_last is None or u > int(new_last) else new_last
        if rec and rec["msgid"] and rec["msgid"] not in seen:
            seen.add(rec["msgid"])
            records.append(rec)
    return records, new_last


def run(connect, env, argv, out=print):
    dry = "--dry-run" in argv
    days = 3
    if "--days" in argv:
        try: days = int(argv[argv.index("--days") + 1])
        except Exception: pass
    user, pw = env.get("GMAIL_USER", ""), env.get("GMAIL_APP_PASSWORD", "")
    if not user or not pw:
        out("Set GMAIL_USER and GMAIL_APP_PASSWORD.")
        return 1
    replies_path = env.get("REPLIES_PATH", "/root/data/replies.jsonl")
    state_path = env.get("STATE_PATH", "/root/data/reply-collector-state.json")
    allow = load_allowlist(env.get("ALLOWLIST_PATH", os.path.join(HERE, "data", "outreach-allowlist.txt")))
    state = load_json(state_path, {})
    seen = set(state.get("seen", []))

    M = connect()
    M.login(user, pw)
    try:
        inbound, last_in = fetch_new(M, INBOX, "inbox_uid", state, days, lambda m: inbound_record(m, allow), seen)
        sent, last_sent = fetch_new(M, SENT, "sent_uid", state, days, sent_record, seen)
    finally:
        try: M.logout()
        except Exception: pass

    records = inbound + sent
    for r in records:
        out(("[dry-run] " if dry else "") + f"{r['kind']} {r.get('from') or ','.join(r.get('to', []))} | {r['subject'][:60]}")
    if dry:
        out(f"[dry-run] {len(inbound)} inbound, {len(sent)} sent; nothing written")
        return 0
    if records:
        os.makedirs(os.path.dirname(replies_path), exist_ok=True)
        with open(replies_path, "a") as f:
            for r in records:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    state.update({"inbox_uid": last_in, "sent_uid": last_sent, "seen": list(seen)[-8000:],
                  "updated": datetime.now(timezone.utc).isoformat()})
    os.makedirs(os.path.dirname(state_path), exist_ok=True)
    with open(state_path, "w") as f:
        json.dump(state, f)
    out(f"{len(inbound)} inbound, {len(sent)} sent written")
    return 0


if __name__ == "__main__":
    sys.exit(run(lambda: imaplib.IMAP4_SSL("imap.gmail.com", 993), os.environ, sys.argv[1:]))
