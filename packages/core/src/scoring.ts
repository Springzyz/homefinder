import { normalizeName } from "./normalize";
import type { Condition, Label, Listing, MarketStat, Score } from "./types";

export const MIN_SAMPLE = 15;

export interface Thresholds {
  steal: number; // discount >= this
  great: number;
  good: number;
  fair: number; // |discount| < this is "fair"
}
export const DEFAULT_THRESHOLDS: Thresholds = { steal: 0.25, great: 0.15, good: 0.05, fair: 0.05 };

export const LABEL_ORDER: Label[] = ["above", "fair", "good", "great", "steal"];

export function labelFor(discount: number, t: Thresholds = DEFAULT_THRESHOLDS): Label {
  if (discount >= t.steal) return "steal";
  if (discount >= t.great) return "great";
  if (discount >= t.good) return "good";
  if (discount > -t.fair) return "fair";
  return "above";
}

export function atLeast(label: Label | null, min: Label): boolean {
  return label !== null && LABEL_ORDER.indexOf(label) >= LABEL_ORDER.indexOf(min);
}

function pick(
  stats: MarketStat[],
  level: MarketStat["level"],
  key: string | null,
  l: Listing,
): MarketStat | undefined {
  if (!key || !l.typology) return undefined;
  const k = normalizeName(key);
  const cond: Condition | "any" = l.condition ?? "any";
  const matches = stats.filter(
    (s) => s.level === level && s.key === k && s.typology === l.typology && s.n >= MIN_SAMPLE,
  );
  return matches.find((s) => s.condition === cond) ?? matches.find((s) => s.condition === "any");
}

/**
 * Benchmark = median EUR/m2 for same typology (+condition) at the most specific
 * level with enough samples: freguesia -> concelho -> distrito.
 */
export function scoreListing(
  l: Listing,
  stats: MarketStat[],
  t: Thresholds = DEFAULT_THRESHOLDS,
): Score {
  const ppsqm = l.price / l.areaM2;
  const candidates: [MarketStat["level"], string | null][] = [
    ["freguesia", l.freguesia],
    ["concelho", l.concelho],
    ["distrito", l.distrito],
  ];
  for (const [level, key] of candidates) {
    const s = pick(stats, level, key, l);
    if (s) {
      const discountPct = (s.medianPpsqm - ppsqm) / s.medianPpsqm;
      return {
        benchmarkLevel: level,
        benchmarkPpsqm: s.medianPpsqm,
        discountPct,
        label: labelFor(discountPct, t),
        lowConfidence: level === "distrito" || s.n < MIN_SAMPLE * 2,
      };
    }
  }
  return { benchmarkLevel: "none", benchmarkPpsqm: null, discountPct: null, label: null, lowConfidence: true };
}
