# HomeFinder

A personal deal notifier for the Portuguese housing market. It polls listing portals for **purchase** listings, matches them against saved searches (location, price, €/m², typology, condition), rates each one against the local market, and sends a **Telegram** and/or **email** alert when something good appears.

Single-user, password-protected, designed to run at roughly **€0/month**.

## How the "deal label" works

A T2 at €200k is a great deal in Santarém and a poor one in Lisboa. Each listing's €/m² is compared with the **median €/m² of comparable listings** (same typology, same condition when known) at the most specific area level that has at least 15 samples: freguesia → concelho → distrito.

| Label | Discount vs. median |
| --- | --- |
| 🔥 Steal | ≥ 25 % below |
| ⭐ Great deal | 15–25 % below |
| 👍 Good deal | 5–15 % below |
| Fair price | within ±5 % |
| Above market | > 5 % above |

Benchmarks are rebuilt from the listings already collected (active, seen in the last 90 days) after every poll. A listing is flagged **low confidence** when its benchmark comes from a whole district or from few samples, and shows **Not rated** when no benchmark exists yet. A search's *minimum label* decides which listings trigger an alert (unrated listings are not filtered out).

## Architecture

```
systemd timer (your computer, every 30 min)        Next.js web app (apps/web)
  └─ pnpm poll ── fetch → parse → upsert ──┐         password login, reads Postgres server-side
        score → match searches → notify    ▼
        (Telegram Bot API, Resend)    Supabase Postgres
```

Monorepo (pnpm workspaces, TypeScript):

| Path | What it is |
| --- | --- |
| `packages/core` | Pure logic with unit tests: types, scoring and labels, search matching, cross-portal dedupe, market statistics, the Portuguese place list and accent-insensitive lookup. |
| `packages/scraper` | Portal adapters, polite fetcher, pipeline, Telegram/Resend notifiers, CLI helpers. |
| `apps/web` | Next.js 15 + Tailwind 4 UI: deals dashboard, searches, listing detail, market medians, settings/health. |
| `supabase/migrations` | SQL schema. |
| `.github/workflows/poll.yml` | Manual-only workflow (see *Portals* for why there is no schedule). |

### Notification behaviour

- Each (search, listing, channel) is alerted **at most once**; the same property found on several portals is deduplicated per search.
- The first successful run per portal only **seeds** the database and sends nothing.
- Price drops are detected and recorded; they alert only if that listing was never alerted for the search.
- At most 25 alerts per run.

## Portals

| Portal | Status |
| --- | --- |
| Casa Sapo | ✅ Polled. Strict rate limit (HTTP 429 after a few quick requests), so the fetcher is slow and stops on the first refusal. |
| OLX | ⏸ Adapter written and tested, **parked**: its CDN returns 403 to Node's HTTP client while serving other clients, which is a bot filter we choose not to work around. Re-enable by adding `olx` to `ADAPTERS` in `packages/scraper/src/pipeline.ts`. |
| Idealista | ⏳ Waiting for official Search API access (requested). |
| Imovirtual, Supercasa | 📧 Planned via the portals' own saved-search **alert emails** (Cloudflare challenges block direct access). Not built yet. |

GitHub Actions runners were tried and are **blocked** by the portals (datacenter IPs), so polling runs from a local systemd timer. Be a good citizen: low frequency, newest-first pages only, jittered delays, and never try to evade a block.

## Setup

Requirements: Node ≥ 22, pnpm, a Supabase project (free tier), a Telegram bot (via @BotFather), optionally a [Resend](https://resend.com) API key.

```bash
pnpm install
cp .env.example .env   # then fill in the values (see below)
pnpm --filter @homefinder/scraper migrate          # create the schema
pnpm --filter @homefinder/scraper link-telegram    # after pressing Start in your bot
pnpm --filter @homefinder/scraper set-email you@example.com
```

### Environment variables (`.env`, never committed)

| Variable | Purpose |
| --- | --- |
| `SUPABASE_CONNECTIONSTRING` | Postgres URL. Use the **Session pooler** string (IPv4); the direct host is IPv6-only. Insert the password **without** the `[ ]` that Supabase's template shows. |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather. |
| `RESEND_API_KEY` | Optional; enables email. With Resend's free test sender, mail only reaches your own account address. |
| `RESEND_FROM` | Optional sender, default `HomeFinder <onboarding@resend.dev>`. |
| `APP_PASSWORD` | Password for the web app. |
| `AUTH_SECRET` | Random string used to sign the session cookie (e.g. `openssl rand -hex 32`). |

### Run

```bash
# Web app
cd apps/web && pnpm dev            # http://localhost:3000

# Poll once (scraper)
pnpm --filter @homefinder/scraper poll --portal=casasapo
pnpm --filter @homefinder/scraper poll --portal=casasapo --pages=5 --no-notify   # one-time benchmark backfill (slow: ~30-45 s between requests)

# Tests and types
pnpm test && pnpm typecheck
```

`poll` flags: `--portal=<name>`, `--pages=<1-9>` (result pages per area; backfills crawl slowly), `--no-notify`.

### Scheduling (Linux/WSL, systemd user timer)

Create `~/.config/systemd/user/homefinder-poll.service` (oneshot, `WorkingDirectory=<repo>/packages/scraper`, `ExecStart=<node-bin>/pnpm poll --portal=casasapo`) and `homefinder-poll.timer` (`OnCalendar=*-*-* 07..22:00,30:00`, `RandomizedDelaySec=240`), then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now homefinder-poll.timer
systemctl --user list-timers
```

On WSL the timer only fires while the WSL VM is awake; keep it running (e.g. a Windows scheduled task) or move the poller to an always-on machine.

## Web app

Password-gated (HMAC-signed httpOnly cookie, 30 days). Pages: **Deals** (filter by label and saved search, sort by newest or best discount), **Searches** (create/edit/pause/delete; location picker with accent-insensitive suggestions over all 308 municipalities and the districts, several places per search), **Listing** (price history, benchmark explanation, links to every portal), **Market** (median €/m² per area and typology), **Settings** (Telegram/email status, last scrape per portal).

The app connects to Postgres directly from the server with the connection string, so no database key is exposed to the browser, and the tables have row-level security enabled with no public policies.

## Security notes

- `.env` is git-ignored. Scan before publishing anything: this repository is public.
- Raw portal pages used as parser fixtures contain third-party data and are **not** committed (`packages/scraper/fixtures/`). Parser tests skip themselves when they are absent; capture pages locally with `curl` to run them.
- GitHub Actions logs are public if the repository is public; the scraper logs only counts and error messages.

## Status and roadmap

Done: core logic, Casa Sapo adapter, pipeline, Telegram + email notifiers, web UI, location picker, local scheduling.

Next: benchmark backfill and a first real timer run, WSL keep-alive, Imovirtual/Supercasa alert-email parsing, Idealista API adapter (if access is granted), deployment of the web UI (e.g. Vercel free tier), an `.env.example`.

Not built (by design, for now): SMS, multi-user accounts, rentals.
