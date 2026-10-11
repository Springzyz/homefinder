import type { Listing } from "@homefinder/core";
import { parseEmail } from "../adapters/email";
import type { EmailPortal } from "../adapters/email/shared";
import { QueueAuthError, QueueConfigError, QueueRateLimitedError, QueueUnavailableError, type FailItem, type QueueMessage } from "./types";

export interface IngestDeps {
  client: {
    pending(limit: number): Promise<QueueMessage[]>;
    ack(ids: string[]): Promise<void>;
    fail(items: FailItem[]): Promise<void>;
  };
  /** The existing business pipeline (upsert -> score -> match -> notify). Injected so it can be tested in isolation. */
  process(portal: EmailPortal, listings: Listing[], opts: { notify: boolean; seed?: boolean }): Promise<unknown>;
  recordRun(portal: EmailPortal, ok: boolean, found: number): Promise<void>;
}

export interface IngestOptions { limit: number; notify: boolean; seed?: boolean; dryRun: boolean }

export interface IngestSummary {
  fetched: number;
  processed: number;
  listings: number;
  ignored: number;
  quarantined: number;
  retried: number;
  /** Handled locally but the queue could not be told: the message will be redelivered (safe, processing is idempotent). */
  unacked: number;
  rejectedCandidates: Record<string, number>;
  codes: Record<string, number>;
  stoppedEarly: string | null;
}

const bump = (o: Record<string, number>, k: string, n = 1) => { o[k] = (o[k] ?? 0) + n; };

/** Config/auth/rate-limit problems abort the whole run; they are not per-message failures. */
const isFatal = (e: unknown) => e instanceof QueueAuthError || e instanceof QueueRateLimitedError || e instanceof QueueConfigError;

export async function ingestEmails(deps: IngestDeps, opts: IngestOptions): Promise<IngestSummary> {
  const s: IngestSummary = { fetched: 0, processed: 0, listings: 0, ignored: 0, quarantined: 0, retried: 0, unacked: 0, rejectedCandidates: {}, codes: {}, stoppedEarly: null };
  const messages = await deps.client.pending(opts.limit);
  s.fetched = messages.length;

  for (const msg of messages) {
    const { portal, outcome } = parseEmail(msg);
    // What to tell the queue once local handling is decided. `null` = acknowledge as processed.
    let verdict: FailItem | null;

    if (outcome.kind === "listings") {
      for (const r of outcome.rejected) bump(s.rejectedCandidates, r.code);
      if (outcome.listings.length === 0) {
        verdict = { id: msg.id, outcome: "quarantine", code: "no_valid_candidates" };
        bump(s.codes, "no_valid_candidates");
      } else if (opts.dryRun) {
        s.listings += outcome.listings.length;
        verdict = null;
      } else {
        try {
          await deps.process(portal!, outcome.listings, { notify: opts.notify, seed: opts.seed });
          await deps.recordRun(portal!, true, outcome.listings.length);
          s.listings += outcome.listings.length;
          verdict = null;
        } catch (e) {
          if (isFatal(e)) throw e;
          verdict = { id: msg.id, outcome: "retry", code: "pipeline_error" };
          bump(s.codes, "pipeline_error");
        }
      }
    } else if (outcome.kind === "ignored") {
      s.ignored++;
      verdict = null;
    } else {
      verdict = { id: msg.id, outcome: "quarantine", code: outcome.reason.replace(/[^a-z0-9_]/g, "_").slice(0, 64) };
      bump(s.codes, verdict.code);
    }

    if (opts.dryRun) continue; // dry run never touches the queue or the database
    try {
      if (verdict === null) {
        await deps.client.ack([msg.id]);
        s.processed++;
      } else {
        await deps.client.fail([verdict]);
        if (verdict.outcome === "retry") s.retried++;
        else s.quarantined++;
      }
    } catch (e) {
      if (isFatal(e)) throw e;
      if (e instanceof QueueUnavailableError) {
        s.unacked++;
        s.stoppedEarly = "queue became unavailable while acknowledging; remaining messages stay pending";
        break;
      }
      throw e;
    }
  }
  return s;
}
