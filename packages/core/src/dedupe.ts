import { normalizeName } from "./normalize";
import type { Listing } from "./types";

/** Same property listed on several portals should share this key. */
export function dedupeKey(l: Listing): string {
  const price = Math.round(l.price / 5000) * 5000;
  const area = Math.round(l.areaM2 / 5) * 5;
  return [price, area, l.typology ?? "?", normalizeName(l.concelho)].join("|");
}
