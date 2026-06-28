#!/usr/bin/env python3
"""Tests for reply-watcher's auto-reply / OOO classifier. Run: python3 test_reply_watcher.py"""
import importlib.util, email

spec = importlib.util.spec_from_file_location("replywatcher", "reply-watcher.py")
rw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rw)  # __name__ != "__main__", so main() does not run


def make(headers):
    return email.message_from_string("".join(f"{k}: {v}\n" for k, v in headers.items()) + "\nbody")


# (description, headers, expected is_auto_reply)
CASES = [
    # --- should be SKIPPED (auto-replies) ---
    ("OOO subject", {"Subject": "Automatic reply: AI search for Sheppards James"}, True),
    ("Out of Office subject", {"Subject": "Out of Office"}, True),
    ("Out of the office re", {"Subject": "Re: AI search for Sheppards [Out of the Office]"}, True),
    ("RFC3834 header", {"Subject": "Re: AI search", "Auto-Submitted": "auto-replied"}, True),
    ("X-Autoreply header", {"Subject": "Re: AI search", "X-Autoreply": "yes"}, True),
    ("Precedence bulk", {"Subject": "Re: AI search", "Precedence": "bulk"}, True),
    ("Annual leave", {"Subject": "On annual leave until Monday"}, True),
    ("On holiday", {"Subject": "I'm on holiday"}, True),
    # --- should be ROUTED (real replies) ---
    ("Plain reply", {"Subject": "Re: AI search for Sheppards James"}, False),
    ("One-word audit", {"Subject": "audit"}, False),
    ("Interested reply", {"Subject": "Re: AI search for Sheppards James — yes please"}, False),
    ("Question reply", {"Subject": "Re: AI search — what's the cost?"}, False),
    ("Empty subject", {"Subject": ""}, False),
]

fails = 0
for desc, headers, expected in CASES:
    msg = make(headers)
    got = rw.is_auto_reply(msg, headers.get("Subject", ""))
    ok = got == expected
    if not ok:
        fails += 1
    print(f"{'PASS' if ok else 'FAIL'}  {desc:30} expected={expected} got={got}")

print(f"\n{len(CASES) - fails}/{len(CASES)} passed.")
raise SystemExit(1 if fails else 0)
