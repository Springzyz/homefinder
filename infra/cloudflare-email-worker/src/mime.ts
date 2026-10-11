import PostalMime from "postal-mime";
import { LIMITS } from "./env";

export interface ParsedMail {
  messageId: string | null;
  subject: string | null;
  text: string | null;
  html: string | null;
}

/** Reads a stream fully, but gives up (returns null) as soon as `max` bytes are exceeded. */
export async function readLimited(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

/** MIME is parsed as data only. Attachments are ignored (their bytes are never kept). Returns null if unparseable. */
export async function parseMime(raw: Uint8Array): Promise<ParsedMail | null> {
  try {
    const mail = await PostalMime.parse(raw, { maxNestingDepth: 10, maxHeadersSize: 64 * 1024, attachmentEncoding: "arraybuffer" });
    const clean = (s: string | undefined | null) => (s ? s.replace(/\u0000/g, "") : null);
    return {
      messageId: clean(mail.messageId)?.trim().slice(0, 512) || null,
      subject: clean(mail.subject)?.slice(0, 1000) ?? null,
      text: clean(mail.text),
      html: clean(mail.html),
    };
  } catch {
    return null;
  }
}

export const withinBodyLimits = (m: ParsedMail) =>
  (m.text?.length ?? 0) <= LIMITS.maxTextChars && (m.html?.length ?? 0) <= LIMITS.maxHtmlChars;

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", typeof data === "string" ? new TextEncoder().encode(data) : data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Deterministic dedupe key. Message-ID is used when present, but never alone: the sender, subject and body hashes are
 * mixed in, so a repeated or reused Message-ID with different content is still stored, and a missing Message-ID
 * still dedupes on content.
 */
export async function idempotencyKey(mail: ParsedMail, sender: string): Promise<string> {
  const [t, h] = await Promise.all([sha256Hex(mail.text ?? ""), sha256Hex(mail.html ?? "")]);
  return sha256Hex([mail.messageId ?? "", sender.toLowerCase(), mail.subject ?? "", t, h].join("\n"));
}

/** Best-effort guess from link hosts. The consumer re-detects from the content and never trusts this. */
export function portalHint(html: string | null): "imovirtual" | "supercasa" | null {
  if (!html) return null;
  const imo = /https:\/\/(?:www\.)?imovirtual\.com\//i.test(html);
  const sup = /https:\/\/(?:www\.)?supercasa\.pt\//i.test(html);
  return imo === sup ? null : imo ? "imovirtual" : "supercasa";
}

/** Exact addresses and/or domains (a domain also covers its subdomains). Both lists empty = discovery mode (allow all). */
export function senderAllowed(sender: string, addresses: string | undefined, domains: string | undefined): boolean {
  const list = (s?: string) => (s ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const addrs = list(addresses);
  const doms = list(domains).map((d) => d.replace(/^@/, ""));
  if (!addrs.length && !doms.length) return true;
  const s = sender.trim().toLowerCase();
  const host = s.slice(s.lastIndexOf("@") + 1);
  return addrs.includes(s) || doms.some((d) => host === d || host.endsWith("." + d));
}
