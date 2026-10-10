import { describe, expect, it } from "vitest";
import { atLeast, dedupeKey, isSane, labelFor, matchesSearch, normalizeName, parseTypology, scoreListing } from "./index";
import type { Listing, MarketStat } from "./index";

const base: Listing = {
  portal: "olx", portalId: "1", url: "u", title: "T2", price: 200_000, areaM2: 80,
  typology: "T2", condition: "used", distrito: "Lisboa", concelho: "Lisboa", freguesia: null,
};
const stats: MarketStat[] = [
  { level: "concelho", key: "lisboa", typology: "T2", condition: "any", medianPpsqm: 5000, n: 100 },
  { level: "concelho", key: "santarem", typology: "T2", condition: "any", medianPpsqm: 1500, n: 100 },
];

describe("scoring", () => {
  it("same price is a better deal in Santarem than Lisboa", () => {
    const lis = scoreListing(base, stats);
    const san = scoreListing({ ...base, distrito: "Santarem", concelho: "Santarém" }, stats);
    expect(lis.label).toBe("steal"); // 2500/m2 vs 5000
    expect(san.label).toBe("above"); // 2500/m2 vs 1500
  });
  it("returns no label without enough data", () => {
    expect(scoreListing({ ...base, concelho: "Faro", distrito: "Faro" }, stats).label).toBeNull();
  });
  it("label thresholds and ordering", () => {
    expect(labelFor(0.3)).toBe("steal");
    expect(labelFor(0.2)).toBe("great");
    expect(labelFor(0.1)).toBe("good");
    expect(labelFor(0)).toBe("fair");
    expect(labelFor(-0.2)).toBe("above");
    expect(atLeast("great", "good")).toBe(true);
    expect(atLeast(null, "good")).toBe(false);
  });
});

describe("matching", () => {
  it("filters by price, typology and location (accent-insensitive)", () => {
    const f = { locations: [{ concelho: "lisboa" }], priceMax: 250_000, typologies: ["T2" as const] };
    expect(matchesSearch(base, f)).toBe(true);
    expect(matchesSearch({ ...base, price: 300_000 }, f)).toBe(false);
    expect(matchesSearch({ ...base, typology: "T3" }, f)).toBe(false);
    expect(matchesSearch({ ...base, concelho: "Porto" }, f)).toBe(false);
  });
});

describe("helpers", () => {
  it("normalises names and typology", () => {
    expect(normalizeName("Santarém")).toBe("santarem");
    expect(parseTypology("Apartamento T3 renovado")).toBe("T3");
    expect(parseTypology("Moradia T6")).toBe("T5+");
  });
  it("sanity filter", () => {
    expect(isSane(200_000, 80)).toBe(true);
    expect(isSane(5_000, 80)).toBe(false);
    expect(isSane(200_000, 5)).toBe(false);
  });
  it("dedupes across portals", () => {
    expect(dedupeKey(base)).toBe(dedupeKey({ ...base, portal: "idealista", price: 201_000, areaM2: 81 }));
  });
});

import { computeMarketStats, median } from "./index";
describe("market stats", () => {
  it("median handles odd/even", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("only emits groups with enough samples, at each level", () => {
    const ls = Array.from({ length: 20 }, (_, i) => ({ ...base, portalId: String(i), price: 160_000 + i * 1000, freguesia: "Alvalade" }));
    const stats = computeMarketStats(ls);
    const c = stats.find((s) => s.level === "concelho" && s.condition === "any");
    expect(c?.n).toBe(20);
    expect(stats.find((s) => s.level === "freguesia" && s.key === "alvalade")).toBeTruthy();
    expect(computeMarketStats(ls.slice(0, 5))).toEqual([]);
  });
});
