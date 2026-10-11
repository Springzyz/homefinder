import { LIMITS, type Env } from "./env";
import { acknowledge, listPending, queueStats, reportFailures, type FailReport } from "./queue";
import { sha256Hex } from "./mime";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE = /^[a-z0-9_]{1,64}$/;

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });
/** Errors carry a machine code only: never request content, message bodies or credentials. */
const err = (status: number, code: string, extra: Record<string, string> = {}) => json({ error: code }, status, extra);

async function authorised(req: Request, expected: string | undefined): Promise<boolean> {
  if (!expected || expected.length < 32) return false;
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return false;
  const [a, b] = await Promise.all([sha256Hex(m[1]!), sha256Hex(expected)]); // fixed-length digests, constant-time compare
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readJson(req: Request): Promise<unknown | "too_large" | "invalid"> {
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) return "invalid";
  if (Number(req.headers.get("content-length") ?? 0) > LIMITS.maxRequestBytes) return "too_large";
  const reader = req.body?.getReader();
  if (!reader) return "invalid";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > LIMITS.maxRequestBytes) { await reader.cancel(); return "too_large"; }
    chunks.push(value);
  }
  try { return JSON.parse(new TextDecoder().decode(Buffer_concat(chunks))); } catch { return "invalid"; }
}
function Buffer_concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

const idList = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length >= 1 && v.length <= LIMITS.maxBatch && v.every((x) => typeof x === "string" && UUID.test(x)) && new Set(v).size === v.length ? (v as string[]) : null;

export async function handleApi(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/health") return req.method === "GET" ? json({ ok: true }) : err(405, "method_not_allowed", { allow: "GET" });
  if (!url.pathname.startsWith("/api/v1/")) return err(404, "not_found");
  if (!env.HOMEFINDER_QUEUE_TOKEN || env.HOMEFINDER_QUEUE_TOKEN.length < 32) return err(503, "not_configured");
  if (!(await authorised(req, env.HOMEFINDER_QUEUE_TOKEN))) return err(401, "unauthorized", { "www-authenticate": "Bearer" });

  const route = url.pathname.slice("/api/v1".length);
  const allowed: Record<string, string> = { "/messages": "GET", "/messages/ack": "POST", "/messages/fail": "POST", "/stats": "GET" };
  const method = allowed[route];
  if (!method) return err(404, "not_found");
  if (req.method !== method) return err(405, "method_not_allowed", { allow: method });

  try {
    if (route === "/messages") {
      const raw = url.searchParams.get("limit");
      const limit = raw === null ? LIMITS.defaultBatch : Number(raw);
      if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.maxBatch) return err(400, "invalid_limit");
      return json({ messages: await listPending(env.DB, limit) });
    }
    if (route === "/stats") return json(await queueStats(env.DB));

    const body = await readJson(req);
    if (body === "too_large") return err(413, "request_too_large");
    if (body === "invalid" || typeof body !== "object" || body === null) return err(400, "invalid_body");

    if (route === "/messages/ack") {
      const ids = idList((body as { ids?: unknown }).ids);
      if (!ids) return err(400, "invalid_ids");
      return json(await acknowledge(env.DB, ids));
    }
    const items = (body as { items?: unknown }).items;
    if (!Array.isArray(items) || items.length < 1 || items.length > LIMITS.maxBatch) return err(400, "invalid_items");
    const ok = items.every((i) => i && typeof i === "object" && UUID.test((i as FailReport).id) && ((i as FailReport).outcome === "retry" || (i as FailReport).outcome === "quarantine") && CODE.test((i as FailReport).code));
    if (!ok) return err(400, "invalid_items");
    return json(await reportFailures(env.DB, items.map((i: FailReport) => ({ id: i.id, outcome: i.outcome, code: i.code }))));
  } catch {
    return err(500, "internal_error"); // never echo the underlying error
  }
}
