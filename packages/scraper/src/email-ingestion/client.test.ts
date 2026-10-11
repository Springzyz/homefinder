import { describe, expect, it, vi } from "vitest";
import { QueueClient } from "./client";
import {
  loadQueueConfig, parseQueueMessages, QueueAuthError, QueueConfigError, QueueProtocolError, QueueRateLimitedError, QueueUnavailableError,
} from "./types";

const TOKEN = "t".repeat(40);
const cfg = { baseUrl: "https://q.example.workers.dev", token: TOKEN };
const ID = "123e4567-e89b-42d3-a456-426614174000";
const msg = (o: object = {}) => ({ id: ID, receivedAt: "2026-10-10T10:00:00Z", sender: null, recipient: null, subject: "s", portalHint: null, text: null, html: "<p/>", attempts: 0, ...o });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const client = (f: typeof fetch, retries = 1) => new QueueClient(cfg, f, { retries, backoffMs: 1 });

describe("config", () => {
  const ok = { CLOUDFLARE_EMAIL_QUEUE_URL: "https://q.example.workers.dev/", CLOUDFLARE_EMAIL_QUEUE_TOKEN: TOKEN };
  it("accepts valid config and normalises the URL", () => expect(loadQueueConfig(ok).baseUrl).toBe("https://q.example.workers.dev"));
  it.each([
    [{}, /QUEUE_URL is not set/],
    [{ CLOUDFLARE_EMAIL_QUEUE_URL: ok.CLOUDFLARE_EMAIL_QUEUE_URL }, /QUEUE_TOKEN is not set/],
    [{ ...ok, CLOUDFLARE_EMAIL_QUEUE_URL: "http://q.example.com" }, /https/],
    [{ ...ok, CLOUDFLARE_EMAIL_QUEUE_URL: "https://q.example.com/?t=1" }, /query/],
    [{ ...ok, CLOUDFLARE_EMAIL_QUEUE_TOKEN: "short" }, /too short/],
  ])("rejects bad config before any network call %#", (env, re) => expect(() => loadQueueConfig(env)).toThrow(re));
  it("allows http only for localhost", () => expect(loadQueueConfig({ ...ok, CLOUDFLARE_EMAIL_QUEUE_URL: "http://localhost:8787" }).baseUrl).toBe("http://localhost:8787"));
  it("a config error is its own class", () => expect(() => loadQueueConfig({})).toThrow(QueueConfigError));
});

describe("QueueClient", () => {
  it("sends the bearer token in a header, never in the URL, and parses messages", async () => {
    const f = vi.fn(async () => json({ messages: [msg()] }));
    const out = await client(f as any).pending(5);
    expect(out).toHaveLength(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://q.example.workers.dev/api/v1/messages?limit=5");
    expect(url).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  });
  it("clamps the limit to the allowed batch size", async () => {
    const f = vi.fn(async () => json({ messages: [] }));
    await client(f as any).pending(999);
    expect((f.mock.calls[0] as unknown as [string])[0]).toContain("limit=20");
  });
  it("401/403 -> auth error, no retry", async () => {
    const f = vi.fn(async () => new Response("no", { status: 401 }));
    await expect(client(f as any).pending()).rejects.toThrow(QueueAuthError);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("429 -> rate limited with Retry-After, no retry", async () => {
    const f = vi.fn(async () => new Response("slow", { status: 429, headers: { "retry-after": "30" } }));
    await expect(client(f as any).pending()).rejects.toMatchObject({ retryAfterSeconds: 30 });
    await expect(client(f as any).pending()).rejects.toThrow(QueueRateLimitedError);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("5xx and network errors are retried a bounded number of times, then reported as unavailable", async () => {
    const f = vi.fn(async () => new Response("x", { status: 503 }));
    await expect(client(f as any, 2).pending()).rejects.toThrow(QueueUnavailableError);
    expect(f).toHaveBeenCalledTimes(3);
    const g = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await expect(client(g as any, 0).pending()).rejects.toThrow(QueueUnavailableError);
    expect(g).toHaveBeenCalledTimes(1);
  });
  it("a transient failure followed by success works", async () => {
    let n = 0;
    const f = vi.fn(async () => (n++ === 0 ? new Response("x", { status: 502 }) : json({ messages: [] })));
    await expect(client(f as any).pending()).resolves.toEqual([]);
  });
  it("rejects oversized and malformed responses", async () => {
    await expect(client((async () => json({ messages: Array.from({ length: 21 }, () => msg()) })) as any).pending()).rejects.toThrow(QueueProtocolError);
    await expect(client((async () => new Response("not json")) as any).pending()).rejects.toThrow(QueueProtocolError);
    const huge = new Response("x".repeat(10), { headers: { "content-length": String(9 * 1024 * 1024) } });
    await expect(client((async () => huge) as any).pending()).rejects.toThrow(/too large/);
  });
  it("validates ack ids before sending", async () => {
    const f = vi.fn(async () => json({ ok: true }));
    await expect(client(f as any).ack(["../etc/passwd"])).rejects.toThrow(QueueProtocolError);
    await client(f as any).ack([ID]);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ ids: [ID] });
  });
  it("errors never contain the token or bodies", async () => {
    const f = vi.fn(async () => new Response(`secret body ${TOKEN}`, { status: 401 }));
    const e = await client(f as any).pending().catch((x) => x);
    expect(String(e.message)).not.toContain(TOKEN);
    expect(String(e.message)).not.toContain("secret body");
  });
});

describe("parseQueueMessages", () => {
  it.each([
    [{ messages: [msg({ id: "nope" })] }],
    [{ messages: [msg({ portalHint: "idealista" })] }],
    [{ messages: [msg({ receivedAt: "yesterday" })] }],
    [{ messages: [msg({ html: "x".repeat(300_001) })] }],
    [{ messages: "x" }],
    [{}],
  ])("rejects invalid payload %#", (body) => expect(() => parseQueueMessages(body)).toThrow(QueueProtocolError));
});
