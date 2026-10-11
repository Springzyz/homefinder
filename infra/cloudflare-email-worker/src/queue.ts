import { LIMITS, RETENTION_DEFAULTS } from "./env";

export type Status = "pending" | "processed" | "retryable_error" | "quarantined";

export interface NewMessage {
  sender: string;
  recipient: string;
  subject: string | null;
  text: string | null;
  html: string | null;
  portalHint: "imovirtual" | "supercasa" | null;
  idempotencyKey: string;
  status?: Status;
  errorCode?: string;
}

const nowS = () => Math.floor(Date.now() / 1000);

/** Inserts once per idempotency key. */
export async function insertMessage(db: D1Database, m: NewMessage, now = nowS()): Promise<{ id: string; duplicate: boolean }> {
  const id = crypto.randomUUID();
  const r = await db
    .prepare(
      `INSERT INTO email_messages (id, idempotency_key, sender, recipient, subject, received_at, text_body, html_body, portal_hint, status, error_code, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?6)
       ON CONFLICT(idempotency_key) DO NOTHING`,
    )
    .bind(id, m.idempotencyKey, m.sender, m.recipient, m.subject, now, m.text, m.html, m.portalHint, m.status ?? "pending", m.errorCode ?? null)
    .run();
  return { id, duplicate: (r.meta?.changes ?? 0) === 0 };
}

interface Row {
  id: string; sender: string | null; recipient: string | null; subject: string | null; received_at: number;
  text_body: string | null; html_body: string | null; portal_hint: string | null; attempts: number;
}

/** Oldest first. Listing does not change state: a message stays available until it is acknowledged or fails terminally. */
export async function listPending(db: D1Database, limit: number) {
  const n = Math.max(1, Math.min(LIMITS.maxBatch, Math.floor(limit)));
  const { results } = await db
    .prepare(
      `SELECT id, sender, recipient, subject, received_at, text_body, html_body, portal_hint, attempts
         FROM email_messages WHERE status IN ('pending', 'retryable_error') AND payload_scrubbed_at IS NULL
         ORDER BY received_at ASC, id ASC LIMIT ?1`,
    )
    .bind(n)
    .all<Row>();
  return results.map((r) => ({
    id: r.id,
    receivedAt: new Date(r.received_at * 1000).toISOString(),
    sender: r.sender,
    recipient: r.recipient,
    subject: r.subject,
    portalHint: r.portal_hint as "imovirtual" | "supercasa" | null,
    text: r.text_body,
    html: r.html_body,
    attempts: r.attempts,
  }));
}

/** "?1,?2,?3" starting at `from`. */
const placeholders = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `?${i + from}`).join(",");

async function statuses(db: D1Database, ids: string[]): Promise<Map<string, Status>> {
  if (!ids.length) return new Map();
  const { results } = await db.prepare(`SELECT id, status FROM email_messages WHERE id IN (${placeholders(ids.length)})`).bind(...ids).all<{ id: string; status: Status }>();
  return new Map(results.map((r) => [r.id, r.status]));
}

/**
 * Idempotent. Only pending/retryable messages become processed. Already-processed ids are reported as such;
 * unknown ids and quarantined ids are reported back and left untouched.
 */
export async function acknowledge(db: D1Database, ids: string[], now = nowS()) {
  const cur = await statuses(db, ids);
  const open = ids.filter((i) => cur.get(i) === "pending" || cur.get(i) === "retryable_error");
  if (open.length) {
    await db
      .prepare(`UPDATE email_messages SET status='processed', error_code=NULL, updated_at=?1 WHERE status IN ('pending','retryable_error') AND id IN (${placeholders(open.length, 2)})`)
      .bind(now, ...open)
      .run();
  }
  return {
    acknowledged: open.length,
    alreadyProcessed: ids.filter((i) => cur.get(i) === "processed").length,
    unknown: ids.filter((i) => !cur.has(i)),
    notAckable: ids.filter((i) => cur.get(i) === "quarantined"),
  };
}

export interface FailReport { id: string; outcome: "retry" | "quarantine"; code: string }

/** retry -> retryable_error (+1 attempt; at the attempt limit it is quarantined); quarantine -> terminal. */
export async function reportFailures(db: D1Database, items: FailReport[], now = nowS()) {
  const cur = await statuses(db, items.map((i) => i.id));
  let retried = 0, quarantined = 0, ignored = 0;
  for (const it of items) {
    const st = cur.get(it.id);
    if (st !== "pending" && st !== "retryable_error") { ignored++; continue; }
    if (it.outcome === "quarantine") {
      await db.prepare(`UPDATE email_messages SET status='quarantined', error_code=?2, attempts=attempts+1, updated_at=?3 WHERE id=?1`).bind(it.id, it.code, now).run();
      quarantined++;
    } else {
      const r = await db
        .prepare(
          `UPDATE email_messages SET attempts=attempts+1, updated_at=?3,
             status = CASE WHEN attempts+1 >= ?4 THEN 'quarantined' ELSE 'retryable_error' END,
             error_code = CASE WHEN attempts+1 >= ?4 THEN 'max_attempts' ELSE ?2 END
           WHERE id=?1 RETURNING status`,
        )
        .bind(it.id, it.code, now, LIMITS.maxAttempts)
        .first<{ status: Status }>();
      if (r?.status === "quarantined") quarantined++;
      else retried++;
    }
  }
  return { retried, quarantined, ignored };
}

export async function queueStats(db: D1Database, now = nowS()) {
  const { results } = await db.prepare(`SELECT status, COUNT(*) AS n FROM email_messages GROUP BY status`).all<{ status: Status; n: number }>();
  const by = Object.fromEntries(results.map((r) => [r.status, r.n]));
  const oldest = await db
    .prepare(`SELECT MIN(received_at) AS t FROM email_messages WHERE status IN ('pending','retryable_error')`)
    .first<{ t: number | null }>();
  return {
    pending: by.pending ?? 0,
    retryable: by.retryable_error ?? 0,
    quarantined: by.quarantined ?? 0,
    processed: by.processed ?? 0,
    oldestPendingAgeSeconds: oldest?.t != null ? Math.max(0, now - oldest.t) : null,
  };
}

export interface Retention { payloadDays: number; quarantineDays: number; metadataDays: number; pendingMaxAgeDays: number }
export const defaultRetention: Retention = {
  payloadDays: RETENTION_DEFAULTS.payloadDays,
  quarantineDays: RETENTION_DEFAULTS.quarantineDays,
  metadataDays: RETENTION_DEFAULTS.metadataDays,
  pendingMaxAgeDays: RETENTION_DEFAULTS.pendingMaxAgeDays,
};

/**
 * 1. unprocessed messages past the max age are quarantined as `expired` (bounded queue);
 * 2. processed payloads are scrubbed after payloadDays, quarantined ones after quarantineDays (rows are kept for dedupe);
 * 3. rows older than metadataDays are deleted. Recent pending messages are never touched.
 */
export async function cleanup(db: D1Database, r: Retention = defaultRetention, now = nowS()) {
  const day = 86400;
  const expired = await db
    .prepare(`UPDATE email_messages SET status='quarantined', error_code='expired', updated_at=?1 WHERE status IN ('pending','retryable_error') AND received_at < ?2`)
    .bind(now, now - r.pendingMaxAgeDays * day)
    .run();
  const scrub = (days: number, status: Status) =>
    db
      .prepare(
        `UPDATE email_messages SET text_body=NULL, html_body=NULL, sender=NULL, recipient=NULL, subject=NULL, payload_scrubbed_at=?1
          WHERE status=?2 AND payload_scrubbed_at IS NULL AND updated_at < ?3`,
      )
      .bind(now, status, now - days * day)
      .run();
  const a = await scrub(r.payloadDays, "processed");
  const b = await scrub(r.quarantineDays, "quarantined");
  const del = await db
    .prepare(`DELETE FROM email_messages WHERE status IN ('processed','quarantined') AND updated_at < ?1`)
    .bind(now - r.metadataDays * day)
    .run();
  return {
    expired: expired.meta?.changes ?? 0,
    scrubbed: (a.meta?.changes ?? 0) + (b.meta?.changes ?? 0),
    deleted: del.meta?.changes ?? 0,
  };
}
