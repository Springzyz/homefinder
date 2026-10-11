import { closeDb } from "./db";
import { QueueClient } from "./email-ingestion/client";
import { ingestEmails } from "./email-ingestion/ingest";
import {
  loadQueueConfig, QueueAuthError, QueueConfigError, QueueProtocolError, QueueRateLimitedError, QueueUnavailableError, MAX_BATCH,
} from "./email-ingestion/types";
import { processListings, recordRun } from "./pipeline";

// Usage: pnpm ingest-emails [--limit=10] [--no-notify] [--no-seed] [--dry-run] [--stats]
const flag = (n: string) => process.argv.includes(`--${n}`);
const limit = Math.max(1, Math.min(MAX_BATCH, Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 10) || 10));

try {
  const client = new QueueClient(loadQueueConfig(process.env));
  if (flag("stats")) {
    console.log(await client.stats());
  } else {
    const dryRun = flag("dry-run");
    const s = await ingestEmails(
      { client, process: processListings, recordRun },
      { limit, notify: !flag("no-notify"), seed: flag("no-seed") ? false : undefined, dryRun },
    );
    if (s.fetched === 0) console.log("Queue reachable; nothing pending.");
    else console.log(`${dryRun ? "[dry run, nothing written or acknowledged] " : ""}fetched=${s.fetched} processed=${s.processed} listings=${s.listings} ignored=${s.ignored} quarantined=${s.quarantined} retried=${s.retried} unacked=${s.unacked}`);
    if (Object.keys(s.rejectedCandidates).length) console.log("rejected candidates:", s.rejectedCandidates);
    if (Object.keys(s.codes).length) console.log("problem codes:", s.codes);
    if (s.stoppedEarly) console.warn(s.stoppedEarly);
  }
} catch (e) {
  const msg =
    e instanceof QueueConfigError ? `Configuration error: ${e.message}`
    : e instanceof QueueAuthError ? `Authentication failed: ${e.message}. Check CLOUDFLARE_EMAIL_QUEUE_TOKEN against the Worker secret.`
    : e instanceof QueueRateLimitedError ? `Queue is rate limiting us${e.retryAfterSeconds ? ` (retry after ${e.retryAfterSeconds}s)` : ""}; try later. Not retrying.`
    : e instanceof QueueUnavailableError ? `Queue unavailable: ${e.message}. Nothing was lost; run again later.`
    : e instanceof QueueProtocolError ? `Unexpected queue response: ${e.message}`
    : `Ingestion failed: ${e instanceof Error ? e.message : "unknown error"}`;
  console.error(msg);
  process.exitCode = 1;
} finally {
  await closeDb();
}
