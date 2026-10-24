import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(__file__))
import gmail_drafts as g


class FakeImap:
    def __init__(self): self.appended = []
    def append(self, box, flags, date, data):
        if " " in box and not box.startswith('"'):
            raise Exception("BAD Could not parse command")
        self.appended.append((box, flags, data)); return "OK", [b""]


class Tests(unittest.TestCase):
    def test_plain_draft_goes_to_quoted_drafts_with_draft_flag(self):
        imap = FakeImap()
        n = g.append_drafts(imap, [{"to": "sarah@forwardrole.com", "subject": "Hi", "body": "Hello Sarah"}])
        self.assertEqual(n, 1)
        box, flags, data = imap.appended[0]
        self.assertEqual(box, '"[Gmail]/Drafts"')
        self.assertEqual(flags, "\\Draft")
        self.assertIn(b"To: sarah@forwardrole.com", data)
        self.assertIn(b"From: Kobi Omenaka <kobi@kobestarr.io>", data)

    def test_attachment_is_included_as_pdf_with_its_filename(self):
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(b"%PDF-1.4 test"); p = f.name
        msg = g.build_message({"to": "a@b.com", "subject": "CV", "body": "Attached", "attach": p})
        parts = [x for x in msg.iter_attachments()]
        self.assertEqual(len(parts), 1)
        self.assertEqual(parts[0].get_content_type(), "application/pdf")
        self.assertEqual(parts[0].get_filename(), os.path.basename(p))

    def test_reply_threading_headers(self):
        msg = g.build_message({"to": "a@b.com", "subject": "Re: x", "body": "b", "in_reply_to": "<abc@x>"})
        self.assertEqual(msg["In-Reply-To"], "<abc@x>")
        self.assertEqual(msg["References"], "<abc@x>")


if __name__ == "__main__":
    unittest.main()
