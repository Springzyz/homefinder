import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** In-memory stand-in for exactly the SQL the pipeline issues, so the REAL pipeline code runs in these tests. */
const h = vi.hoisted(() => {
  const state = {
    listings: [] as any[], history: [] as any[], runs: [] as any[], scores: new Map<number, any>(),
    notifications: new Set<string>(), searches: [] as any[], settings: { telegram_chat_id: "1", notify_email: null as string | null },
  };
  const rows = (r: any[]) => ({ rows: r, rowCount: r.length });
  async function query(sqlRaw: string, p: any[] = []): Promise<any> {
    const sql = sqlRaw.replace(/\s+/g, " ").trim().toLowerCase();
    if (/^(begin|commit|rollback)/.test(sql) || sql.startsWith("delete from market_stats") || sql.startsWith("insert into market_stats")) return rows([]);
    if (sql.startsWith("select 1 from scrape_runs")) return rows(state.runs.filter((r) => r.portal === p[0] && r.ok).slice(0, 1).map(() => ({})));
    if (sql.startsWith("insert into scrape_runs")) { state.runs.push({ portal: p[0], ok: p[1], found: p[2] }); return rows([]); }
    if (sql.startsWith("select * from searches")) return rows(state.searches);
    if (sql.startsWith("select id, price from listings")) return rows(state.listings.filter((l) => l.portal === p[0] && l.portal_id === p[1]).map((l) => ({ id: l.id, price: l.price })));
    if (sql.startsWith("insert into listings")) {
      const l = { id: state.listings.length + 1, portal: p[0], portal_id: p[1], url: p[2], title: p[3], price: p[4], area_m2: p[5], typology: p[6], condition: p[7], distrito: p[8], concelho: p[9], freguesia: p[10], image_url: p[11], dedupe_key: p[12], active: true };
      if (state.listings.some((x) => x.portal === l.portal && x.portal_id === l.portal_id)) throw new Error("unique violation");
      state.listings.push(l);
      return rows([{ id: l.id }]);
    }
    if (sql.startsWith("insert into price_history")) { state.history.push({ id: p[0], price: p[1] }); return rows([]); }
    if (sql.startsWith("update listings set last_seen_at")) { const l = state.listings.find((x) => x.id === p[0])!; l.price = p[1]; return rows([]); }
    if (sql.startsWith("select * from listings where active")) return rows(state.listings);
    if (sql.startsWith("insert into listing_scores")) { state.scores.set(p[0], { label: p[4] }); return rows([]); }
    if (sql.startsWith("select * from settings")) return rows([state.settings]);
    if (sql.startsWith("select id, url from listings where dedupe_key")) {
      const k = state.listings.find((l) => l.id === p[0])!.dedupe_key;
      return rows(state.listings.filter((l) => l.dedupe_key === k).map((l) => ({ id: l.id, url: l.url })));
    }
    if (sql.startsWith("select 1 from notifications")) return rows([...state.notifications].filter((k) => { const [s, , c] = k.split("|"); return Number(s) === p[0] && c === p[1]; }).filter((k) => p[2].includes(Number(k.split("|")[1]))).map(() => ({})));
    if (sql.startsWith("insert into notifications")) {
      const k = `${p[0]}|${p[1]}|${p[2]}`;
      if (state.notifications.has(k)) return rows([]);
      state.notifications.add(k);
      return rows([{}]);
    }
    if (sql.startsWith("delete from notifications")) { state.notifications.delete(`${p[0]}|${p[1]}|${p[2]}`); return rows([]); }
    throw new Error("fake db: unhandled SQL: " + sql.slice(0, 80));
  }
  const pool = { query, connect: async () => ({ query, release() {} }) };
  return { state, pool, sendTelegram: vi.fn(async () => undefined), sendEmail: vi.fn(async () => undefined) };
});

vi.mock("../db", () => ({ db: () => h.pool, closeDb: async () => undefined }));
vi.mock("../notify", () => ({ sendTelegram: h.sendTelegram, sendEmail: h.sendEmail }));

import { ingestEmails } from "./ingest";
import { processListings, recordRun } from "../pipeline";
import type { QueueMessage } from "./types";

const fx = (n: string) => readFileSync(new URL(`../../fixtures/email/${n}`, import.meta.url), "utf8");
const msg = (n: number, html: string): QueueMessage => ({ id: `123e4567-e89b-42d3-a456-4266141740${String(n).padStart(2, "0")}`, receivedAt: "2026-10-10T10:00:00Z", sender: null, recipient: null, subject: "Novos imóveis", portalHint: null, text: null, html, attempts: 0 });
const run = (messages: QueueMessage[], extra: { seed?: boolean } = {}) =>
  ingestEmails(
    { client: { pending: async () => messages, ack: async () => undefined, fail: async () => undefined }, process: processListings, recordRun: (p, ok, n) => recordRun(p, ok, n) },
    { limit: 10, notify: true, dryRun: false, ...extra },
  );

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  h.sendTelegram.mockClear();
  Object.assign(h.state, { listings: [], history: [], runs: [], scores: new Map(), notifications: new Set(), settings: { telegram_chat_id: "1", notify_email: null } });
  h.state.searches = [{ id: 1, name: "Lisboa", filters: { locations: [{ distrito: "Lisboa", concelho: "Lisboa" }] }, min_label: "good", channels: ["telegram"] }];
});

describe("email ingestion through the real pipeline", () => {
  it("re-processing the same email creates no duplicate rows and no duplicate alerts", async () => {
    const email = msg(1, fx("imovirtual-two-listings.html"));
    await run([email], { seed: false });
    expect(h.state.listings).toHaveLength(2);
    expect(h.sendTelegram).toHaveBeenCalledTimes(1); // only the Lisboa listing matches the saved search

    await run([email], { seed: false }); // redelivery, e.g. crash before the acknowledgement
    await run([email, email], { seed: false });
    expect(h.state.listings).toHaveLength(2);
    expect(h.state.history).toHaveLength(2);
    expect(h.state.notifications.size).toBe(1);
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
  });

  it("the first batch for a portal is seeded silently (existing semantics), later ones alert", async () => {
    await run([msg(1, fx("imovirtual-two-listings.html"))]); // no seed override: first successful run for the portal
    expect(h.state.listings).toHaveLength(2);
    expect(h.sendTelegram).not.toHaveBeenCalled();

    const second = fx("imovirtual-two-listings.html").replaceAll("ID4abc1", "ID4abc9").replace("250 000", "240 000");
    await run([msg(2, second)]);
    expect(h.state.listings).toHaveLength(3);
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
  });

  it("rejected candidates never reach the database or the benchmark input", async () => {
    const html = `<div><a href="https://www.imovirtual.com/pt/anuncio/a-ID1">a</a><p>250.000 € · 85 m² · Lisboa</p></div>
                  <div><a href="https://www.imovirtual.com/pt/anuncio/b-ID2">b</a><p>199.000 € · Lisboa</p></div>`;
    await run([msg(1, html)], { seed: false });
    expect(h.state.listings.map((l) => l.portal_id)).toEqual(["1"]); // "b" has no area: rejected, not stored
    expect(h.state.listings.every((l) => l.area_m2 > 0 && l.price > 0)).toBe(true);
  });

  it("a price drop on an already stored listing is recorded, not duplicated", async () => {
    await run([msg(1, fx("supercasa-one-listing.html"))], { seed: false });
    await run([msg(2, fx("supercasa-one-listing.html").replace("129.500", "119.500"))], { seed: false });
    expect(h.state.listings).toHaveLength(1);
    expect(h.state.history.map((x) => x.price)).toEqual([129500, 119500]);
  });
});
