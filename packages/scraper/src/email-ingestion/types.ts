/**
 * Queue contract shared with infra/cloudflare-email-worker (keep both in sync; see docs/cloudflare-email-ingestion.md).
 * The Worker is ours, but its JSON is still validated before use.
 */
export const MAX_BATCH = 20;
export const MAX_TEXT_CHARS = 100_000;
export const MAX_HTML_CHARS = 300_000;
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export type PortalHint = "imovirtual" | "supercasa";

export interface QueueMessage {
  id: string;
  receivedAt: string;
  sender: string | null;
  recipient: string | null;
  subject: string | null;
  /** Worker's best-effort guess from link hosts. Never trusted: the scraper re-detects from content. */
  portalHint: PortalHint | null;
  text: string | null;
  html: string | null;
  attempts: number;
}

export type FailOutcome = "retry" | "quarantine";
export interface FailItem { id: string; outcome: FailOutcome; code: string }

export class QueueProtocolError extends Error {}
export class QueueConfigError extends Error {}
export class QueueAuthError extends Error {}
export class QueueRateLimitedError extends Error {
  constructor(public retryAfterSeconds: number | null) {
    super("queue rate limited (429)");
  }
}
export class QueueUnavailableError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isQueueId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const optString = (v: unknown, max: number, what: string): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || v.length > max) throw new QueueProtocolError(`invalid ${what}`);
  return v;
};

export function parseQueueMessages(json: unknown): QueueMessage[] {
  const list = (json as { messages?: unknown })?.messages;
  if (!Array.isArray(list)) throw new QueueProtocolError("response has no messages array");
  if (list.length > MAX_BATCH) throw new QueueProtocolError("batch larger than allowed");
  return list.map((raw: any) => {
    if (!raw || typeof raw !== "object" || !isQueueId(raw.id)) throw new QueueProtocolError("invalid message id");
    const hint = raw.portalHint ?? null;
    if (hint !== null && hint !== "imovirtual" && hint !== "supercasa") throw new QueueProtocolError("invalid portal hint");
    const receivedAt = optString(raw.receivedAt, 40, "receivedAt");
    if (!receivedAt || Number.isNaN(Date.parse(receivedAt))) throw new QueueProtocolError("invalid receivedAt");
    const attempts = Number(raw.attempts ?? 0);
    if (!Number.isInteger(attempts) || attempts < 0 || attempts > 1000) throw new QueueProtocolError("invalid attempts");
    return {
      id: raw.id,
      receivedAt,
      sender: optString(raw.sender, 320, "sender"),
      recipient: optString(raw.recipient, 320, "recipient"),
      subject: optString(raw.subject, 1000, "subject"),
      portalHint: hint,
      text: optString(raw.text, MAX_TEXT_CHARS, "text"),
      html: optString(raw.html, MAX_HTML_CHARS, "html"),
      attempts,
    };
  });
}

export interface QueueConfig { baseUrl: string; token: string }

/** Validates configuration before any network call. Throws QueueConfigError with an actionable message. */
export function loadQueueConfig(env: Record<string, string | undefined>): QueueConfig {
  const url = env.CLOUDFLARE_EMAIL_QUEUE_URL?.trim();
  const token = env.CLOUDFLARE_EMAIL_QUEUE_TOKEN?.trim();
  if (!url) throw new QueueConfigError("CLOUDFLARE_EMAIL_QUEUE_URL is not set (see docs/cloudflare-email-ingestion.md)");
  if (!token) throw new QueueConfigError("CLOUDFLARE_EMAIL_QUEUE_TOKEN is not set (see docs/cloudflare-email-ingestion.md)");
  let u: URL;
  try { u = new URL(url); } catch { throw new QueueConfigError("CLOUDFLARE_EMAIL_QUEUE_URL is not a valid URL"); }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new QueueConfigError("CLOUDFLARE_EMAIL_QUEUE_URL must use https (http only for localhost)");
  if (u.username || u.password || u.search || u.hash) throw new QueueConfigError("CLOUDFLARE_EMAIL_QUEUE_URL must not contain credentials, a query string or a fragment");
  if (token.length < 32) throw new QueueConfigError("CLOUDFLARE_EMAIL_QUEUE_TOKEN is too short; generate a long random token (>= 32 chars)");
  return { baseUrl: u.origin + u.pathname.replace(/\/+$/, ""), token };
}
