import {
  isQueueId, MAX_BATCH, MAX_RESPONSE_BYTES, parseQueueMessages, QueueAuthError, QueueProtocolError, QueueRateLimitedError,
  QueueUnavailableError, type FailItem, type QueueConfig, type QueueMessage,
} from "./types";

type Fetch = typeof fetch;

export interface QueueStats { pending: number; retryable: number; quarantined: number; processed: number; oldestPendingAgeSeconds: number | null }

/** Authenticated client for the Worker's pull API. Bounded time, size and retries; never logs bodies or the token. */
export class QueueClient {
  constructor(
    private cfg: QueueConfig,
    private fetchImpl: Fetch = fetch,
    private opts: { timeoutMs?: number; retries?: number; backoffMs?: number } = {},
  ) {}

  async pending(limit = 10): Promise<QueueMessage[]> {
    const n = Math.max(1, Math.min(MAX_BATCH, Math.floor(limit)));
    return parseQueueMessages(await this.call("GET", `/api/v1/messages?limit=${n}`));
  }

  async ack(ids: string[]): Promise<void> {
    if (!ids.length) return;
    if (ids.length > MAX_BATCH || !ids.every(isQueueId)) throw new QueueProtocolError("invalid ack ids");
    await this.call("POST", "/api/v1/messages/ack", { ids });
  }

  async fail(items: FailItem[]): Promise<void> {
    if (!items.length) return;
    if (items.length > MAX_BATCH || !items.every((i) => isQueueId(i.id) && /^[a-z0-9_]{1,64}$/.test(i.code))) throw new QueueProtocolError("invalid fail items");
    await this.call("POST", "/api/v1/messages/fail", { items });
  }

  async stats(): Promise<QueueStats> {
    return (await this.call("GET", "/api/v1/stats")) as QueueStats;
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const retries = this.opts.retries ?? 1;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once(method, path, body);
      } catch (e) {
        // Only transient failures are retried, a bounded number of times. Auth/429/protocol errors surface immediately.
        if (!(e instanceof QueueUnavailableError) || attempt >= retries) throw e;
        await new Promise((r) => setTimeout(r, (this.opts.backoffMs ?? 1500) * (attempt + 1)));
      }
    }
  }

  private async once(method: string, path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.cfg.baseUrl + path, {
        method,
        headers: { authorization: `Bearer ${this.cfg.token}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
      });
    } catch {
      throw new QueueUnavailableError("queue unreachable (network error or timeout)");
    }
    if (res.status === 401 || res.status === 403) throw new QueueAuthError(`queue rejected the token (HTTP ${res.status})`);
    if (res.status === 429) throw new QueueRateLimitedError(Number(res.headers.get("retry-after")) || null);
    if (res.status >= 500) throw new QueueUnavailableError(`queue error (HTTP ${res.status})`);
    if (!res.ok) throw new QueueProtocolError(`unexpected HTTP ${res.status} from queue`);
    const text = await readBounded(res, MAX_RESPONSE_BYTES);
    try { return JSON.parse(text); } catch { throw new QueueProtocolError("queue returned invalid JSON"); }
  }
}

async function readBounded(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > max) throw new QueueProtocolError("queue response too large");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new QueueProtocolError("queue response too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
