import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { vi } from "vitest";
import type { Env } from "../src/env";

// Vite strips the `node:` prefix and cannot resolve prefix-only builtins like node:sqlite, so load it via require.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type DatabaseSync = DatabaseSyncType;

/** Minimal D1 stand-in over node:sqlite, running the real migration file. Enough for the queries the Worker issues. */
class Stmt {
  constructor(private db: DatabaseSync, private sql: string, private params: unknown[] = []) {}
  bind(...p: unknown[]) { return new Stmt(this.db, this.sql, p.map((v) => (v === undefined ? null : v))); }
  private p() { return this.params as (string | number | null)[]; }
  async run() { const r = this.db.prepare(this.sql).run(...this.p()); return { success: true, meta: { changes: Number(r.changes) } }; }
  async first<T>() { return (this.db.prepare(this.sql).get(...this.p()) as T | undefined) ?? null; }
  async all<T>() { return { results: this.db.prepare(this.sql).all(...this.p()) as T[], success: true, meta: {} }; }
}

export function createDb(): { d1: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(readFileSync(new URL("../migrations/0001_email_queue.sql", import.meta.url), "utf8"));
  return { raw, d1: { prepare: (sql: string) => new Stmt(raw, sql) } as unknown as D1Database };
}

export const TOKEN = "t0ken-".padEnd(48, "x");
export const INGEST = "alerts@example.com";

export function makeEnv(over: Partial<Env> = {}) {
  const { d1, raw } = createDb();
  const env: Env = { DB: d1, HOMEFINDER_QUEUE_TOKEN: TOKEN, HOMEFINDER_INGEST_ADDRESS: INGEST, ...over };
  return { env, raw };
}

export function mime(o: { from?: string; subject?: string; messageId?: string | null; html?: string; text?: string; attachment?: boolean } = {}) {
  const b = "BOUNDARY123";
  const parts = [
    o.text !== undefined ? `--${b}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${o.text}\r\n` : "",
    o.html !== undefined ? `--${b}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${o.html}\r\n` : "",
    o.attachment ? `--${b}\r\nContent-Type: application/pdf; name="a.pdf"\r\nContent-Disposition: attachment; filename="a.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nQVRUQUNITUVOVC1CWVRFUw==\r\n` : "",
    `--${b}--\r\n`,
  ].join("");
  const mid = o.messageId === undefined ? "<id-1@example.net>" : o.messageId;
  return (
    `From: ${o.from ?? "Portal <noreply@portal.example>"}\r\nTo: ${INGEST}\r\nSubject: ${o.subject ?? "Novos imóveis"}\r\n` +
    (mid ? `Message-ID: ${mid}\r\n` : "") +
    `MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="${b}"\r\n\r\n${parts}`
  );
}

export function fakeMessage(raw: string | Uint8Array, over: { from?: string; to?: string; rawSize?: number } = {}) {
  const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : raw;
  const setReject = vi.fn();
  const msg = {
    from: over.from ?? "noreply@portal.example",
    to: over.to ?? INGEST,
    rawSize: over.rawSize ?? bytes.byteLength,
    raw: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }),
    headers: new Headers(),
    setReject,
  } as unknown as ForwardableEmailMessage;
  return { msg, setReject };
}

export const authed = (path: string, init: RequestInit = {}) =>
  new Request(`https://w.example${path}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers as object) } });
export const post = (path: string, body: unknown) =>
  authed(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
