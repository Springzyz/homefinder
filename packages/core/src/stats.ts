import { normalizeName } from "./normalize";
import { MIN_SAMPLE } from "./scoring";
import type { Listing, MarketStat } from "./types";

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Median EUR/m2 per (area level, typology, condition|any); only groups with n >= MIN_SAMPLE. */
export function computeMarketStats(listings: Listing[]): MarketStat[] {
  const groups = new Map<string, { stat: Omit<MarketStat, "medianPpsqm" | "n">; v: number[] }>();
  const add = (level: MarketStat["level"], name: string | null, l: Listing, cond: MarketStat["condition"]) => {
    if (!name || !l.typology) return;
    const key = normalizeName(name);
    const id = [level, key, l.typology, cond].join("|");
    const g = groups.get(id) ?? { stat: { level, key, typology: l.typology, condition: cond }, v: [] };
    g.v.push(l.price / l.areaM2);
    groups.set(id, g);
  };
  for (const l of listings) {
    for (const [level, name] of [["freguesia", l.freguesia], ["concelho", l.concelho], ["distrito", l.distrito]] as const) {
      add(level, name, l, "any");
      if (l.condition) add(level, name, l, l.condition);
    }
  }
  return [...groups.values()]
    .filter((g) => g.v.length >= MIN_SAMPLE)
    .map((g) => ({ ...g.stat, medianPpsqm: Math.round(median(g.v)), n: g.v.length }));
}
