import { CONCELHOS, DISTRITOS } from "./locations";
import { normalizeName } from "./normalize";

export interface Place {
  /** Proper display name, e.g. "Santarém". */
  name: string;
  distrito: string;
  /** Undefined means "whole distrito". */
  concelho?: string;
}

const PLACES: (Place & { norm: string })[] = [
  ...DISTRITOS.map((d) => ({ name: d, distrito: d, norm: normalizeName(d) })),
  ...CONCELHOS.map(([c, d]) => ({ name: c, concelho: c, distrito: d, norm: normalizeName(c) })),
];

/** Accent- and case-insensitive suggestions: prefix matches first, then word/substring matches. */
export function suggestPlaces(text: string, limit = 8): Place[] {
  const t = normalizeName(text);
  if (!t) return [];
  const score = (p: { norm: string }) => (p.norm === t ? 0 : p.norm.startsWith(t) ? 1 : p.norm.includes(` ${t}`) ? 2 : p.norm.includes(t) ? 3 : 9);
  return PLACES.map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s || (b.p.concelho ? 1 : 0) - (a.p.concelho ? 1 : 0) || a.p.name.localeCompare(b.p.name, "pt"))
    .slice(0, limit)
    .map(({ p: { norm: _n, ...place } }) => place);
}

/** Resolve free text ("santarem") to one unambiguous place, or undefined. Prefers concelhos over distritos with the same name. */
export function resolvePlace(text: string, distritoHint?: string): Place | undefined {
  const t = normalizeName(text);
  const hint = distritoHint ? normalizeName(distritoHint) : undefined;
  const hits = PLACES.filter((p) => p.norm === t && (!hint || normalizeName(p.distrito) === hint));
  const best = hits.find((p) => p.concelho) ?? hits[0];
  if (!best) return undefined;
  const { norm: _n, ...place } = best;
  return place;
}
