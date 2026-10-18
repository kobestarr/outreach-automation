"""Unit tests for vps/reply-collector.py. Fake imaplib, no network. Run: python3 -m unittest discover -s vps/tests"""
import importlib.util, json, os, sys, tempfile, unittest
from email.message import EmailMessage

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("rc", os.path.join(HERE, "..", "reply-collector.py"))
rc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rc)

OURS = "kobi.o@kobestarrdigital.com"


def mail(frm, to, subject, body, msgid, date="Sun, 18 Oct 2026 08:00:00 +0000", **hdr):
    m = EmailMessage()
    m["From"], m["To"], m["Subject"], m["Message-ID"], m["Date"] = frm, to, subject, msgid, date
    for k, v in hdr.items():
        m[k.replace("_", "-")] = v
    m.set_content(body)
    return m.as_bytes()


class FakeIMAP:
    def __init__(self, folders, validity=None, fail_uids=()):
        self.folders, self.cur, self.logged_in, self.fetched = folders, None, False, []
        self.validity, self.fail_uids = validity or {}, set(fail_uids)
    def response(self, name):
        assert name == "UIDVALIDITY"
        return "OK", [str(self.validity.get(self.cur, 1)).encode()]
    def login(self, u, p): self.logged_in = True
    def logout(self): pass
    def select(self, folder, readonly=False):
        assert readonly, "collector must never open a mailbox read write"
        # Real Gmail IMAP rejects an unquoted mailbox name containing a space (seen live 18 Oct)
        if " " in folder and not (folder.startswith('"') and folder.endswith('"')):
            raise Exception("EXAMINE command error: BAD [b'Could not parse command']")
        folder = folder.strip('"')
        if folder not in self.folders: return "NO", []
        self.cur = folder; return "OK", [b"1"]
    def uid(self, cmd, *args):
        box = self.folders[self.cur]
        if cmd == "search":
            crit = args[-1]
            uids = sorted(box)
            if crit.startswith("UID "):
                n = int(crit.split()[1].split(":")[0])
                uids = [u for u in uids if u >= n] or uids[-1:]    # IMAP quirk: n:* returns the last message even if lower
            return "OK", [b" ".join(str(u).encode() for u in uids)]
        if cmd == "fetch":
            if int(args[0]) in self.fail_uids: return "NO", [None]
            self.fetched.append((self.cur, args[1]))
            assert "PEEK" in args[1], "must not mark mail as read"
            return "OK", [(b"1 (BODY[] {1})", box[int(args[0])]), b")"]
        raise AssertionError(cmd)


def run_collector(folders, argv=(), allow="", env_extra=None, **fake_kw):
    d = tempfile.mkdtemp()
    al = os.path.join(d, "allow.txt"); open(al, "w").write(allow)
    env = {"GMAIL_USER": "kobi@kobestarr.io", "GMAIL_APP_PASSWORD": "x", "REPLIES_PATH": os.path.join(d, "replies.jsonl"),
           "STATE_PATH": os.path.join(d, "state.json"), "ALLOWLIST_PATH": al, **(env_extra or {})}
    fake = FakeIMAP(folders, **fake_kw)
    lines = []
    code = rc.run(lambda: fake, env, list(argv), out=lines.append)
    recs = []
    if os.path.exists(env["REPLIES_PATH"]):
        recs = [json.loads(l) for l in open(env["REPLIES_PATH"])]
    return code, recs, lines, env, fake


class StripQuoted(unittest.TestCase):
    def test_gmail_style(self):
        t = "Yes please send it.\n\nOn Sun, 18 Oct 2026 at 08:00, Kobi O <kobi.o@x.com> wrote:\n> Hi there\n> more"
        self.assertEqual(rc.strip_quoted(t), "Yes please send it.")
    def test_wrapped_attribution(self):
        t = "Go ahead.\n\nOn Sun, 18 Oct 2026 at 08:00, Kobi Omenaka\n<kobi@x.com> wrote:\n> hi"
        self.assertEqual(rc.strip_quoted(t), "Go ahead.")
    def test_outlook_block(self):
        t = "Thanks Kobi\n\nFrom: Kobi O <k@x.com>\nSent: 18 October 2026 08:00\nTo: bob@y.com\nSubject: Hi\n\nold text"
        self.assertEqual(rc.strip_quoted(t), "Thanks Kobi")
    def test_original_message_and_quote_marks(self):
        self.assertEqual(rc.strip_quoted("Yes\n> quoted\n-----Original Message-----\nFrom: x"), "Yes")
        self.assertEqual(rc.strip_quoted("line one\n> old\nline two"), "line one\nline two")
    def test_from_in_normal_text_is_kept(self):
        self.assertEqual(rc.strip_quoted("From: my side, sure"), "From: my side, sure")
    def test_html_only(self):
        self.assertIn("Hello there", rc.html_to_text("<div>Hello<br>there</div><blockquote>old</blockquote>").replace("\n", " ").replace("Hello there", "Hello there"))


class Inbound(unittest.TestCase):
    def test_reply_to_our_mailbox_is_collected_with_clean_body(self):
        body = "Audit\n\nOn Sun, 18 Oct 2026 at 08:00, Kobi <" + OURS + "> wrote:\n> hi"
        folders = {"INBOX": {1: mail("Atif <atif@h.com>", OURS, "Re: AI search", body, "<a1>", Auto_Submitted="no")}, "[Gmail]/Sent Mail": {}}
        code, recs, _, _, _ = run_collector(folders)
        self.assertEqual(code, 0)
        self.assertEqual(len(recs), 1)
        r = recs[0]
        self.assertEqual((r["kind"], r["msgid"], r["from"], r["body"]), ("inbound", "<a1>", "atif@h.com", "Audit"))
        self.assertIn(OURS, r["to"]); self.assertEqual(r["subject"], "Re: AI search")
        self.assertTrue(r["date"].startswith("2026-10-18T08:00"))
        for k in ("cc", "in_reply_to", "references", "from_name"):
            self.assertIn(k, r)

    def test_unrelated_mail_is_ignored(self):
        folders = {"INBOX": {1: mail("news@x.com", "kobi@kobestarr.io", "Newsletter", "hi", "<n1>")}, "[Gmail]/Sent Mail": {}}
        self.assertEqual(run_collector(folders)[1], [])

    def test_allowlisted_sender_is_collected_even_if_forwarded_oddly(self):
        folders = {"INBOX": {1: mail("Jo <jo@firm.com>", "kobi@kobestarr.io", "Re: x", "interested", "<j1>")}, "[Gmail]/Sent Mail": {}}
        self.assertEqual(len(run_collector(folders, allow="jo@firm.com\n")[1]), 1)

    def test_original_recipient_header_counts(self):
        folders = {"INBOX": {1: mail("jo@firm.com", "kobi@kobestarr.io", "Re: x", "hi", "<j2>", X_Original_To="kobi@gostripped.media")}, "[Gmail]/Sent Mail": {}}
        self.assertEqual(len(run_collector(folders)[1]), 1)

    def test_our_own_mail_is_not_a_reply(self):
        folders = {"INBOX": {1: mail("kobi@dealflowmedia.pro", OURS, "internal", "x", "<o1>")}, "[Gmail]/Sent Mail": {}}
        self.assertEqual(run_collector(folders)[1], [])

    def test_auto_headers_are_recorded_for_the_classifier(self):
        folders = {"INBOX": {1: mail("a@b.com", OURS, "Automatic reply", "away", "<z1>", Auto_Submitted="auto-replied", Precedence="bulk")}, "[Gmail]/Sent Mail": {}}
        r = run_collector(folders)[1][0]
        self.assertEqual((r["auto_submitted"], r["precedence"]), ("auto-replied", "bulk"))


class Sent(unittest.TestCase):
    def test_kobis_answer_is_recorded(self):
        folders = {"INBOX": {}, "[Gmail]/Sent Mail": {5: mail("kobi@kobestarr.io", "Atif <atif@h.com>", "Re: AI search", "Sending now", "<s1>", In_Reply_To="<a1>")}}
        r = run_collector(folders)[1]
        self.assertEqual(len(r), 1)
        self.assertEqual((r[0]["kind"], r[0]["to"], r[0]["in_reply_to"]), ("sent", ["atif@h.com"], "<a1>"))

    def test_fresh_outbound_mail_is_not_recorded(self):
        folders = {"INBOX": {}, "[Gmail]/Sent Mail": {5: mail("kobi@kobestarr.io", "x@y.com", "Hello", "new thread", "<s2>")}}
        self.assertEqual(run_collector(folders)[1], [])


class State(unittest.TestCase):
    def test_second_run_adds_only_new_mail_and_never_duplicates(self):
        box = {1: mail("a@b.com", OURS, "Re: 1", "one", "<m1>")}
        folders = {"INBOX": box, "[Gmail]/Sent Mail": {}}
        code, recs, _, env, fake = run_collector(folders)
        self.assertEqual(len(recs), 1)
        # run again, same mailbox: nothing new
        rc.run(lambda: FakeIMAP(folders), env, [], out=lambda *_: None)
        self.assertEqual(len(open(env["REPLIES_PATH"]).read().strip().split("\n")), 1)
        # new mail arrives
        box[2] = mail("c@d.com", OURS, "Re: 2", "two", "<m2>")
        rc.run(lambda: FakeIMAP(folders), env, [], out=lambda *_: None)
        got = [json.loads(l)["msgid"] for l in open(env["REPLIES_PATH"])]
        self.assertEqual(got, ["<m1>", "<m2>"])
        self.assertEqual(json.load(open(env["STATE_PATH"]))["inbox_uid"], 2)

    def test_same_message_id_in_two_uids_is_written_once(self):
        m = mail("a@b.com", OURS, "Re: 1", "one", "<dup>")
        folders = {"INBOX": {1: m, 2: m}, "[Gmail]/Sent Mail": {}}
        self.assertEqual(len(run_collector(folders)[1]), 1)

    def test_missing_sent_folder_does_not_break_inbox(self):
        folders = {"INBOX": {1: mail("a@b.com", OURS, "Re: 1", "one", "<m1>")}}
        self.assertEqual(len(run_collector(folders)[1]), 1)


class DryRunAndSafety(unittest.TestCase):
    def test_dry_run_writes_nothing(self):
        folders = {"INBOX": {1: mail("a@b.com", OURS, "Re: 1", "one", "<m1>")}, "[Gmail]/Sent Mail": {}}
        code, recs, lines, env, _ = run_collector(folders, argv=["--dry-run"])
        self.assertEqual(code, 0)
        self.assertEqual(recs, [])
        self.assertFalse(os.path.exists(env["STATE_PATH"]))
        self.assertTrue(any("would" in l or "dry-run" in l for l in lines))

    def test_missing_credentials_fail_cleanly_without_printing_secrets(self):
        d = tempfile.mkdtemp()
        lines = []
        code = rc.run(lambda: FakeIMAP({}), {"GMAIL_USER": "", "GMAIL_APP_PASSWORD": ""}, [], out=lines.append)
        self.assertEqual(code, 1)

    def test_mailboxes_are_the_27(self):
        self.assertEqual(len(rc.OUR_MAILBOXES), 27)

    def test_password_never_appears_in_output(self):
        folders = {"INBOX": {1: mail("a@b.com", OURS, "Re: 1", "one", "<m1>")}, "[Gmail]/Sent Mail": {}}
        _, _, lines, _, _ = run_collector(folders, env_extra={"GMAIL_APP_PASSWORD": "hunter2hunter2"})
        self.assertFalse(any("hunter2" in l for l in lines))


class Skips(unittest.TestCase):
    def test_skipped_messages_are_logged_with_their_uid(self):
        folders = {"INBOX": {4: mail("a@b.com", OURS, "Re: ok", "x", "<ok>"), 5: b"Subject: weird\r\nFrom: a@b.com\r\nTo: " + OURS.encode() + b"\r\n\r\nno message id"},
                   "[Gmail]/Sent Mail": {}}
        _, recs, lines, _, _ = run_collector(folders)
        self.assertEqual([r["msgid"] for r in recs], ["<ok>"])
        self.assertTrue(any("UID 5" in l and "Message-ID" in l for l in lines), lines)

    def test_unparseable_message_is_logged_with_uid(self):
        folders = {"INBOX": {7: mail("a@b.com", OURS, "Re: boom", "x", "<m7>")}, "[Gmail]/Sent Mail": {}}
        real = rc.inbound_record
        rc.inbound_record = lambda m, a: (_ for _ in ()).throw(ValueError("bad"))
        try:
            _, _, lines, _, _ = run_collector(folders)
        finally:
            rc.inbound_record = real
        self.assertTrue(any("UID 7" in l and "bad" in l for l in lines), lines)

    def test_state_is_written_atomically(self):
        calls = []
        real = os.replace
        os.replace = lambda a, b: (calls.append((a, b)), real(a, b))[1]
        try:
            _, _, _, env, _ = run_collector({"INBOX": {1: mail("a@b.com", OURS, "Re: 1", "x", "<m1>")}, "[Gmail]/Sent Mail": {}})
        finally:
            os.replace = real
        self.assertTrue(any(b == env["STATE_PATH"] and a != b for a, b in calls))
        self.assertFalse([f for f in os.listdir(os.path.dirname(env["STATE_PATH"])) if f.endswith(".tmp")])


class Resilience(unittest.TestCase):
    def three(self):
        return {"INBOX": {i: mail(f"p{i}@x.com", OURS, f"Re: {i}", f"body {i}", f"<m{i}>") for i in (1, 2, 3)}, "[Gmail]/Sent Mail": {}}

    def test_a_failed_fetch_stops_the_walk_and_is_retried_next_run(self):
        folders = self.three()
        code, recs, _, env, _ = run_collector(folders, fail_uids={2})
        self.assertEqual([r["msgid"] for r in recs], ["<m1>"])
        self.assertEqual(json.load(open(env["STATE_PATH"]))["inbox_uid"], 1)
        rc.run(lambda: FakeIMAP(folders), env, [], out=lambda *_: None)
        self.assertEqual([json.loads(l)["msgid"] for l in open(env["REPLIES_PATH"])], ["<m1>", "<m2>", "<m3>"])

    def test_one_bad_message_does_not_stop_the_rest(self):
        folders = self.three()
        real = rc.inbound_record
        def flaky(msg, allow):
            if "Re: 2" in str(msg["Subject"]): raise ValueError("boom")
            return real(msg, allow)
        rc.inbound_record = flaky
        try:
            code, recs, _, env, _ = run_collector(folders)
        finally:
            rc.inbound_record = real
        self.assertEqual([r["msgid"] for r in recs], ["<m1>", "<m3>"])
        self.assertEqual(json.load(open(env["STATE_PATH"]))["inbox_uid"], 3)

    def test_uidvalidity_change_resets_the_uid_and_does_not_duplicate(self):
        folders = {"INBOX": {1: mail("a@b.com", OURS, "Re: 1", "one", "<m1>"), 2: mail("c@d.com", OURS, "Re: 2", "two", "<m2>")}, "[Gmail]/Sent Mail": {}}
        code, recs, _, env, _ = run_collector(folders, validity={"INBOX": 1, "[Gmail]/Sent Mail": 1})
        # Gmail renumbers: same mail, new validity, new uids
        folders2 = {"INBOX": {7: folders["INBOX"][1], 8: folders["INBOX"][2], 9: mail("e@f.com", OURS, "Re: 3", "three", "<m3>")}, "[Gmail]/Sent Mail": {}}
        rc.run(lambda: FakeIMAP(folders2, validity={"INBOX": 2, "[Gmail]/Sent Mail": 1}), env, [], out=lambda *_: None)
        self.assertEqual([json.loads(l)["msgid"] for l in open(env["REPLIES_PATH"])], ["<m1>", "<m2>", "<m3>"])
        st = json.load(open(env["STATE_PATH"]))
        self.assertEqual((st["inbox_validity"], st["inbox_uid"]), ("2", 9))

    def test_seen_is_an_ordered_list_capped_by_insertion(self):
        old = rc.SEEN_MAX
        rc.SEEN_MAX = 3
        try:
            folders = {"INBOX": {i: mail(f"p{i}@x.com", OURS, f"Re: {i}", "b", f"<s{i}>") for i in range(1, 6)}, "[Gmail]/Sent Mail": {}}
            _, _, _, env, _ = run_collector(folders)
        finally:
            rc.SEEN_MAX = old
        self.assertEqual(json.load(open(env["STATE_PATH"]))["seen"], ["<s3>", "<s4>", "<s5>"])

    def test_the_replies_file_always_exists_after_a_run(self):
        _, recs, _, env, _ = run_collector({"INBOX": {}, "[Gmail]/Sent Mail": {}})
        self.assertTrue(os.path.exists(env["REPLIES_PATH"]))
        self.assertEqual(os.path.getsize(env["REPLIES_PATH"]), 0)

    def test_dry_run_does_not_create_the_file(self):
        _, _, _, env, _ = run_collector({"INBOX": {}, "[Gmail]/Sent Mail": {}}, argv=["--dry-run"])
        self.assertFalse(os.path.exists(env["REPLIES_PATH"]))


if __name__ == "__main__":
    unittest.main()
