import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { QueueAuthError, QueueUnavailableError, type FailItem, type QueueMessage } from "./types";
import { ingestEmails, type IngestDeps } from "./ingest";

const fx = (n: string) => readFileSync(new URL(`../../fixtures/email/${n}`, import.meta.url), "utf8");
const id = (n: number) => `123e4567-e89b-42d3-a456-4266141740${String(n).padStart(2, "0")}`;
const m = (n: number, html: string | null, subject = "Novos imóveis"): QueueMessage => ({
  id: id(n), receivedAt: "2026-10-10T10:00:00Z", sender: null, recipient: null, subject, portalHint: null, text: null, html, attempts: 0,
});

function harness(messages: QueueMessage[], over: Partial<IngestDeps> = {}) {
  const acked: string[] = [];
  const failed: FailItem[] = [];
  const process = vi.fn(async () => undefined);
  const recordRun = vi.fn(async () => undefined);
  const deps: IngestDeps = {
    client: { pending: async () => messages, ack: async (ids) => void acked.push(...ids), fail: async (items) => void failed.push(...items) },
    process, recordRun, ...over,
  };
  return { deps, acked, failed, process, recordRun };
}
const opts = { limit: 10, notify: false, dryRun: false };

describe("ingestEmails", () => {
  it("acknowledges only after the pipeline succeeded", async () => {
    const order: string[] = [];
    const h = harness([m(1, fx("imovirtual-two-listings.html"))], {
      process: vi.fn(async () => void order.push("process")),
      client: { pending: async () => [m(1, fx("imovirtual-two-listings.html"))], ack: async () => void order.push("ack"), fail: async () => void order.push("fail") },
    });
    const s = await ingestEmails(h.deps, opts);
    expect(order).toEqual(["process", "ack"]);
    expect(s).toMatchObject({ fetched: 1, processed: 1, listings: 2, quarantined: 0, retried: 0 });
  });

  it("a pipeline failure leaves the message for retry and does not acknowledge it", async () => {
    const h = harness([m(1, fx("supercasa-one-listing.html"))], { process: vi.fn(async () => { throw new Error("db down"); }) });
    const s = await ingestEmails(h.deps, opts);
    expect(h.acked).toEqual([]);
    expect(h.failed).toEqual([{ id: id(1), outcome: "retry", code: "pipeline_error" }]);
    expect(s).toMatchObject({ retried: 1, processed: 0, codes: { pipeline_error: 1 } });
  });

  it("a poison message does not block later ones", async () => {
    const h = harness([m(1, null), m(2, fx("supercasa-one-listing.html"))]);
    const s = await ingestEmails(h.deps, opts);
    expect(h.failed).toEqual([{ id: id(1), outcome: "quarantine", code: "no_html_body" }]);
    expect(h.acked).toEqual([id(2)]);
    expect(s).toMatchObject({ quarantined: 1, processed: 1 });
  });

  it("valid candidates are processed even when others in the same email are rejected", async () => {
    const html = `<div><a href="https://www.imovirtual.com/pt/anuncio/a-ID1">a</a><p>250.000 € · 85 m² · Lisboa</p></div><div><a href="https://www.imovirtual.com/pt/anuncio/b-ID2">b</a><p>250.000 € · Lisboa</p></div>`;
    const h = harness([m(1, html)]);
    const s = await ingestEmails(h.deps, opts);
    expect((h.process.mock.calls[0] as unknown as [string, unknown[]])[1]).toHaveLength(1);
    expect(h.acked).toEqual([id(1)]);
    expect(s.rejectedCandidates).toEqual({ missing_area: 1 });
  });

  it("an email whose candidates are all invalid is quarantined, not silently acknowledged", async () => {
    const html = `<div><a href="https://www.imovirtual.com/pt/anuncio/b-ID2">b</a><p>250.000 € · Lisboa</p></div>`;
    const h = harness([m(1, html)]);
    await ingestEmails(h.deps, opts);
    expect(h.acked).toEqual([]);
    expect(h.failed).toEqual([{ id: id(1), outcome: "quarantine", code: "no_valid_candidates" }]);
    expect(h.process).not.toHaveBeenCalled();
  });

  it("a deliberate non-listing mail is acknowledged without touching the pipeline", async () => {
    const html = `<a href="https://www.imovirtual.com/pt/anuncio/x-ID1">Confirmar</a>`;
    const h = harness([m(1, html, "Confirme o seu alerta")]);
    const s = await ingestEmails(h.deps, opts);
    expect(h.acked).toEqual([id(1)]);
    expect(h.process).not.toHaveBeenCalled();
    expect(s.ignored).toBe(1);
  });

  it("dry run parses only: no pipeline, no database, no acknowledgement", async () => {
    const h = harness([m(1, fx("imovirtual-two-listings.html")), m(2, null)]);
    const s = await ingestEmails(h.deps, { ...opts, dryRun: true });
    expect(h.process).not.toHaveBeenCalled();
    expect(h.recordRun).not.toHaveBeenCalled();
    expect(h.acked).toEqual([]);
    expect(h.failed).toEqual([]);
    expect(s).toMatchObject({ fetched: 2, listings: 2 });
  });

  it("if the queue vanishes while acknowledging, it stops and the rest stay pending (redelivery is safe)", async () => {
    const h = harness([m(1, fx("supercasa-one-listing.html")), m(2, fx("supercasa-one-listing.html"))], {
      client: { pending: async () => [m(1, fx("supercasa-one-listing.html")), m(2, fx("supercasa-one-listing.html"))], ack: async () => { throw new QueueUnavailableError("down"); }, fail: async () => undefined },
    });
    const s = await ingestEmails(h.deps, opts);
    expect(h.process).toHaveBeenCalledTimes(1);
    expect(s).toMatchObject({ unacked: 1, processed: 0 });
    expect(s.stoppedEarly).toMatch(/unavailable/);
  });

  it("auth failures abort the run instead of being treated as a message problem", async () => {
    const h = harness([m(1, fx("supercasa-one-listing.html"))], {
      client: { pending: async () => [m(1, fx("supercasa-one-listing.html"))], ack: async () => { throw new QueueAuthError("bad"); }, fail: async () => undefined },
    });
    await expect(ingestEmails(h.deps, opts)).rejects.toThrow(QueueAuthError);
  });

  it("an empty queue is a normal outcome", async () => {
    const s = await ingestEmails(harness([]).deps, opts);
    expect(s.fetched).toBe(0);
  });
});
