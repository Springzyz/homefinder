# Email fixtures

Everything here is **synthetic**: invented markup and invented listings, written only to exercise the parser
contract. They are **not** real Imovirtual/Supercasa emails and prove nothing about the real templates.

Rules for adding fixtures:

- Synthetic or fully sanitised only. No real email addresses, names, search criteria, tracking tokens or
  personalised URLs; replace them with `example` values.
- Never commit raw `.eml` exports or alert emails received at a real address.
- When real samples exist, sanitise them first (strip addresses, tokens, user-specific query strings), put
  them next to these, and update the parsers' assumptions (marked `UNVERIFIED` in the code).

`idealista-daily-summary.html` mirrors the structure of ONE real "Resumo diário de novos imóveis" mail but every
value (ids, titles, prices, tracking) is invented. The real mail contained the user's name and tracking tokens and
was never committed.
