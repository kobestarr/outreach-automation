# Contracts lane (plain English)

**What it does.** Takes the list of good remote contract roles, works out who most likely hires for each one, finds and checks their email, and gives you a short list of people to email directly instead of applying cold.

## Run it

```
cd outreach-automation
OA_DATA_DIR=/Users/kobestarr/Development/One\ Hour\ Vibe\ Coder/outreach-automation/data \
node contracts-lane.js \
  --in exports/contract-roles-2026-10-18.csv,exports/recon-contract-roles-2026-10-18.csv \
  --out exports/contracts-send-2026-10-18.csv \
  --desc-from <raw job export with descriptions>.csv
```

Add `--dry-run` first: it shows the plan (who it would look up) and spends no email credits. Add `--max-credits N` to lower the cap (never higher than 150).

## What you get

- `contracts-send-....csv`: people with a checked email. Safe to email by hand. Columns include the role link, their title, how we found them, `hm_confidence` and `domain_check`.
- `...-held.csv`: roles we could not finish, each with the reason (no website found, no manager found, only an info@ inbox, site did not match the ad).
- `...-recruiters.csv`: agencies that posted roles. Keep these for a separate recruiter note.

## How the manager is chosen

1. Named in the ad ("reporting to Jane Smith, Head of Growth"): high confidence.
2. The company's team or about page, picking the person your role would report to (marketing lead for marketing roles, operations or tech lead for automation roles). Under about 20 people it is the founder or CEO. Medium confidence (high when the ad also names the function).
3. Companies House, only for small UK companies (longest-serving director). Low confidence.

## Read before you email

- `hm_confidence` low means a guess. Check the person on LinkedIn first.
- `domain_check` of `name_match_only` means we matched the company name but the ad had too little text to confirm it is the same business. Look at the site.
- `eligibility_note` appears on roles outside the UK: ask whether they take UK contractors.
- Generic inboxes (info@) are never sent to, they go in the held file.
- Anyone in `data/do-not-contact.txt` or `data/sent-ledger.txt` is skipped automatically.

## Limits and cost

Free web lookups only. Email checks use today's Reoon daily credits (never the reserve), at most 150 per run, no Icypeas. It never sends email and never loads Mailead.

## Adding a company website by hand

If a good role is held for "no company domain", add `"company name in lowercase": "theirsite.com"` to `config/contract-domain-overrides.json` and rerun.
