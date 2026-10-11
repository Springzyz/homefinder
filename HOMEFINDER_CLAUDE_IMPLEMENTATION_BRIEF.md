# HomeFinder — Claude Code Implementation Brief

**Task:** Implement saved-search email ingestion for Imovirtual and Supercasa using Cloudflare Email Routing, a Cloudflare Worker, and D1, integrating the resulting listings into HomeFinder's existing scraper pipeline.

**Primary goal:** Improve listing coverage without bypassing portal protections, exposing the developer's local machine, or rewriting HomeFinder's existing business logic.

## 1. Instructions to Claude Code

Treat this document as an implementation brief, not as permission to deploy infrastructure. Work in the existing repository and follow `CLAUDE.md` first.

Before changing code:

1. Read `CLAUDE.md`, `README.md`, `package.json`, `pnpm-workspace.yaml`, the scraper package scripts, and the relevant implementation in `packages/scraper` and `packages/core`.
2. Inspect the current working tree with `git status --short`. Preserve the user's existing changes; do not reset, clean, or overwrite unrelated work.
3. Trace the current listing lifecycle from a portal adapter through parsing, validation, database upsert, scoring, saved-search matching, and notifications. Identify the smallest safe way to reuse it for email-derived listings.
4. Inspect existing types and migrations before proposing schema changes. Avoid duplicating existing abstractions.
5. If no real, sanitised alert-email samples are present, implement the transport, queue, parser interfaces, and tests using synthetic fixtures. Do not claim the portal-specific parsers are production-validated until they have been tested against real sample emails.

Implement the work in small, testable steps. Run the relevant checks after each major step and finish with the full required checks. Do not commit, push, deploy, configure DNS, create cloud resources, or change persistent scheduling unless explicitly authorised in the current session. Report all checks that could not be run.

## 2. Existing project constraints

The public repository currently describes this architecture:

- pnpm TypeScript monorepo; Node.js 22 or newer.
- `packages/core`: pure business logic, types, deal scoring, saved-search matching, cross-portal deduplication, market statistics, and place lookup.
- `packages/scraper`: portal adapters, polite fetcher, pipeline, Postgres/Supabase persistence, Telegram/Resend notifications, and CLI commands.
- `apps/web`: Next.js 15 application reading Postgres server-side.
- Supabase Postgres stores listing and application data.
- A local `systemd` timer runs the scraper on the developer's machine approximately every 30 minutes. GitHub-hosted polling was abandoned because portals blocked datacenter IPs.
- Casa Sapo is active and must not regress.
- OLX is deliberately parked after returning HTTP 403 to the current HTTP client. The repository explicitly chooses not to work around portal blocks.
- Idealista is waiting for official Search API access.
- Imovirtual and Supercasa are intended to use the portals' own saved-search alert emails; direct access is currently unreliable/blocked.
- The existing pipeline owns listing upserts, scoring, alert matching, and notifications. Preserve those semantics.
- Keep the project close to €0/month and single-user unless the repository has changed since this brief was prepared.

The repository may have evolved. Treat the current checkout as the source of truth and reconcile this brief with current code rather than blindly following assumed file names or APIs.

## 3. Architecture decision

### Use a Cloudflare-hosted inbound email queue, consumed by the existing local poller

The scraper currently runs locally. A Cloudflare Worker cannot call `localhost` on the developer's computer, and exposing a home machine to the public Internet merely to receive alerts would add unnecessary risk. Therefore, use this flow:

```text
Imovirtual / Supercasa saved-search alert emails
                    |
                    v
        Cloudflare Email Routing
                    |
                    v
       Cloudflare Email Worker
       - parses MIME safely
       - rejects unsupported/oversized mail
       - stores the message in D1
                    |
                    v
       Authenticated Worker API
       - list pending messages
       - acknowledge processed messages
       - expose a minimal health check
                    ^
                    | outbound HTTPS from the local machine
                    |
       HomeFinder email-ingestion CLI
       - retrieves pending messages
       - selects the portal-specific parser
       - validates and normalises candidate listings
       - passes listings to the existing pipeline
       - acknowledges a message only after successful handling
                    |
                    v
          Existing Supabase/Postgres pipeline
       upsert -> score -> match -> notify -> UI
```

**Do not add an unauthenticated public endpoint to the local Next.js app. Do not expose the local machine. Do not connect the Worker directly to Supabase/Postgres unless the existing architecture and a clear technical reason make the queue design unsuitable.** The default design is a D1 inbox/queue with an outbound pull from the scraper.

Keep the Cloudflare Worker outside the existing `apps/*` and `packages/*` workspace globs (for example, `infra/cloudflare-email-worker/`) unless there is a clear reason to change the workspace. Avoid adding Cloudflare dependencies to the core application unnecessarily.

The initial implementation must not require an LLM or a paid API. Use deterministic parsing first. Leave a clean parser interface so an optional model-based fallback can be considered later, but do not implement or call an AI provider in this task.

## 4. Scope

### In scope

1. Cloudflare Email Worker that receives mail using Cloudflare Email Routing.
2. MIME parsing using a small, maintained library compatible with the Workers runtime, such as `postal-mime`, after verifying current compatibility.
3. D1 schema/migration for durable message queuing, idempotency, processing state, timestamps, and bounded retention.
4. An authenticated Worker HTTP API used by the local scraper to pull messages and acknowledge successful processing.
5. A scraper-side queue client and CLI command to process pending email messages.
6. Portal-specific email parser modules for Imovirtual and Supercasa, based on real sample messages when available.
7. Reuse of the existing listing-processing pipeline rather than duplicating scoring, deduplication, upserts, saved-search matching, or notifications.
8. Unit/integration tests, local-development instructions, deployment setup instructions, and README updates.
9. A documented manual setup checklist for Cloudflare Email Routing and environment variables.

### Out of scope

- Circumventing Cloudflare challenges, CAPTCHA, bot detection, 403/429 responses, IP blocks, TLS/browser fingerprint checks, or portal access controls.
- Unauthorised direct scraping of Idealista, Imovirtual, Supercasa, or OLX.
- Re-enabling the OLX adapter or changing its parked status.
- Pretending that an API is available before access is granted. Idealista integration remains conditional on official API access.
- Deploying resources, changing DNS, adding real secrets, or modifying the running `systemd` timer without explicit approval.
- Building a general-purpose autonomous browser agent.
- Introducing paid AI inference or requiring a paid Cloudflare plan.
- Rewriting the web UI or existing notification system.

## 5. Suggested implementation layout

Confirm exact existing naming conventions before adding these files. Adjust paths if the repository has evolved.

```text
infra/
  cloudflare-email-worker/
    package.json
    tsconfig.json
    wrangler.jsonc                 # no secrets
    src/index.ts                   # email() and fetch() handlers
    src/mime.ts                    # MIME parsing and size limits
    src/queue.ts                   # D1 operations
    migrations/0001_email_queue.sql
    test/                           # Worker/API/email event tests

packages/scraper/src/
  email-ingestion/
    client.ts                      # authenticated Worker API client
    ingest.ts                      # pull -> parse -> existing pipeline -> ack
    types.ts                       # validated queue response types
  adapters/email/
    imovirtual.ts                  # alert-email parser
    supercasa.ts                   # alert-email parser
    shared.ts                      # safe link extraction and helpers
  ... existing CLI files ...

packages/scraper/fixtures/email/
  README.md                        # rules for sanitised/synthetic fixtures
  *.eml or *.json                  # synthetic or fully redacted samples only

docs/
  cloudflare-email-ingestion.md    # setup, operation, troubleshooting
```

Do not commit real email exports, private listing alerts, credentials, or unredacted HTML containing personal data. Fixtures in tests must be synthetic or sanitised and must not contain real email addresses, search URLs with personal tokens, or other private information.

## 6. Cloudflare Worker requirements

### 6.1 Inbound email handler

Implement Cloudflare's Email Worker handler using the current documented runtime types. It should:

- Accept email only for the configured HomeFinder ingestion address/alias.
- Apply configurable sender allow-lists after actual sender addresses are confirmed from sample emails. Do not hard-code guessed portal sender addresses.
- Parse MIME headers and bodies without rendering email HTML in a browser.
- Prefer text/plain when useful, while retaining bounded HTML where required to extract actual listing links. HTML is untrusted input and must never be rendered or executed.
- Enforce a conservative maximum email size and body length. Handle oversized messages explicitly rather than exhausting Worker memory.
- Ignore attachments in the first version; do not store attachment bytes.
- Extract a stable `Message-ID` if available and compute a deterministic fallback SHA-256 idempotency key when it is not. Never trust a supplied `Message-ID` as the only deduplication mechanism without a fallback.
- Store sufficient metadata for diagnosis and parsing: internal id, idempotency key, sender, recipient, subject, received timestamp, body text, and bounded HTML if needed, detected portal (only when reasonably identified), status, attempt count, and error summary.
- Never log full bodies, complete listing URLs, email addresses, tokens, or raw MIME contents.
- Fail safely. An invalid email must not cause an unhandled exception or block unrelated messages.

Use a D1 migration checked into the repository. Include useful indexes for status and received time. Use parameterised D1 queries. Store only the minimum data needed and document retention. A suggested policy is to retain payloads only long enough for processing/retry and delete or scrub processed payloads after a short configurable retention period, while retaining minimal deduplication metadata for a longer bounded period. Make actual retention behaviour explicit and test it.

### 6.2 HTTP API

Provide a small API on the same Worker, separate from the inbound email handler:

- `GET /health`: minimal health response, no sensitive configuration.
- `GET /api/v1/messages?limit=N`: returns oldest pending messages in a bounded batch (for example, 20 maximum).
- `POST /api/v1/messages/ack`: acknowledges message IDs after the consumer has successfully processed them.
- An optional authenticated failure/retry endpoint may be added if necessary, but keep the protocol small.

Requirements:

- Every data endpoint must require a high-entropy bearer token stored as a Worker secret and in the local `.env` (git-ignored). Never place the token in URLs, query strings, logs, source code, fixtures, or committed configuration.
- Use strict request-method handling, bounded request bodies, input validation, and sensible error responses.
- Do not include bodies or credentials in error responses.
- Ensure only pending messages are returned and acknowledgements are idempotent.
- A message must not be irreversibly acknowledged before HomeFinder successfully handles it. If the local process fails before acknowledgement, the message must be available for retry.
- At-least-once delivery is acceptable; duplicate processing must be safe because the existing pipeline is idempotent/deduplicating. Verify this in the current code.
- Prevent unbounded queue growth. Provide documented retention/cleanup and queue-size/age visibility. Respect Cloudflare Free plan quotas and verify current limits during implementation.

A single local consumer is the initial assumption. If implementation supports concurrent consumers, add a safe claim/lease mechanism rather than introducing race conditions. Do not build unnecessary distributed-queue complexity for a single-user app.

### 6.3 Runtime and configuration

- Use TypeScript and current Cloudflare Workers tooling compatible with the Workers email event API.
- Add no secrets to `wrangler.jsonc`.
- Include `.dev.vars.example` or equivalent with placeholder values only.
- Document required Worker secret names, D1 database creation/migrations, email routing address setup, and how to deploy manually.
- Keep deployment commands separate from tests. Do not run production deployment or make DNS changes in this task.
- The design should fit Cloudflare Free where practical. Explicitly document any current quota that could be material and verify it against official Cloudflare documentation rather than assuming it is unchanged.

Suggested configuration names (adapt to project conventions):

- Worker secret `HOMEFINDER_QUEUE_TOKEN`
- Worker variable `HOMEFINDER_INGEST_ADDRESS`
- Worker variable `ALLOWED_SENDER_DOMAINS` or a safer exact-sender allow-list once real senders are known
- Local `.env` variables `CLOUDFLARE_EMAIL_QUEUE_URL` and `CLOUDFLARE_EMAIL_QUEUE_TOKEN`

Do not put actual values in `.env.example`. Validate that URL and token are present before the CLI performs network requests, and provide a clear error message when configuration is missing.

## 7. Scraper-side ingestion requirements

### 7.1 Queue client

Build a typed client that:

- Calls the Worker API over HTTPS.
- Uses an `Authorization: Bearer ...` header.
- Has connection/request timeouts and bounded response sizes.
- Validates the shape and maximum number of messages returned; do not assume API JSON is valid just because the Worker is yours.
- Handles 401/403 as configuration/authentication errors, 429 as a backoff condition, and 5xx/network errors as retryable failures.
- Never logs secrets or raw email bodies.
- Uses no unbounded retry loop.

### 7.2 Portal parsers

Implement separate parsers for Imovirtual and Supercasa. Each parser should transform an alert email into zero or more candidate listings matching the current project types. Keep parsing separate from database writes and notifications.

For each candidate, extract only grounded fields actually present in the email, such as:

- portal/source identifier;
- original listing URL;
- listing title;
- price in EUR;
- area in square metres, if explicitly available;
- typology, if explicitly available;
- location/place text, if available;
- condition, if explicitly available;
- source timestamp or received timestamp as appropriate.

Validation rules:

- Verify that listing URLs use HTTPS and an expected canonical portal hostname. Do not fetch those URLs during parsing.
- Reject malformed or unrelated links; do not accept arbitrary URLs from email content.
- Parse Portuguese number formats correctly (e.g. `250 000 €`, `250.000 €`, and decimal area formats), with explicit tests.
- Do not guess missing values, derive a property area from unrelated email text, or pass placeholder values into scoring as if they were real.
- Treat missing or low-confidence data according to existing domain rules. If the current `Listing` type cannot represent an incomplete candidate safely, quarantine it with a structured parse result rather than inventing values.
- Support emails containing multiple listings if the sample format does so.
- Be resilient to extra whitespace, accents, tracking parameters, and small template changes, but do not use broad heuristics that silently assign the wrong price or area.
- If the email is not a supported alert, return an explicit `ignored`/`unsupported` parse result with a short reason; don't silently mark all malformed messages successful.

Do not invent portal-specific DOM/HTML selectors or email patterns without fixtures. If no real samples exist, create synthetic fixtures that exercise the parser contract, clearly label them as synthetic, and document the remaining limitation. Keep parser functions deterministic and unit-testable.

### 7.3 Integrate with the existing pipeline

The queue consumer must call the same business path that the existing portal adapter uses for persistence, cross-portal deduplication, market scoring, saved-search matching, and Telegram/email notifications.

- Prefer a small refactor that extracts/reuses a shared `processListings`-style function, if required by the current structure.
- Do not fork or reimplement scoring, dedupe, upsert, or notification code inside `email-ingestion`.
- Preserve existing alert rules, including first-run seeding behaviour, alert limits, and “alert each search/listing/channel at most once”. Confirm current behaviour before refactoring.
- Define how an email with multiple listings is handled: a message should only be acknowledged once all valid candidates have been processed and the message has a deliberate terminal parse outcome.
- Invalid candidates should not prevent valid candidates from being persisted unless the current transaction model requires atomic handling. Report candidate-level failures explicitly.
- Make repeated consumption safe. Repeated email delivery or a crash between database upsert and acknowledgement must not generate duplicate alerts.
- Add a CLI entry point consistent with existing commands, for example `pnpm --filter @homefinder/scraper ingest-emails` (or the project's established naming convention).
- Add flags only where useful for local testing, e.g. `--limit=N` and `--no-notify`; do not create a second notification implementation.
- The current scheduled poll must not start making direct calls to Imovirtual/Supercasa. Add the email queue command to scheduling only as a documented/manual step; do not modify the live timer without approval.

### 7.4 Portal source state

- Casa Sapo: unchanged and must continue to work.
- Imovirtual: email ingest enabled only once the configured address/sender and parser are ready.
- Supercasa: email ingest enabled only once the configured address/sender and parser are ready.
- Idealista: continue waiting for official Search API access. Any future adapter must use the approved API and be isolated behind the existing adapter interface.
- OLX: keep parked. Never bypass the 403/bot filter.

If parser confidence is insufficient, mark the message/candidate for retry or manual inspection according to the designed states; do not enable a misleading production-ready status.

## 8. Status model and failure semantics

Use a small, explicit status model. Names may differ, but semantics should be documented and tested:

- `pending`: stored and available to the scraper.
- `processed`: all candidates were handled or the message had a recognised, deliberate terminal outcome (e.g. a legitimate non-listing notification).
- `retryable_error`: a temporary local/database/pipeline failure occurred; eligible for a later attempt.
- `permanent_error` or `quarantined`: malformed/unsupported content needs diagnosis and should not be retried indefinitely.

Store a bounded diagnostic/error code and attempt count, never full body contents in logs. Avoid a poison message blocking later messages. Ensure the operator can distinguish “nothing pending” from “queue unavailable”, “bad token”, “parser unsupported”, and “message processing failed”.

## 9. Security, privacy, and portal-respect rules

These rules are mandatory:

1. Never bypass portal blocks or bot protection. A 403, 429, or challenge remains a reason to stop direct fetching for that source.
2. Use saved-search notification emails and other authorised access methods. Respect each portal's terms and permissions.
3. Keep all tokens in local ignored environment files or Cloudflare secrets. Scan changed/tracked files for accidental secrets and personal information.
4. Treat email sender fields, headers, bodies, links, and HTML as untrusted input.
5. Do not render incoming HTML. Parse it as data only.
6. Do not follow links, load remote images, execute scripts, or fetch arbitrary URLs from an email.
7. Do not log email contents, user search criteria, exact URLs containing tokens, or sensitive fields.
8. Apply payload limits, allow-lists, schema validation, and retention limits.
9. Do not send emails or listings to an LLM/provider in this implementation. The first version should work without AI credentials and without extra per-call cost.
10. Preserve the single-user security model of the app. Do not introduce public database access or put server-side credentials in the browser.

## 10. Tests and acceptance criteria

Add tests using Vitest or the testing framework already used by the repository. Use mocked Worker/D1/fetch components where practical. Tests must be deterministic and must not depend on live portals, DNS, Cloudflare credentials, Supabase, or real email accounts.

### Worker and queue tests

- Valid email is stored once.
- A duplicate `Message-ID` or duplicate fallback hash does not create a duplicate queue record.
- Missing/unsupported MIME is handled safely.
- Oversized email is rejected or quarantined according to the documented policy.
- Sender/recipient rules are applied correctly.
- Email content never appears in normal logs or API error responses.
- Queue API rejects missing and incorrect bearer tokens.
- Invalid methods, malformed JSON, oversized input, and invalid IDs are rejected.
- Pending messages are returned in bounded oldest-first batches.
- Acknowledgement is idempotent and cannot acknowledge unknown/unprocessed IDs without a defined response.
- Messages remain available when the consumer fails before acknowledging them.
- Retention cleanup removes/scrubs the expected payloads without deleting recent pending messages.

### Parser and pipeline tests

- Synthetic/sanitised Imovirtual and Supercasa samples parse as expected.
- Portuguese euro/area formats are parsed correctly.
- Malformed values, missing required fields, and unrelated URLs are rejected.
- All emitted candidate URLs use the expected canonical portal hostnames.
- One email with multiple listings produces the correct number of candidates when supported by the fixture format.
- An unrelated alert is deliberately ignored/quarantined with a useful reason.
- Re-processing the same email is idempotent and does not duplicate database records or notifications.
- Invalid candidates do not accidentally enter benchmark calculations with invented values.
- Existing Casa Sapo, core scoring, matching, deduplication, and notification tests still pass.

### Repository checks

Run and inspect the output of:

```bash
pnpm typecheck
pnpm test
cd apps/web && pnpm build
```

Also run the Worker package's own typecheck/tests/build using its scripts. If one of the commands is not applicable in the current checkout, explain why and run its supported equivalent. Do not claim success without checking exit codes and output.

### Definition of done

- There is a documented end-to-end design and manual Cloudflare setup guide.
- Local scraper can authenticate to the Worker, fetch pending messages, parse supported alert emails, and pass validated listings through the existing business pipeline.
- Messages are acknowledged only after successful handling or a deliberate terminal disposition.
- Failures are retryable or quarantined as documented, with no infinite loops.
- No secrets, personal email data, or real email fixtures are committed.
- Existing Casa Sapo and web application behaviour remains intact.
- Tests and required builds pass, or remaining failures are reported honestly.
- The final response summarises files changed, design choices, commands executed, test outcomes, limitations due to missing real alert samples, and exact manual steps still needed. Do not deploy anything.

## 11. Documentation updates

Update `README.md` concisely to describe email ingestion and link to a new detailed guide, without bloating the main README.

The detailed guide should document:

1. Required Cloudflare account and a domain configured for Cloudflare Email Routing.
2. Creating the D1 database and applying the checked-in migration.
3. Configuring Worker variables and secrets.
4. Deploying the Worker manually (commands only; do not execute production deploy during this task).
5. Creating the Email Routing rule/route to the Worker and configuring portal saved-search alerts to the ingestion address.
6. How to configure sender allow-lists after examining real sender addresses.
7. Local `.env` variables and the CLI command to process queued emails.
8. How to test locally with synthetic emails.
9. Troubleshooting `401/403`, queue unavailable, unsupported email format, parser errors, duplicate messages, and Cloudflare quota limits.
10. How to rotate the shared token and how retention works.
11. Explicitly state that initial parser support requires testing with sanitised real alert emails.

## 12. Recommended execution order

1. Inspect current code and identify the existing shared listing-processing seam.
2. Design the queue contract and types; add tests for the contract first.
3. Implement Worker D1 migration, email handler, authenticated API, and Worker tests.
4. Implement scraper-side queue client and CLI without changing live scheduling.
5. Implement parser modules and fixtures; keep portal-specific functionality clearly marked as unverified if no real samples exist.
6. Connect parsing to the existing pipeline with the smallest necessary refactor.
7. Add idempotency, retry/terminal error handling, and retention tests.
8. Update documentation and examples.
9. Run typecheck, tests, web build, and Worker checks; inspect `git diff` and `git status`.
10. Summarise completed work and outstanding manual configuration. Do not deploy, commit, or push.

**Priority principle:** reliability, maintainability, and respect for portal access controls matter more than maximising scraped volume. Keep the implementation small enough for a single-user app and avoid speculative agentic/browser automation.
