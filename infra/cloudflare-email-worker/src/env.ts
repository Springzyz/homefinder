export interface Env {
  DB: D1Database;
  /** Secret. Bearer token for the pull API. */
  HOMEFINDER_QUEUE_TOKEN: string;
  HOMEFINDER_INGEST_ADDRESS: string;
  ALLOWED_SENDERS?: string;
  ALLOWED_SENDER_DOMAINS?: string;
  /** Optional overrides, in days / bytes. */
  PAYLOAD_RETENTION_DAYS?: string;
  QUARANTINE_RETENTION_DAYS?: string;
  METADATA_RETENTION_DAYS?: string;
  PENDING_MAX_AGE_DAYS?: string;
  MAX_RAW_BYTES?: string;
}

/** Limits. Keep MAX_* in sync with packages/scraper/src/email-ingestion/types.ts. */
export const LIMITS = {
  maxRawBytes: 512 * 1024, // Workers Free allows ~10 ms CPU per invocation: keep MIME parsing small
  maxTextChars: 100_000,
  maxHtmlChars: 300_000,
  maxBatch: 20,
  defaultBatch: 10,
  maxRequestBytes: 8 * 1024,
  maxAttempts: 5,
} as const;

export const RETENTION_DEFAULTS = {
  /** Processed messages: scrub bodies and addresses after this many days. */
  payloadDays: 3,
  /** Quarantined messages keep their payload longer so a human can diagnose them. */
  quarantineDays: 30,
  /** Rows (idempotency keys only) are deleted after this many days. */
  metadataDays: 60,
  /** Unprocessed messages older than this are quarantined as `expired`: the queue cannot grow forever. */
  pendingMaxAgeDays: 14,
} as const;

export const intVar = (v: string | undefined, fallback: number, min = 1, max = 3650): number => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
