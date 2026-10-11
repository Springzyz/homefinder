# CLAUDE.md: working notes for Claude Code

Read this first in every session. Keep it current: update **Current state** and append to **Session log** at the end of each prompt/task. This repo is **public**: never write secrets, tokens, passwords, emails, chat IDs, Supabase project refs or the owner's personal data here or anywhere committed.

## What this project is
Personal Portuguese home-deal notifier. Poll portals → store listings in Supabase Postgres → score €/m² against local medians → alert via Telegram/email → web UI to manage searches and browse deals. Full description in `README.md`. Target cost ≈ €0/month. Single user, buy only, English UI.

## Layout and commands
- `packages/core`: pure TS logic + vitest (scoring, matching, dedupe, stats, places). No I/O.
- `packages/scraper`: adapters (`src/adapters/*`), `fetch.ts` (polite fetch), `pipeline.ts` (the run), `notify.ts`, CLIs (`run.ts`, `migrate.ts`, `link-telegram.ts`, `set-email.ts`).
- `infra/cloudflare-email-worker`: Cloudflare Email Worker + D1 queue + authenticated pull API (own `package.json`, **outside** the pnpm workspace; install with `pnpm install --ignore-workspace`; tests use Node's `node:sqlite` as a D1 shim, loaded via `createRequire`). Never deploy/configure Cloudflare without explicit approval.
- `packages/scraper/src/email-ingestion/` (queue client, ingest loop) and `adapters/email/` (Imovirtual/Supercasa parsers). CLI: `pnpm --filter @homefinder/scraper ingest-emails [--dry-run|--stats|--limit=N|--no-notify|--no-seed]`. Guide: `docs/cloudflare-email-ingestion.md`.
- `apps/web`: Next.js 15 App Router, Tailwind 4, server actions, direct `pg` access, password gate in `src/middleware.ts` + `src/lib/session.ts`.
- `supabase/migrations/*.sql`, applied by `pnpm --filter @homefinder/scraper migrate` (tracked in `_migrations`).
- Node is installed via fnm at `~/.local/share/fnm`. Shell state does not persist, so prefix commands with `export PATH=$HOME/.local/share/fnm/aliases/default/bin:$PATH`.
- Verify: `pnpm typecheck && pnpm test`, and `cd apps/web && pnpm build` for UI/core changes.
- Poll: `pnpm --filter @homefinder/scraper poll --portal=casasapo [--pages=N] [--no-notify]`.
- Scheduler: systemd **user** timer `homefinder-poll.timer` (07:00–22:59, every 30 min, ~4 min random delay), runs `poll --portal=casasapo`. Check with `systemctl --user list-timers`.

## Hard rules (learned the hard way)
1. **Verify before every commit/push.** Run typecheck + tests (+ web build when relevant) and read the result. Never chain `git push` after an unchecked `grep`; once broke `main` this way. Never `git add -A` blindly: look at `git status` first so unfinished work is not committed.
2. **Secrets**: values live only in `.env` (git-ignored). Never print them; mask when inspecting (`sed`, length checks). Before publishing, scan tracked files for `.env` values and personal data.
3. **Be polite to portals; never evade blocks.** Stop on 403/429/challenge (the fetcher retries once after ~30 s, then stops). No UA/TLS/proxy tricks. Do not hammer while testing: Casa Sapo returns 429 after only a few quick requests. Prefer fixtures; do live requests sparingly and spaced out.
4. Anything outward-facing or hard to reverse (push, making things public, installing system-level things, persistent schedulers) needs the user's authorization; the user has authorized pushing to this repo's `main` and the local systemd timer.
5. Fixtures in `packages/scraper/fixtures/` are raw third-party pages: git-ignored, never commit. Tests that need them use `describe.skipIf`.
6. Don't kill processes with a pattern that matches your own command line (use `pgrep -f "[n]ext-server"`); `pgrep -x next-server` does not match. Stop any dev/prod server you start.
7. Time zones: the DB and GitHub timestamps are UTC; the machine is BST. Don't misread run times.
8. Tell the user plainly about mistakes, failed checks, and skipped steps.

9. Follow `HOMEFINDER_CLAUDE_IMPLEMENTATION_BRIEF.md` (user-authored, untracked) for the email-ingestion work: it forbids committing, pushing, deploying, DNS or live-timer changes unless authorised in the current session.
10. Never use broad `pkill -f`/`pgrep -f` patterns that appear in your own command line (it killed the shell twice: `rm -rf .wrangler .dev.vars` matched `wrangler.*dev`). Kill by PID after listing, or run the kill in its own command.

## Key decisions
- Auth: single password + signed cookie (not Supabase Auth); DB accessed server-side via the pooler connection string (no anon key in the browser). RLS enabled, no public policies.
- Supabase **direct** host is IPv6-only and unreachable from WSL → use the Session pooler string; password must not keep the template's `[ ]`.
- Scheduling moved from GitHub Actions to a local systemd timer: portals block GitHub's datacenter IPs. The workflow is manual-only.
- OLX **parked** (403 to Node's HTTP client but 200 to curl = fingerprint bot filter; user chose to respect it). Adapter kept in `PARKED_ADAPTERS`.
- Imovirtual/Supercasa (Cloudflare) → via their saved-search alert emails (needs sample emails from the user). Idealista → official API, access requested, don't count on it.
- First successful run per portal seeds silently (no alerts). Unrated listings (no benchmark yet) still alert. Alerts capped at 25/run.
- Place list: 308 municipalities mapped to districts (Azores/Madeira as regions), validated against geoapi's name list; `suggestPlaces` / `resolvePlace` in `packages/core/src/places.ts`.
- Email ingestion: Cloudflare Email Routing → Email Worker → D1 queue; the local scraper **pulls** (Worker can't reach localhost; nothing exposed). Ack only after processing; at-least-once, idempotent via (portal,portal_id) upserts + unique notifications. Parsers read only grounded fields, reject (never guess) ambiguous price/area/place, only accept https links on portal hosts. **Parsers are UNVERIFIED**: written against synthetic fixtures; real sanitised samples are required before trusting them. `processListings()` in `pipeline.ts` is the shared seam (run() uses `upsertListings`/`finalize` too).
- Workers Free: 10 ms CPU/invocation → raw mail cap 512 KiB. D1 Free: 5M reads/100k writes per day.
- Scoring: median €/m² at freguesia → concelho → distrito, n ≥ 15, thresholds 25/15/5 %.

## Current state (update me)
- **Email ingestion committed locally** (not pushed unless stated in the log). Real values (ingest address, D1 id, queue URL/token, sender allowlist) live only in `.env` and the **untracked-by-intent local edit of `infra/cloudflare-email-worker/wrangler.jsonc`**; the committed version has placeholders. After any commit, the real file must be restored (a copy is not kept in the repo); never `git add` that file with real values.
- **Cloudflare**: Worker `homefinder-email-ingest` deployed with `ALLOWED_SENDERS` = the Idealista sender + the user's own Gmail (for manual forwards); domains empty. Gmail filter on `naoresponder@idealista.pt` forwards to the ingest address (address verified). Unverified risk: the envelope sender of filter-forwarded mail was never observed (only a manual forward); if the daily mail stops arriving, check `wrangler tail` for `rejected: sender` and relax the allowlist.
- **Parsers**: Idealista parser is built from one real mail (only "Novidade" cards; place via concelho, else via the freguesia lookup in `packages/core/src/freguesias.ts`). Imovirtual/Supercasa parsers are still UNVERIFIED (synthetic fixtures only).
- **First real ingest done**: 1 Idealista listing stored (seeded silently), 3 test messages quarantined; queue empty.
- **Supabase/Telegram/Resend**: migration applied; one search; Telegram linked; email delivery untested. Few benchmarks (backfill `--pages=5 --no-notify` not run).
- **Local timer** `homefinder-poll.timer` (Casa Sapo only) installed. `ingest-emails` is NOT scheduled yet.

## Next steps
1. Verify tomorrow's daily Idealista mail arrives through the Gmail filter (queue stats / `ingest-emails --dry-run`); if rejected, see the risk above.
2. Schedule `ingest-emails` (systemd user timer) once the first filter-forwarded mail has been seen working; needs user approval.
3. User creates Imovirtual and Supercasa saved-search alerts addressed to the ingest address; sanitise real samples and fix those parsers.
4. Optional: tie-break shared freguesia names using the concelhos of the user's saved searches.
5. Older items: benchmark backfill; verify the first timer run; WSL keep-alive; deploy the web UI; Idealista API adapter if granted.
6. Check the Worker's CPU metrics after the first real emails (Workers Free = 10 ms CPU).

## Session log (append one entry per prompt)
- **Plan**: asked requirements; chose Email+Telegram, free-tier cloud, hybrid scraping, single user/buy-only; wrote the plan.
- **Scaffold + core**: installed Node via fnm; pnpm monorepo; core scoring/matching/dedupe/stats with tests; Supabase schema.
- **Adapters + DB**: OLX and Casa Sapo parsers from live fixtures; Supercasa is behind Cloudflare; fixed `.env` password brackets; applied migration.
- **Pipeline + notifiers**: polite fetch, upsert, scoring, dispatch, Telegram link CLI; hit 429/403 from portals while testing and backed off.
- **GitHub Actions**: workflow, secrets guidance, security audit (no secrets/PII; fixtures excluded); pushed.
- **Web UI**: Next.js app with password gate; tested login, pages, create/delete flows against the real DB.
- **Images fix + pages advice**: Casa Sapo lazy-load placeholder bug fixed; recommended `pages=5` once for backfill.
- **Poll debugging**: Actions run was green but both portals blocked the runner → moved to local systemd timer, removed Actions schedule, parked OLX, slowed backfills. Mistake: pushed unfinished code once, repaired within minutes.
- **Location picker**: 308 municipalities, accent-insensitive suggestions, multi-place searches, tests; untracked build artifacts.
- **Docs (this prompt)**: rewrote `README.md`, added `.env.example` and this file.
- **Email ingestion (brief)**: followed `HOMEFINDER_CLAUDE_IMPLEMENTATION_BRIEF.md`. Refactored `pipeline.ts` into reusable `upsertListings`/`finalize`/`processListings`; added core number parsing (`numbers.ts`); built the Worker (D1 migration, MIME limits, idempotency key, authenticated pull/ack/fail/stats API, retention cron), scraper queue client + ingest CLI + two portal parsers, synthetic fixtures, docs. Tests caught two parser bugs (flattened text glued fields; first-match place guessing) and I lowered the mail cap after verifying the 10 ms Free CPU limit. Did not commit/push/deploy.
- **Cloudflare deploy**: with explicit approval, logged in wrangler (OAuth), created D1, applied migration, deployed Worker, uploaded the token secret (piped from `.env`, never displayed), verified /health, auth (401), and `ingest-emails --stats`. workers.dev certificate took a few minutes.
- **Pause (2026-10-11)**: user paused the session to save RAM. Learned the user's only Idealista mail is a login notice, not an alert, and recorded the safe plan (create an alert first, filter on real From + subject). Rewrote Resume/Current state/Next steps in this file for the next session. No code changed in this step.
- **Resumed after pause**: loaded CLAUDE.md, checked the queue (still only the 2 test messages), recorded the real Idealista sender/subject from the user's screenshot and the plan to obtain a sanitised sample via manual Gmail Forward. No code changed.
- **Idealista parser**: the user's Gmail forwarding to the ingest address works (verified address; filter on `naoresponder@idealista.pt`, the real daily-summary sender, subject "Resumo diário de novos imóveis"; a manual forward keeps the user's own Gmail as sender with the original From inside the body). Added `adapters/email/idealista.ts` (+ `cardFields` hook in `shared.ts`, `idealista` in `EmailPortal`), sanitised synthetic fixture `fixtures/email/idealista-daily-summary.html`, tests (core 33, scraper 72 pass, typecheck clean). Rules: only "Novidade" cards (user's choice), price = the "€" figure not "€/m²", area from the details line only (typology stripped so "T3 100 m²" is not 3100), advertiser free text never read. Open problem: cards give only street + neighbourhood ("Rua do Beato, Beato"); the real sample's only Novidade was rejected `location_unresolved` (neighbourhood is not a concelho), so it would be quarantined. Needs a user decision (neighbourhood→concelho mapping vs. other). Not deployed; `ALLOWED_SENDERS` still empty; queue still holds 4 old messages (not acked). Nothing committed.
- **Freguesia lookup (user chose option 1/"find where it is")**: added `packages/core/src/freguesias.ts` + generated `freguesias.data.ts` (3,254 freguesias → 306 concelhos, from Aldeias Portuguesas v2026.2, CC BY-SA 4.0, attribution in the file header; the geoapi free API was rate-limited, 429). `shared.ts` falls back to it only when no concelho is named: the LAST component that is a known freguesia decides; a name shared by several concelhos must be narrowed by an earlier freguesia component, else `location_unresolved` (never guessed). It does NOT set `Listing.freguesia` (kept null to avoid mixing with Casa Sapo's freguesia strings). Real sample now parses to 1 listing (Beato → Lisboa). Checks: typecheck clean, core 33, scraper 75 pass; web build not re-run. Possible tie-break for shared names: prefer concelhos in the user's own saved searches (not built). Still not deployed/committed; queue unchanged.
- **Rollout (user said "do all of those")**: ran the real `ingest-emails` (1 listing, 3 quarantined); set `ALLOWED_SENDERS` and redeployed the Worker (health ok); verified typecheck, core 33 / scraper 75 / worker 46 tests, web build; scanned the files to commit for `.env` values and personal data (only the real `wrangler.jsonc` leaked, so it is committed with placeholders). Committed locally; not pushed.
