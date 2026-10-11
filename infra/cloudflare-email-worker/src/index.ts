import { handleApi } from "./api";
import { intVar, LIMITS, RETENTION_DEFAULTS, type Env } from "./env";
import { idempotencyKey, parseMime, portalHint, readLimited, senderAllowed, sha256Hex, withinBodyLimits } from "./mime";
import { cleanup, insertMessage } from "./queue";

/** Structured, content-free logging: event names and ids only. Never bodies, addresses, URLs or tokens. */
const log = (event: string, extra: Record<string, string | number> = {}) => console.log(JSON.stringify({ event, ...extra }));

export async function handleEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  try {
    if (message.to.trim().toLowerCase() !== (env.HOMEFINDER_INGEST_ADDRESS ?? "").trim().toLowerCase()) {
      message.setReject("Unknown recipient");
      return log("rejected", { reason: "recipient" });
    }
    if (!senderAllowed(message.from, env.ALLOWED_SENDERS, env.ALLOWED_SENDER_DOMAINS)) {
      message.setReject("Sender not allowed");
      return log("rejected", { reason: "sender" });
    }
    const maxRaw = Math.min(intVar(env.MAX_RAW_BYTES, LIMITS.maxRawBytes, 1024, LIMITS.maxRawBytes), LIMITS.maxRawBytes);
    if (message.rawSize > maxRaw) {
      message.setReject("Message too large");
      return log("rejected", { reason: "too_large" });
    }
    const raw = await readLimited(message.raw, maxRaw);
    if (!raw) {
      message.setReject("Message too large");
      return log("rejected", { reason: "too_large" });
    }
    const mail = await parseMime(raw);
    if (!mail) {
      // Unparseable MIME is kept (headers only) as quarantined so the operator can see it happened.
      const key = await sha256Hex(raw); // content hash of the raw bytes: distinct broken mails never collide
      await insertMessage(env.DB, { sender: message.from, recipient: message.to, subject: null, text: null, html: null, portalHint: null, idempotencyKey: key, status: "quarantined", errorCode: "mime_unparseable" });
      return log("quarantined", { reason: "mime_unparseable" });
    }
    const key = await idempotencyKey(mail, message.from);
    if (!withinBodyLimits(mail)) {
      const r = await insertMessage(env.DB, { sender: message.from, recipient: message.to, subject: mail.subject, text: null, html: null, portalHint: null, idempotencyKey: key, status: "quarantined", errorCode: "body_too_large" });
      return log(r.duplicate ? "duplicate" : "quarantined", { reason: "body_too_large" });
    }
    const r = await insertMessage(env.DB, {
      sender: message.from, recipient: message.to, subject: mail.subject, text: mail.text, html: mail.html,
      portalHint: portalHint(mail.html), idempotencyKey: key,
    });
    log(r.duplicate ? "duplicate" : "stored", r.duplicate ? {} : { id: r.id });
  } catch {
    // Never let one bad message throw out of the handler. Ask the sender's server to retry later (temporary failure).
    try { message.setReject("Processing error"); } catch { /* already settled */ }
    log("error", { reason: "email_handler" });
  }
}

export default {
  email: (message, env) => handleEmail(message, env),
  fetch: (req, env) => handleApi(req, env),
  scheduled: async (_event, env, ctx) => {
    ctx.waitUntil(
      cleanup(env.DB, {
        payloadDays: intVar(env.PAYLOAD_RETENTION_DAYS, RETENTION_DEFAULTS.payloadDays),
        quarantineDays: intVar(env.QUARANTINE_RETENTION_DAYS, RETENTION_DEFAULTS.quarantineDays),
        metadataDays: intVar(env.METADATA_RETENTION_DAYS, RETENTION_DEFAULTS.metadataDays),
        pendingMaxAgeDays: intVar(env.PENDING_MAX_AGE_DAYS, RETENTION_DEFAULTS.pendingMaxAgeDays),
      }).then((r) => log("cleanup", r)),
    );
  },
} satisfies ExportedHandler<Env>;
