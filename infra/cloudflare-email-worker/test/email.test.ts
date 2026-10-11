import { afterEach, describe, expect, it, vi } from "vitest";
import { handleEmail } from "../src/index";
import { listPending } from "../src/queue";
import { fakeMessage, makeEnv, mime } from "./helpers";

const store = async (env: ReturnType<typeof makeEnv>["env"], raw: string, over = {}) => {
  const { msg, setReject } = fakeMessage(raw, over);
  await handleEmail(msg, env);
  return setReject;
};
const count = (raw: ReturnType<typeof makeEnv>["raw"]) => (raw.prepare("SELECT COUNT(*) n FROM email_messages").get() as { n: number }).n;

afterEach(() => vi.restoreAllMocks());

describe("inbound email", () => {
  it("stores a valid email once, with a portal hint from its link hosts", async () => {
    const { env, raw } = makeEnv();
    await store(env, mime({ html: `<a href="https://www.imovirtual.com/pt/anuncio/x-ID1">x</a> 250 000 €`, text: "plain" }));
    const [m] = await listPending(env.DB, 10);
    expect(count(raw)).toBe(1);
    expect(m).toMatchObject({ subject: "Novos imóveis", portalHint: "imovirtual", attempts: 0 });
    expect(m!.text?.trim()).toBe("plain");
    expect(m!.html).toContain("imovirtual.com");
  });

  it("does not guess a hint when links point to both portals or neither", async () => {
    const { env } = makeEnv();
    await store(env, mime({ html: `<a href="https://www.imovirtual.com/a">a</a><a href="https://supercasa.pt/b">b</a>` }));
    await store(env, mime({ html: `<p>no links</p>`, messageId: "<id-2@example.net>" }));
    expect((await listPending(env.DB, 10)).map((m) => m.portalHint)).toEqual([null, null]);
  });

  describe("idempotency", () => {
    it("the same Message-ID and content is stored once", async () => {
      const { env, raw } = makeEnv();
      for (let i = 0; i < 3; i++) await store(env, mime({ html: "<p>a</p>" }));
      expect(count(raw)).toBe(1);
    });
    it("without a Message-ID it falls back to a content hash", async () => {
      const { env, raw } = makeEnv();
      await store(env, mime({ html: "<p>a</p>", messageId: null }));
      await store(env, mime({ html: "<p>a</p>", messageId: null }));
      await store(env, mime({ html: "<p>b</p>", messageId: null }));
      expect(count(raw)).toBe(2);
    });
    it("a reused Message-ID with different content is NOT swallowed", async () => {
      const { env, raw } = makeEnv();
      await store(env, mime({ html: "<p>a</p>" }));
      await store(env, mime({ html: "<p>different</p>" }));
      expect(count(raw)).toBe(2);
    });
  });

  it("never keeps attachment bytes", async () => {
    const { env, raw } = makeEnv();
    await store(env, mime({ html: "<p>x</p>", attachment: true }));
    const row = raw.prepare("SELECT text_body, html_body FROM email_messages").get() as Record<string, string | null>;
    expect(JSON.stringify(row)).not.toMatch(/QVRUQUNI|ATTACHMENT-BYTES/);
  });

  it("garbage input does not throw and never blocks later mail", async () => {
    const { env, raw } = makeEnv();
    const setReject = await store(env, "\u0000\u0001 not mime at all ￿");
    await store(env, mime({ html: "<p>ok</p>" }));
    expect(setReject).not.toHaveBeenCalled();
    expect(count(raw)).toBeGreaterThanOrEqual(1);
    expect((await listPending(env.DB, 10)).some((m) => m.html?.includes("ok"))).toBe(true);
  });

  describe("limits", () => {
    it("rejects a declared-oversized message without storing it", async () => {
      const { env, raw } = makeEnv();
      const reject = await store(env, mime({ html: "x" }), { rawSize: 5 * 1024 * 1024 });
      expect(reject).toHaveBeenCalledWith("Message too large");
      expect(count(raw)).toBe(0);
    });
    it("rejects when the stream exceeds the limit even if the declared size lies", async () => {
      const { env, raw } = makeEnv();
      const reject = await store(env, "x".repeat(1024 * 1024 + 10), { rawSize: 10 });
      expect(reject).toHaveBeenCalledWith("Message too large");
      expect(count(raw)).toBe(0);
    });
    it("quarantines (without payload) a message whose body exceeds the body limit", async () => {
      const { env, raw } = makeEnv();
      await store(env, mime({ html: "y".repeat(310_000) }));
      const row = raw.prepare("SELECT status, error_code, html_body, text_body FROM email_messages").get() as Record<string, unknown>;
      expect(row).toMatchObject({ status: "quarantined", error_code: "body_too_large", html_body: null, text_body: null });
      expect(await listPending(env.DB, 10)).toEqual([]);
    });
  });

  describe("recipient and sender rules", () => {
    it("rejects other recipients", async () => {
      const { env, raw } = makeEnv();
      const reject = await store(env, mime({ html: "<p/>" }), { to: "someone-else@example.com" });
      expect(reject).toHaveBeenCalledWith("Unknown recipient");
      expect(count(raw)).toBe(0);
    });
    it("accepts the ingest address case-insensitively", async () => {
      const { env, raw } = makeEnv();
      await store(env, mime({ html: "<p/>" }), { to: "ALERTS@Example.com" });
      expect(count(raw)).toBe(1);
    });
    it("applies exact-sender and domain allow-lists, including subdomains but not look-alikes", async () => {
      const { env, raw } = makeEnv({ ALLOWED_SENDERS: "alerts@one.example", ALLOWED_SENDER_DOMAINS: "portal.example" });
      const ok = (from: string, id: string) => store(env, mime({ html: `<p>${id}</p>`, messageId: `<${id}@x>` }), { from });
      await ok("alerts@one.example", "a");
      await ok("noreply@portal.example", "b");
      await ok("noreply@mail.portal.example", "c");
      expect(count(raw)).toBe(3);
      for (const [i, bad] of ["other@one.example", "noreply@evilportal.example", "noreply@portal.example.evil.com", "x@y.z"].entries()) {
        const reject = await ok(bad, `bad${i}`);
        expect(reject).toHaveBeenCalledWith("Sender not allowed");
      }
      expect(count(raw)).toBe(3);
    });
  });

  it("normal logs never contain email content, addresses or links", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.join(" ")));
    const { env } = makeEnv({ ALLOWED_SENDER_DOMAINS: "portal.example" });
    await store(env, mime({ subject: "SECRET-SUBJECT", html: `<a href="https://www.imovirtual.com/pt/anuncio/SECRET-LINK">SECRET-BODY</a>`, from: "noreply@portal.example" }));
    await store(env, mime({ subject: "SECRET-SUBJECT2", from: "spy@attacker.example", html: "<p/>" }), { from: "spy@attacker.example" });
    await store(env, "garbage SECRET-RAW");
    const joined = logs.join("\n");
    expect(joined).not.toMatch(/SECRET|portal\.example|attacker|imovirtual|@/);
    expect(logs.length).toBeGreaterThan(0);
  });
});
