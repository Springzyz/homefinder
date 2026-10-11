import { describe, expect, it } from "vitest";
import { cleanup, insertMessage, acknowledge, listPending, type Retention } from "../src/queue";
import { makeEnv } from "./helpers";

const DAY = 86400;
const NOW = 1_800_000_000;
const R: Retention = { payloadDays: 3, quarantineDays: 30, metadataDays: 60, pendingMaxAgeDays: 14 };
const put = (env: ReturnType<typeof makeEnv>["env"], k: string, receivedDaysAgo: number) =>
  insertMessage(env.DB, { sender: "s@x", recipient: "r@x", subject: "subj", text: "text", html: "<p>html</p>", portalHint: null, idempotencyKey: k }, NOW - receivedDaysAgo * DAY);
const row = (raw: ReturnType<typeof makeEnv>["raw"], id: string) => raw.prepare("SELECT * FROM email_messages WHERE id=?").get(id) as Record<string, unknown> | undefined;

describe("retention", () => {
  it("scrubs processed payloads after payloadDays but keeps the row for deduplication", async () => {
    const { env, raw } = makeEnv();
    const old = await put(env, "old", 10);
    const fresh = await put(env, "fresh", 1);
    await acknowledge(env.DB, [old.id], NOW - 5 * DAY);
    await acknowledge(env.DB, [fresh.id], NOW - 1 * DAY);
    const r = await cleanup(env.DB, R, NOW);
    expect(r.scrubbed).toBe(1);
    expect(row(raw, old.id)).toMatchObject({ text_body: null, html_body: null, sender: null, subject: null, status: "processed" });
    expect(row(raw, old.id)!.payload_scrubbed_at).toBe(NOW);
    expect(row(raw, fresh.id)).toMatchObject({ text_body: "text", html_body: "<p>html</p>" });
    // the scrubbed row still blocks a re-delivery of the same email
    expect((await put(env, "old", 0)).duplicate).toBe(true);
  });

  it("never deletes or scrubs recent pending messages", async () => {
    const { env, raw } = makeEnv();
    const p = await put(env, "p", 1);
    await cleanup(env.DB, R, NOW);
    expect(row(raw, p.id)).toMatchObject({ status: "pending", text_body: "text" });
    expect(await listPending(env.DB, 10)).toHaveLength(1);
  });

  it("quarantines unprocessed messages older than pendingMaxAgeDays so the queue stays bounded", async () => {
    const { env, raw } = makeEnv();
    const stale = await put(env, "stale", 20);
    const ok = await put(env, "ok", 13);
    expect((await cleanup(env.DB, R, NOW)).expired).toBe(1);
    expect(row(raw, stale.id)).toMatchObject({ status: "quarantined", error_code: "expired" });
    expect(row(raw, ok.id)!.status).toBe("pending");
    expect((await listPending(env.DB, 10)).map((m) => m.id)).toEqual([ok.id]);
  });

  it("keeps quarantined payloads longer, then deletes whole rows after metadataDays", async () => {
    const { env, raw } = makeEnv();
    const q = await put(env, "q", 20);
    await env.DB.prepare("UPDATE email_messages SET status='quarantined', error_code='x', updated_at=?1 WHERE id=?2").bind(NOW - 20 * DAY, q.id).run();
    await cleanup(env.DB, R, NOW);
    expect(row(raw, q.id)!.text_body).toBe("text"); // 20 days < 30: still inspectable
    await cleanup(env.DB, R, NOW + 15 * DAY);
    expect(row(raw, q.id)!.text_body).toBeNull(); // scrubbed after 35 days
    const d = await cleanup(env.DB, R, NOW + 50 * DAY);
    expect(d.deleted).toBe(1);
    expect(row(raw, q.id)).toBeUndefined();
    expect((await put(env, "q", 0)).duplicate).toBe(false); // key forgotten only after the metadata window
  });
});
