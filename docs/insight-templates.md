# Carrier-field insight templates

Deterministic templates for send-batch carrier fields (spec: `docs/superpowers/specs/2026-07-02-send-batch-pipeline-design.md`).
Copy provenance: pilot KSD pro-services sequence (`exports/pilot-ksd-pro-services-sequence.md`), cold-reader audit 2026-06-22.
Rules: no em dashes; `{category}` renders lowercase; template changes require a fresh cold-reader pass before sending.

## ksd-pro-services

- Carrier `last_name` (renders after `{{company_name}}` in the email body):

  `doesn't really come up in AI Search such as Google AI Overview or ChatGPT when people ask for a good {category} in {town}`

- Email body line: `I had a quick look and saw {{company_name}} {{last_name}}.`

  Renders as: "I had a quick look and saw Bevan & Co doesn't really come up in AI Search such as
  Google AI Overview or ChatGPT when people ask for a good accountant in Bramhall."
