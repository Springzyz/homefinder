import { describe, expect, it } from "vitest";
import { handleApi } from "../src/api";
import { insertMessage } from "../src/queue";
import { authed, makeEnv, post, TOKEN } from "./helpers";

const ID = (n: number) => `123e4567-e89b-42d3-a456-4266141740${String(n).padStart(2, "0")}`;
async function seed(env: ReturnType<typeof makeEnv>["env"], n: number, base = 1_700_000_000) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await insertMessage(env.DB, { sender: "s@x", recipient: "r@x", subject: `subject-${i}`, text: `body-${i}`, html: `<p>${i}</p>`, portalHint: null, idempotencyKey: `k${i}` }, base + i)).id);
  return ids;
}
const get = (env: ReturnType<typeof makeEnv>["env"], path: string, init?: RequestInit) => handleApi(authed(path, init), env);

describe("authentication and routing", () => {
  it("/health is open and reveals nothing", async () => {
    const { env } = makeEnv();
    const r = await handleApi(new Request("https://w.example/health"), env);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });
  it.each([
    ["no header", {}],
    ["wrong token", { authorization: "Bearer " + "x".repeat(48) }],
    ["wrong scheme", { authorization: `Basic ${TOKEN}` }],
    ["empty bearer", { authorization: "Bearer " }],
  ])("rejects %s with 401 and a code only", async (_n, headers) => {
    const { env } = makeEnv();
    await seed(env, 1);
    const r = await handleApi(new Request("https://w.example/api/v1/messages", { headers }), env);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "unauthorized" });
  });
  it("never accepts the token in the URL", async () => {
    const { env } = makeEnv();
    expect((await handleApi(new Request(`https://w.example/api/v1/messages?token=${TOKEN}`), env)).status).toBe(401);
  });
  it("refuses to serve when no strong token is configured", async () => {
    const { env } = makeEnv({ HOMEFINDER_QUEUE_TOKEN: "short" });
    expect((await handleApi(new Request("https://w.example/api/v1/messages", { headers: { authorization: "Bearer short" } }), env)).status).toBe(503);
  });
  it("405 for wrong methods, 404 for unknown routes (after auth)", async () => {
    const { env } = makeEnv();
    expect((await get(env, "/api/v1/messages", { method: "DELETE" })).status).toBe(405);
    expect((await get(env, "/api/v1/messages/ack")).status).toBe(405);
    expect((await get(env, "/api/v1/nope")).status).toBe(404);
    expect((await handleApi(new Request("https://w.example/api/v1/nope"), env)).status).toBe(401);
  });
});

describe("GET /api/v1/messages", () => {
  it("returns pending messages oldest first, in bounded batches", async () => {
    const { env } = makeEnv();
    await seed(env, 25);
    const r = await get(env, "/api/v1/messages?limit=20");
    const { messages } = (await r.json()) as { messages: { subject: string }[] };
    expect(messages).toHaveLength(20);
    expect(messages.map((m) => m.subject)).toEqual(Array.from({ length: 20 }, (_, i) => `subject-${i}`));
    expect(((await (await get(env, "/api/v1/messages")).json()) as { messages: unknown[] }).messages).toHaveLength(10);
  });
  it.each(["0", "21", "-1", "abc", "1.5"])("rejects limit=%s", async (l) => {
    const { env } = makeEnv();
    expect((await get(env, `/api/v1/messages?limit=${l}`)).status).toBe(400);
  });
  it("is read-only: a message stays available until it is acknowledged (consumer failure is safe)", async () => {
    const { env } = makeEnv();
    await seed(env, 2);
    const first = (await (await get(env, "/api/v1/messages")).json()) as { messages: { id: string }[] };
    const again = (await (await get(env, "/api/v1/messages")).json()) as { messages: { id: string }[] };
    expect(again.messages.map((m) => m.id)).toEqual(first.messages.map((m) => m.id));
  });
});

describe("POST /api/v1/messages/ack", () => {
  it("acknowledges, and acknowledging again is idempotent", async () => {
    const { env } = makeEnv();
    const [a, b] = await seed(env, 2);
    const r1 = await (await handleApi(post("/api/v1/messages/ack", { ids: [a] }), env)).json();
    expect(r1).toMatchObject({ acknowledged: 1, alreadyProcessed: 0, unknown: [], notAckable: [] });
    const r2 = await (await handleApi(post("/api/v1/messages/ack", { ids: [a] }), env)).json();
    expect(r2).toMatchObject({ acknowledged: 0, alreadyProcessed: 1 });
    const rest = (await (await get(env, "/api/v1/messages")).json()) as { messages: { id: string }[] };
    expect(rest.messages.map((m) => m.id)).toEqual([b]);
  });
  it("reports unknown ids and refuses to ack quarantined ones, without touching them", async () => {
    const { env, raw } = makeEnv();
    const [a] = await seed(env, 1);
    await handleApi(post("/api/v1/messages/fail", { items: [{ id: a, outcome: "quarantine", code: "unsupported" }] }), env);
    const r = await (await handleApi(post("/api/v1/messages/ack", { ids: [a, ID(99)] }), env)).json();
    expect(r).toMatchObject({ acknowledged: 0, unknown: [ID(99)], notAckable: [a] });
    expect((raw.prepare("SELECT status FROM email_messages").get() as { status: string }).status).toBe("quarantined");
  });
  it.each([
    ["not json", "{nope", "application/json", 400],
    ["wrong content type", JSON.stringify({ ids: [ID(1)] }), "text/plain", 400],
    ["too many ids", JSON.stringify({ ids: Array.from({ length: 21 }, (_, i) => ID(i)) }), "application/json", 400],
    ["invalid id", JSON.stringify({ ids: ["' OR 1=1 --"] }), "application/json", 400],
    ["duplicate ids", JSON.stringify({ ids: [ID(1), ID(1)] }), "application/json", 400],
    ["empty", JSON.stringify({ ids: [] }), "application/json", 400],
    ["oversized body", JSON.stringify({ ids: [ID(1)], pad: "x".repeat(9000) }), "application/json", 413],
  ])("rejects %s", async (_n, body, type, status) => {
    const { env } = makeEnv();
    const r = await handleApi(authed("/api/v1/messages/ack", { method: "POST", headers: { "content-type": type }, body }), env);
    expect(r.status).toBe(status);
    const text = await r.text();
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("OR 1=1");
    expect(JSON.parse(text)).toHaveProperty("error");
  });
});

describe("POST /api/v1/messages/fail and poison messages", () => {
  it("retry keeps the message available; repeated failures quarantine it so it cannot loop forever", async () => {
    const { env, raw } = makeEnv();
    const [a, b] = await seed(env, 2);
    for (let i = 0; i < 4; i++) {
      await handleApi(post("/api/v1/messages/fail", { items: [{ id: a, outcome: "retry", code: "pipeline_error" }] }), env);
      expect((raw.prepare("SELECT status, attempts FROM email_messages WHERE id=?").get(a!) as { status: string }).status).toBe("retryable_error");
    }
    const listed = ((await (await get(env, "/api/v1/messages")).json()) as { messages: { id: string; attempts: number }[] }).messages;
    expect(listed.map((m) => m.id)).toEqual([a, b]); // still retryable, and not blocking b
    expect(listed[0]!.attempts).toBe(4);
    await handleApi(post("/api/v1/messages/fail", { items: [{ id: a, outcome: "retry", code: "pipeline_error" }] }), env);
    expect(raw.prepare("SELECT status, error_code FROM email_messages WHERE id=?").get(a!)).toMatchObject({ status: "quarantined", error_code: "max_attempts" });
    expect(((await (await get(env, "/api/v1/messages")).json()) as { messages: { id: string }[] }).messages.map((m) => m.id)).toEqual([b]);
  });
  it("validates items", async () => {
    const { env } = makeEnv();
    for (const items of [[], [{ id: ID(1), outcome: "maybe", code: "x" }], [{ id: ID(1), outcome: "retry", code: "Has Spaces!" }], "x"]) {
      expect((await handleApi(post("/api/v1/messages/fail", { items }), env)).status).toBe(400);
    }
  });
});

describe("GET /api/v1/stats", () => {
  it("shows queue size and age, distinguishing an empty queue from a broken one", async () => {
    const { env } = makeEnv();
    expect(await (await get(env, "/api/v1/stats")).json()).toMatchObject({ pending: 0, oldestPendingAgeSeconds: null });
    await seed(env, 3, Math.floor(Date.now() / 1000) - 600);
    const s = (await (await get(env, "/api/v1/stats")).json()) as { pending: number; oldestPendingAgeSeconds: number };
    expect(s.pending).toBe(3);
    expect(s.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(600);
  });
});

describe("errors never leak internals", () => {
  it("a database failure returns a bare code", async () => {
    const { env } = makeEnv();
    const broken = { ...env, DB: { prepare: () => { throw new Error("secret internal detail " + TOKEN); } } as unknown as D1Database };
    const r = await handleApi(authed("/api/v1/messages"), broken);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "internal_error" });
  });
});
