# CLAUDE.md: working notes for Claude Code

Read this first in every session. Keep it current: update **Current state** and append to **Session log** at the end of each prompt/task. This repo is **public**: never write secrets, tokens, passwords, emails, chat IDs, Supabase project refs or the owner's personal data here or anywhere committed.

## What this project is
Personal Portuguese home-deal notifier. Poll portals → store listings in Supabase Postgres → score €/m² against local medians → alert via Telegram/email → web UI to manage searches and browse deals. Full description in `README.md`. Target cost ≈ €0/month. Single user, buy only, English UI.

## Layout and commands
- `packages/core`: pure TS logic + vitest (scoring, matching, dedupe, stats, places). No I/O.
- `packages/scraper`: adapters (`src/adapters/*`), `fetch.ts` (polite fetch), `pipeline.ts` (the run), `notify.ts`, CLIs (`run.ts`, `migrate.ts`, `link-telegram.ts`, `set-email.ts`).
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

## Key decisions
- Auth: single password + signed cookie (not Supabase Auth); DB accessed server-side via the pooler connection string (no anon key in the browser). RLS enabled, no public policies.
- Supabase **direct** host is IPv6-only and unreachable from WSL → use the Session pooler string; password must not keep the template's `[ ]`.
- Scheduling moved from GitHub Actions to a local systemd timer: portals block GitHub's datacenter IPs. The workflow is manual-only.
- OLX **parked** (403 to Node's HTTP client but 200 to curl = fingerprint bot filter; user chose to respect it). Adapter kept in `PARKED_ADAPTERS`.
- Imovirtual/Supercasa (Cloudflare) → via their saved-search alert emails (needs sample emails from the user). Idealista → official API, access requested, don't count on it.
- First successful run per portal seeds silently (no alerts). Unrated listings (no benchmark yet) still alert. Alerts capped at 25/run.
- Place list: 308 municipalities mapped to districts (Azores/Madeira as regions), validated against geoapi's name list; `suggestPlaces` / `resolvePlace` in `packages/core/src/places.ts`.
- Scoring: median €/m² at freguesia → concelho → distrito, n ≥ 15, thresholds 25/15/5 %.

## Current state (update me)
- Core, Casa Sapo adapter, pipeline, notifiers, web UI (deals, searches with location picker, listing, market, settings), docs: done and pushed to `main`.
- DB: migration `0001_init.sql` applied; one search ("Lisboa T2 ≤ 400k", min label good, telegram+email). ~50 Casa Sapo listings, almost no benchmarks (stats need ≥15 per area+typology).
- Telegram linked, email address set, Resend key stored in `.env`. Email delivery **not yet tested**.
- Timer installed; first real run expected the morning after setup. Not yet verified.
- Casa Sapo was rate-limited (429) during testing; benchmarks backfill (`--pages=5 --no-notify`, ~4 min) still to run after cooldown.
- WSL may sleep and pause the timer; keep-alive (Windows scheduled task) undecided.

## Next steps
1. Run the backfill; manually start `homefinder-poll.service` once; confirm a Telegram alert and an email arrive end to end.
2. WSL keep-alive decision.
3. Imovirtual/Supercasa alert-email parser (ask the user for sample emails; IMAP or forwarding).
4. Idealista adapter if API access is granted.
5. Deploy the web UI (Vercel free tier) with the same env vars; add `.env.example` references to docs (done).
6. Possible: price-drop re-alerts, freguesia-level locations, digest mode.

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
