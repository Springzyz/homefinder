import {
  atLeast, computeMarketStats, dedupeKey, matchesSearch, scoreListing,
  type Label, type Listing, type Score, type SearchFilters, type Typology,
} from "@homefinder/core";
import { casasapo } from "./adapters/casasapo";
import { olx } from "./adapters/olx";
import type { PortalAdapter } from "./adapters/types";
import { db } from "./db";
import { BlockedError, politeGet, sleep } from "./fetch";
import { sendEmail, sendTelegram, type Alert } from "./notify";

export const ADAPTERS: PortalAdapter[] = [olx, casasapo];
const MAX_ALERTS_PER_RUN = 25;
const REQUEST_GAP_MS = 4000;

interface SearchRow { id: number; name: string; filters: SearchFilters; min_label: Label; channels: string[] }
interface Event { id: number; listing: Listing; priceDrop?: number }

const toListing = (r: any): Listing => ({
  portal: r.portal, portalId: r.portal_id, url: r.url, title: r.title, price: Number(r.price), areaM2: Number(r.area_m2),
  typology: r.typology as Typology | null, condition: r.condition, distrito: r.distrito, concelho: r.concelho,
  freguesia: r.freguesia, imageUrl: r.image_url,
});

export async function run(opts: { notify: boolean; pages: number; portal?: string } = { notify: true, pages: 1 }) {
  const pool = db();
  const { rows: searches } = await pool.query<SearchRow>("select * from searches where active");
  if (!searches.length) return console.log("No active searches; nothing to poll.");

  const locs = new Map<string, { distrito?: string; concelho?: string }>();
  for (const s of searches) for (const l of s.filters.locations) {
    const loc = { distrito: l.distrito, concelho: l.concelho };
    if (loc.concelho || loc.distrito) locs.set(`${loc.distrito}|${loc.concelho}`, loc);
  }

  const events: Event[] = [];
  const seeding = new Set<string>();

  for (const adapter of ADAPTERS.filter((a) => !opts.portal || a.portal === opts.portal)) {
    const { rows: prior } = await pool.query("select 1 from scrape_runs where portal=$1 and ok limit 1", [adapter.portal]);
    if (!prior.length) seeding.add(adapter.portal);
    let found = 0;
    let error: string | undefined;
    try {
      for (const loc of locs.values()) for (let page = 1; page <= opts.pages; page++) for (const url of adapter.searchUrls(loc, page)) {
        const listings = adapter.parse(await politeGet(url));
        found += listings.length;
        for (const l of listings) {
          const ev = await upsert(l);
          if (ev) events.push(ev);
        }
        await sleep(REQUEST_GAP_MS);
      }
    } catch (e) {
      error = e instanceof BlockedError ? `blocked: ${e.message}` : String(e);
      console.error(`[${adapter.portal}] ${error}`);
    }
    await pool.query("insert into scrape_runs(portal, ok, listings_found, error) values ($1,$2,$3,$4)", [adapter.portal, !error, found, error ?? null]);
    console.log(`[${adapter.portal}] found=${found} ${error ? "FAILED" : "ok"}`);
  }

  const stats = await refreshStats();
  const scored = new Map<number, Score>();
  for (const ev of events) {
    const score = scoreListing(ev.listing, stats);
    scored.set(ev.id, score);
    await pool.query(
      `insert into listing_scores(listing_id, benchmark_level, benchmark_ppsqm, discount_pct, label, low_confidence)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (listing_id) do update set benchmark_level=$2, benchmark_ppsqm=$3, discount_pct=$4, label=$5, low_confidence=$6, computed_at=now()`,
      [ev.id, score.benchmarkLevel, score.benchmarkPpsqm, score.discountPct, score.label, score.lowConfidence],
    );
  }
  console.log(`events=${events.length} stats=${stats.length}`);
  if (opts.notify) await dispatch(searches, events.filter((e) => !seeding.has(e.listing.portal)), scored);
}

/** Insert or refresh a listing. Returns an event when it is new or its price dropped. */
async function upsert(l: Listing): Promise<Event | undefined> {
  const pool = db();
  const { rows } = await pool.query("select id, price from listings where portal=$1 and portal_id=$2", [l.portal, l.portalId]);
  const existing = rows[0];
  if (!existing) {
    const ins = await pool.query(
      `insert into listings(portal, portal_id, url, title, price, area_m2, typology, condition, distrito, concelho, freguesia, image_url, dedupe_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [l.portal, l.portalId, l.url, l.title, l.price, l.areaM2, l.typology, l.condition, l.distrito, l.concelho, l.freguesia, l.imageUrl ?? null, dedupeKey(l)],
    );
    const id = ins.rows[0].id as number;
    await pool.query("insert into price_history(listing_id, price) values ($1,$2)", [id, l.price]);
    return { id, listing: l };
  }
  await pool.query("update listings set last_seen_at=now(), active=true, price=$2 where id=$1", [existing.id, l.price]);
  const old = Number(existing.price);
  if (old !== l.price) {
    await pool.query("insert into price_history(listing_id, price) values ($1,$2)", [existing.id, l.price]);
    if (l.price < old) return { id: existing.id, listing: l, priceDrop: old };
  }
}

export async function refreshStats() {
  const pool = db();
  const { rows } = await pool.query("select * from listings where active and last_seen_at > now() - interval '90 days'");
  const stats = computeMarketStats(rows.map(toListing));
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("delete from market_stats");
    for (const s of stats)
      await c.query("insert into market_stats(level,key,typology,condition,median_ppsqm,n) values ($1,$2,$3,$4,$5,$6)", [s.level, s.key, s.typology, s.condition, s.medianPpsqm, s.n]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
  return stats;
}

async function dispatch(searches: SearchRow[], events: Event[], scored: Map<number, Score>) {
  const pool = db();
  const { rows: [settings] } = await pool.query("select * from settings where id=1");
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? "HomeFinder <onboarding@resend.dev>";
  let sent = 0;

  for (const ev of events) {
    const score = scored.get(ev.id)!;
    const { rows: twins } = await pool.query("select id, url from listings where dedupe_key=(select dedupe_key from listings where id=$1)", [ev.id]);
    const twinIds = twins.map((t) => t.id as number);
    for (const s of searches) {
      if (!matchesSearch(ev.listing, s.filters)) continue;
      if (score.label && !atLeast(score.label, s.min_label)) continue;
      for (const channel of s.channels) {
        if (sent >= MAX_ALERTS_PER_RUN) return console.log(`alert cap (${MAX_ALERTS_PER_RUN}) reached`);
        // Same property already alerted for this search/channel via another portal?
        const dup = await pool.query("select 1 from notifications where search_id=$1 and channel=$2 and listing_id = any($3)", [s.id, channel, twinIds]);
        if (dup.rowCount) continue;
        const ins = await pool.query("insert into notifications(search_id, listing_id, channel) values ($1,$2,$3) on conflict do nothing returning 1", [s.id, ev.id, channel]);
        if (!ins.rowCount) continue;
        const alert: Alert = { listing: ev.listing, score, searchName: s.name, urls: twins.map((t) => t.url as string), priceDrop: ev.priceDrop };
        try {
          if (channel === "telegram" && tgToken && settings.telegram_chat_id) await sendTelegram(tgToken, settings.telegram_chat_id, alert);
          else if (channel === "email" && resendKey && settings.notify_email) await sendEmail(resendKey, from, settings.notify_email, alert);
          else {
            console.warn(`channel ${channel} not configured; skipped`);
            await pool.query("delete from notifications where search_id=$1 and listing_id=$2 and channel=$3", [s.id, ev.id, channel]);
            continue;
          }
          sent++;
        } catch (e) {
          console.error(`send ${channel} failed:`, e);
          await pool.query("delete from notifications where search_id=$1 and listing_id=$2 and channel=$3", [s.id, ev.id, channel]);
        }
      }
    }
  }
  console.log(`alerts sent: ${sent}`);
}
