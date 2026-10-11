# Email ingestion (Imovirtual and Supercasa)

Imovirtual and Supercasa sit behind bot protection, so HomeFinder does **not** fetch them. Instead you create
**saved-search alerts** on those portals, pointed at an address you control, and HomeFinder reads the alert emails.

> **Status: unverified against real emails.** The parsers (`packages/scraper/src/adapters/email/`) were written and
> tested with **synthetic** fixtures only. Their assumptions about each portal's link shapes and layout are marked
> `UNVERIFIED` in the code. Before trusting them, capture a few real alert emails, **sanitise** them (remove your
> address, tokens and personalised URLs), compare, and fix the assumptions. Until then, expect real emails to be
> *quarantined* (visible, never silently accepted) rather than parsed.

## How it works

```text
Portal alert email ─► Cloudflare Email Routing ─► Email Worker ─► D1 queue
                                                                     ▲
              your computer ── outbound HTTPS, bearer token ─────────┘
              pnpm ingest-emails: pull → parse → existing pipeline → acknowledge
```

- **Nothing is exposed on your machine.** The Worker cannot reach `localhost`; your computer pulls from the Worker.
- The Worker only validates, bounds and queues mail. All business logic (scoring, matching, alerts) stays in the
  existing pipeline (`processListings` in `packages/scraper/src/pipeline.ts`).
- Delivery is **at-least-once**. A message is acknowledged only after its listings were processed (or it had a
  deliberate terminal outcome). Re-processing is safe: listings are upserted by `(portal, portal_id)` and alerts are
  unique per `(search, listing, channel)`.
- **Known limitation:** duplicates are impossible, but an alert can be *lost* if the process crashes after a listing is
  stored and before its alert is sent: the retry sees an already-stored listing and does not treat it as new. This is
  the same behaviour as the polled portals and is accepted for a personal notifier.
- No LLM or paid API is involved.

## Message states

| State | Meaning |
| --- | --- |
| `pending` | Stored, available to the scraper. |
| `retryable_error` | A local/database failure; offered again. After 5 failed attempts it becomes `quarantined` (`max_attempts`). |
| `processed` | Listings handled, or a deliberate non-listing mail (e.g. a confirmation). |
| `quarantined` | Could not be understood or is invalid (`error_code` says why); needs a human. Not retried. |

Parser outcomes (no bodies are ever logged, only codes): `no_html_body`, `portal_not_identified`, `no_listing_links`,
`no_priced_listing_blocks`, `no_valid_candidates`, `pipeline_error`, and per-candidate rejections
`ambiguous_price`, `missing_area`, `ambiguous_area`, `implausible_values`, `location_unresolved`.
A candidate is rejected rather than guessed; valid candidates in the same email are still processed.

## One-time setup (manual, nothing here is automated)

Requirements: a Cloudflare account (Free plan is enough) and **a domain whose DNS is on Cloudflare** (Email Routing
needs it).

1. **Create the D1 database** and note the printed `database_id`:
   ```bash
   cd infra/cloudflare-email-worker
   pnpm install --ignore-workspace
   pnpm exec wrangler login
   pnpm exec wrangler d1 create homefinder-email-queue
   ```
   Put the id in `wrangler.jsonc` (`d1_databases[0].database_id`). It is not a secret.
2. **Apply the migration** (`migrations/0001_email_queue.sql`):
   ```bash
   pnpm db:migrate:remote
   ```
3. **Configure variables** in `wrangler.jsonc` → `vars`:
   - `HOMEFINDER_INGEST_ADDRESS`: the address you will create in step 6, e.g. `homefinder@your-domain.com`.
   - `ALLOWED_SENDERS` / `ALLOWED_SENDER_DOMAINS`: leave empty at first (*discovery mode*), see
     [Sender allow-list](#sender-allow-list).
4. **Set the shared token** as a Worker secret (never in a file):
   ```bash
   openssl rand -hex 32            # copy the output
   pnpm exec wrangler secret put HOMEFINDER_QUEUE_TOKEN   # paste it when prompted
   ```
5. **Deploy** (only when you are ready; this publishes the Worker):
   ```bash
   pnpm deploy
   ```
   The Worker URL is printed (`https://homefinder-email-ingest.<account>.workers.dev`).
6. **Create the Email Routing route**: Cloudflare dashboard → your domain → *Email* → *Email Routing* → enable it →
   *Routing rules* → *Create address*: custom address = your ingest address, action = **Send to a Worker** →
   `homefinder-email-ingest`.
7. **Create the portal alerts**: on Imovirtual and Supercasa, save your searches and set the alert email to the
   ingest address. Some portals send a confirmation first; confirm it (it arrives as a message and is ignored by
   subject, see below).
8. **Local configuration**: add to the git-ignored `.env` (see `.env.example` for names):
   ```bash
   CLOUDFLARE_EMAIL_QUEUE_URL=https://homefinder-email-ingest.<account>.workers.dev
   CLOUDFLARE_EMAIL_QUEUE_TOKEN=<the same token>
   ```

## Day-to-day use

```bash
pnpm --filter @homefinder/scraper ingest-emails --dry-run   # parse only: nothing written or acknowledged
pnpm --filter @homefinder/scraper ingest-emails             # process for real, alerts included
pnpm --filter @homefinder/scraper ingest-emails --stats     # queue size/age by state
```

Flags: `--limit=N` (1–20, default 10), `--no-notify` (store and score, no alerts), `--no-seed`, `--dry-run`, `--stats`.

**First-run seeding.** As for polled portals, the first successful batch for a portal is stored **silently** (no
alerts) so an initial burst cannot flood you. Use `--no-seed` to alert from the very first email.

**Scheduling is deliberately not set up.** The live systemd timer polls Casa Sapo only and was not modified. To run
ingestion periodically, add a second user service/timer (same pattern as `homefinder-poll`, `ExecStart=… pnpm
ingest-emails`) or append the command to the existing service. Do this manually when you are happy with the parsers.

## Sender allow-list

Start in discovery mode (both lists empty) so you can see the real sender addresses. Look at the quarantined/pending
messages (`wrangler d1 execute homefinder-email-queue --remote --command "SELECT sender, subject, status FROM email_messages ORDER BY received_at DESC LIMIT 20"`), then lock it down in `wrangler.jsonc`:

```jsonc
"ALLOWED_SENDERS": "alerts@portal.example",          // exact addresses, comma separated
"ALLOWED_SENDER_DOMAINS": "mail.portal.example"      // a domain also matches its subdomains
```

Redeploy afterwards. Senders outside the lists are rejected at SMTP time. Do not guess these values: use what you
observe. Note that a `From:` address can be forged, so this reduces noise but is not strong authentication.

## Local testing with synthetic emails

```bash
cd infra/cloudflare-email-worker
cp .dev.vars.example .dev.vars          # replace the placeholder with: openssl rand -hex 32
pnpm db:migrate:local
pnpm dev                                # http://127.0.0.1:8787
# in another shell: send a raw RFC 822 email (needs a Message-ID header)
curl -X POST --data-binary @message.eml \
  'http://127.0.0.1:8787/cdn-cgi/handler/email?from=noreply@portal.example&to=<ingest address>'
CLOUDFLARE_EMAIL_QUEUE_URL=http://127.0.0.1:8787 CLOUDFLARE_EMAIL_QUEUE_TOKEN=<.dev.vars token> \
  pnpm --filter @homefinder/scraper ingest-emails --dry-run
```

Automated tests need no network, Cloudflare account or database: `pnpm test` in the Worker folder (D1 is emulated with
Node's SQLite running the real migration) and in `packages/scraper` (parsers, client, ingest logic, and the real
pipeline against an in-memory fake database). Synthetic fixtures live in `packages/scraper/fixtures/email/`.

## Retention and limits

| What | Default | Override (Worker var) |
| --- | --- | --- |
| Processed messages: bodies, addresses and subject scrubbed after | 3 days | `PAYLOAD_RETENTION_DAYS` |
| Quarantined messages: scrubbed after (kept longer to diagnose) | 30 days | `QUARANTINE_RETENTION_DAYS` |
| Rows (only dedupe keys remain after scrubbing) deleted after | 60 days | `METADATA_RETENTION_DAYS` |
| Unprocessed messages older than this are quarantined as `expired` | 14 days | `PENDING_MAX_AGE_DAYS` |
| Max raw message size (larger is rejected at SMTP time) | 512 KiB | `MAX_RAW_BYTES` (can only be lowered) |
| Max stored text / HTML | 100 k / 300 k characters (larger → quarantined `body_too_large`, nothing stored) | – |

Cleanup runs from a daily Cron Trigger (`wrangler.jsonc` → `triggers.crons`). Attachments are never stored.

**Cloudflare Free-plan quotas** (checked against Cloudflare's documentation while building this):
D1 Free: 5 million rows read/day, 100,000 rows written/day, 5 GB storage. Workers Free: 100,000 requests/day, **10 ms
CPU per invocation**, 5 Cron Triggers per account. Email Routing messages are limited to 25 MiB overall. A personal
alert flow uses a tiny fraction of the request/D1 budgets. The one material risk is the **10 ms CPU limit**: parsing
a large HTML email in the Worker might exceed it, which is why the default size cap is 512 KiB. Watch the Worker's CPU
time in the dashboard after the first real emails; if invocations fail, lower `MAX_RAW_BYTES` or move to Workers Paid.
Quotas change; re-check [the D1 pricing page](https://developers.cloudflare.com/d1/platform/pricing/) and
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## Rotating the token

```bash
openssl rand -hex 32
pnpm exec wrangler secret put HOMEFINDER_QUEUE_TOKEN     # in infra/cloudflare-email-worker; takes effect immediately
# then update CLOUDFLARE_EMAIL_QUEUE_TOKEN in the local .env
```

## Troubleshooting

| Symptom | Likely cause / action |
| --- | --- |
| `Configuration error: … is not set` | Add `CLOUDFLARE_EMAIL_QUEUE_URL` / `_TOKEN` to `.env`. URL must be https (http only for localhost) with no query string; the token must be ≥ 32 chars. |
| `Authentication failed … (HTTP 401)` | Token mismatch between `.env` and the Worker secret. Re-set both (see rotation). |
| `HTTP 503 not_configured` | The Worker has no (or a short) `HOMEFINDER_QUEUE_TOKEN`. |
| `Queue unavailable` | Network/Cloudflare problem or the Worker is not deployed. Nothing is lost; rerun later. |
| `Queue is rate limiting us` | HTTP 429. The CLI does not retry in a loop; try later. |
| `Queue reachable; nothing pending.` | Healthy and empty. Check `--stats`, the Email Routing rule, and that the portal alert targets the ingest address. |
| Messages `quarantined` with `no_listing_links`, `no_priced_listing_blocks`, `portal_not_identified` | The email layout or link format differs from the parser's assumptions (likely until real samples are used) or links are tracking redirects on other hosts. Sanitise a sample and adapt the parser. |
| `no_valid_candidates`, many `location_unresolved` / `missing_area` | The email does not show area or a recognisable place, or shows several; those are rejected rather than guessed. |
| `pipeline_error` / `retryable_error` | Database or pipeline failure. Retried up to 5 times, then quarantined. Check the Supabase connection string. |
| Duplicate messages | Expected after retries or redelivery; the queue and the pipeline deduplicate. |
| Sender rejected / recipient rejected | `ALLOWED_SENDER*` or `HOMEFINDER_INGEST_ADDRESS` does not match what the portal sends to. |
| Worker errors on large emails | Likely the Free-plan CPU limit; see *Retention and limits*. |

A message that hits an internal Worker error during receipt is rejected with `Processing error` so the sending server
may retry; very rarely that can lose an alert, which is acceptable for a personal notifier.

## Security model

- All mail content (headers, bodies, links, HTML) is **untrusted data**: parsed, never rendered; no link is fetched,
  no image loaded, no script run (`cheerio` parses HTML into a tree and executes nothing).
- Only `https` links on the portals' own hostnames are accepted, with query strings and fragments dropped; look-alike
  hosts, credentials, custom ports and `javascript:` links are ignored.
- The API requires a bearer token (constant-time comparison); the token never appears in URLs, logs or error bodies.
  Error responses contain only a short code. Logs contain event names and ids only.
- No secrets in the repository. The Worker secret lives in Cloudflare; the local copy in the git-ignored `.env`.
