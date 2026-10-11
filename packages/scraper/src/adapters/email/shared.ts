import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import {
  findAreasM2, findEuroAmounts, findFreguesia, isSane, normalizeName, parseCondition, parseTypology, resolvePlace,
  type Listing, type Portal,
} from "@homefinder/core";

export type EmailPortal = Extract<Portal, "imovirtual" | "supercasa" | "idealista">;

/**
 * UNVERIFIED: the per-portal rules below (hosts, listing-path shape, id extraction) are assumptions that
 * must be checked against sanitised real alert emails before the parsers are trusted in production.
 */
export interface PortalSpec {
  portal: EmailPortal;
  hosts: string[];
  isListingPath(path: string): boolean;
  idFromPath(path: string): string | null;
  /**
   * Optional per-card hook. Returns the text parts that hold the listing's own fields (so advertiser free text is
   * never read as data), or `skip` for cards that must not become listings (e.g. recommendations).
   */
  cardFields?(parts: string[]): { skip: true } | { skip?: false; parts: string[] };
}

export type RejectCode = "ambiguous_price" | "missing_area" | "ambiguous_area" | "implausible_values" | "location_unresolved";
export interface Rejected { code: RejectCode; ref: string } // ref = host+path only, never query strings

export type ParseOutcome =
  | { kind: "listings"; listings: Listing[]; rejected: Rejected[] }
  /** Recognised as deliberately not a listing alert (terminal, safe to acknowledge). */
  | { kind: "ignored"; reason: string }
  /** Could not be understood: must be quarantined for a human, never silently acknowledged. */
  | { kind: "unsupported"; reason: string };

export interface EmailInput { subject: string | null; html: string | null; text: string | null }

/** Subjects of known non-listing mails (confirmations, welcome, password). Narrow on purpose; extend from real samples. */
const IGNORE_SUBJECT = /\b(confirm\w*|bem[- ]vind\w*|welcome|verific\w*|ativ\w*|palavra[- ]passe|password)\b/i;

/** https only, no credentials/port, expected portal host, listing-shaped path. Query strings and fragments are dropped. */
export function canonicalListingUrl(href: string, spec: PortalSpec): { url: string; path: string } | null {
  let u: URL;
  try { u = new URL(href.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (!spec.hosts.includes(host)) return null;
  const path = u.pathname.replace(/\/+$/, "");
  if (!spec.isListingPath(path)) return null;
  return { url: `https://${host}${path}`, path };
}

/** Which portal an email's links point to; null when none or when it mixes both (do not guess). */
export function detectPortal(html: string | null, specs: PortalSpec[]): EmailPortal | null {
  if (!html) return null;
  const $ = cheerio.load(html);
  const found = new Set<EmailPortal>();
  $("a[href]").each((_, a) => {
    try {
      const host = new URL($(a).attr("href")!.trim()).hostname.toLowerCase();
      for (const s of specs) if (s.hosts.includes(host)) found.add(s.portal);
    } catch { /* ignore malformed href */ }
  });
  return found.size === 1 ? [...found][0]! : null;
}

const squash = (s: string) => s.replace(/[\s  ]+/g, " ").trim();
const distinct = (xs: number[]) => [...new Set(xs)];

function chooseArea(text: string): number | "missing" | "ambiguous" {
  const areas = distinct(findAreasM2(text));
  if (areas.length === 1) return areas[0]!;
  if (areas.length === 0) return "missing";
  // "área útil 85 m² / área bruta 100 m²": only when exactly one value is explicitly labelled "útil".
  const useful = distinct([...text.matchAll(/[úu]til[^\d]{0,15}([\d.,\s]+)\s*m(?:²|2)/gi)].flatMap((m) => findAreasM2(`${m[1]} m²`)));
  return useful.length === 1 ? useful[0]! : "ambiguous";
}

/** Text nodes of an element, in order; element boundaries are kept so neighbouring fields never run together. */
function textParts(el: any): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n.type === "text") {
      const t = squash(n.data ?? "");
      if (t) out.push(t);
    } else for (const c of n.children ?? []) walk(c);
  };
  walk(el);
  return out;
}

/**
 * Place text -> concelho/distrito via the project's place list; never invents a location. Several different
 * concelhos in one block are ambiguous (-> null), except that a name which is just the *district* of another
 * match ("Oeiras, Lisboa") does not count as a second place.
 */
function resolveLocation(parts: string[]): { concelho: string; distrito: string } | null {
  const tokens = new Set<string>();
  for (const part of parts) {
    for (const piece of part.split(/[,|·•–—]|\s-\s/)) tokens.add(squash(piece));
    for (const m of part.matchAll(/\bem\s+([^,|·•–—.\d€]{2,40})/gi)) tokens.add(squash(m[1]!));
  }
  const found = new Map<string, { concelho: string; distrito: string }>();
  for (const t of tokens) {
    const place = resolvePlace(t);
    if (place?.concelho) found.set(`${place.distrito}|${place.concelho}`, { concelho: place.concelho, distrito: place.distrito });
  }
  let cands = [...found.values()];
  if (cands.length > 1) {
    // Drop a match that is merely the district name of another match (e.g. "Lisboa" next to "Oeiras").
    const isDistrictOfOther = (c: { concelho: string }) => cands.some((o) => o.concelho !== c.concelho && normalizeName(o.distrito) === normalizeName(c.concelho));
    cands = cands.filter((c) => !isDistrictOfOther(c));
  }
  if (cands.length === 0) return resolveByFreguesia(parts);
  return cands.length === 1 ? cands[0]! : null;
}

/**
 * Fallback when no concelho is named: addresses like "Rua X, Beato" end in a freguesia. The LAST component that is a
 * known freguesia decides; if that name exists in several concelhos it must be narrowed to one by an earlier
 * component that is a freguesia of the same concelho. Still ambiguous -> null (never guessed).
 */
function resolveByFreguesia(parts: string[]): { concelho: string; distrito: string } | null {
  const tokens = parts.flatMap((part) => part.split(/[,|·•–—]|\s-\s/).map(squash).filter(Boolean));
  const hits = tokens.map((t) => findFreguesia(t));
  let last = -1;
  for (let i = hits.length - 1; i >= 0; i--) if (hits[i]!.length) { last = i; break; }
  if (last < 0) return null;
  let cands = hits[last]!;
  if (cands.length > 1) {
    const earlier = new Set(hits.slice(0, last).flatMap((h) => h.map((x) => x.concelho)));
    cands = cands.filter((c) => earlier.has(c.concelho));
  }
  return cands.length === 1 ? { concelho: cands[0]!.concelho, distrito: cands[0]!.distrito } : null;
}

/**
 * Parse an alert email's HTML as data (never rendered, no link is fetched). For each distinct listing link, the
 * block is the largest ancestor containing exactly one distinct listing link; fields are read from that block only.
 */
export function parseAlertEmail(spec: PortalSpec, email: EmailInput): ParseOutcome {
  if (!email.html) return { kind: "unsupported", reason: "no_html_body" };
  const $ = cheerio.load(email.html);
  $("script, style, head").remove();

  const byUrl = new Map<string, { path: string; anchors: cheerio.Cheerio<any>[] }>();
  const urlOf = new Map<any, string>();
  $("a[href]").each((_, a) => {
    const c = canonicalListingUrl($(a).attr("href")!, spec);
    if (!c) return;
    urlOf.set(a, c.url);
    const g = byUrl.get(c.url) ?? { path: c.path, anchors: [] };
    g.anchors.push($(a));
    byUrl.set(c.url, g);
  });
  if (byUrl.size === 0) {
    return IGNORE_SUBJECT.test(email.subject ?? "") ? { kind: "ignored", reason: "non_listing_subject" } : { kind: "unsupported", reason: "no_listing_links" };
  }

  const countUrls = (node: cheerio.Cheerio<any>) => new Set(node.find("a[href]").addBack("a[href]").toArray().map((a) => urlOf.get(a)).filter(Boolean)).size;
  const listings: Listing[] = [];
  const rejected: Rejected[] = [];
  let withPrice = 0;

  for (const [url, g] of byUrl) {
    let block = g.anchors[0]!;
    for (let node = block.parent(); node.length && !node.is("body, html"); node = node.parent()) {
      if (countUrls(node) !== 1) break;
      block = node;
    }
    let parts = textParts(block.get(0));
    const ref = url.replace("https://", "");
    if (spec.cardFields) {
      const f = spec.cardFields(parts);
      if (f.skip) { withPrice++; continue; } // understood and deliberately not ingested
      parts = f.parts;
    }
    const text = parts.join(" ");
    const prices = distinct(findEuroAmounts(text));
    if (prices.length === 0) continue; // a link without a price is navigation, not a listing
    withPrice++;
    if (prices.length > 1) { rejected.push({ code: "ambiguous_price", ref }); continue; }
    const area = chooseArea(text);
    if (area === "missing") { rejected.push({ code: "missing_area", ref }); continue; }
    if (area === "ambiguous") { rejected.push({ code: "ambiguous_area", ref }); continue; }
    const price = prices[0]!;
    if (!isSane(price, area)) { rejected.push({ code: "implausible_values", ref }); continue; }
    const loc = resolveLocation(parts);
    if (!loc) { rejected.push({ code: "location_unresolved", ref }); continue; }
    const typology = parseTypology(text);
    const label = g.anchors.map((a) => squash(a.text())).filter((t) => /[a-zà-ú]/i.test(t)).sort((a, b) => b.length - a.length)[0];
    listings.push({
      portal: spec.portal,
      portalId: spec.idFromPath(g.path) ?? `h_${createHash("sha256").update(url).digest("hex").slice(0, 16)}`,
      url,
      title: (label ?? `${typology ?? "Imóvel"} ${loc.concelho}`).slice(0, 200),
      price,
      areaM2: area,
      typology,
      condition: parseCondition(text),
      distrito: loc.distrito,
      concelho: loc.concelho,
      freguesia: null,
      imageUrl: null,
    });
  }

  if (withPrice === 0) {
    return IGNORE_SUBJECT.test(email.subject ?? "") ? { kind: "ignored", reason: "non_listing_subject" } : { kind: "unsupported", reason: "no_priced_listing_blocks" };
  }
  return { kind: "listings", listings, rejected };
}

export const _internal = { normalizeName };
