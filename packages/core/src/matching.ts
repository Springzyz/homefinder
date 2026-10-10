import { normalizeName } from "./normalize";
import type { Listing, SearchFilters } from "./types";

export function matchesSearch(l: Listing, f: SearchFilters): boolean {
  const ppsqm = l.price / l.areaM2;
  if (f.priceMin != null && l.price < f.priceMin) return false;
  if (f.priceMax != null && l.price > f.priceMax) return false;
  if (f.ppsqmMax != null && ppsqm > f.ppsqmMax) return false;
  if (f.areaMin != null && l.areaM2 < f.areaMin) return false;
  if (f.typologies?.length && (!l.typology || !f.typologies.includes(l.typology))) return false;
  if (f.conditions?.length && (!l.condition || !f.conditions.includes(l.condition))) return false;
  if (f.locations.length) {
    const ok = f.locations.some((loc) => {
      if (loc.distrito && normalizeName(loc.distrito) !== normalizeName(l.distrito)) return false;
      if (loc.concelho && normalizeName(loc.concelho) !== normalizeName(l.concelho)) return false;
      if (loc.freguesia && normalizeName(loc.freguesia) !== normalizeName(l.freguesia ?? "")) return false;
      return true;
    });
    if (!ok) return false;
  }
  return true;
}
