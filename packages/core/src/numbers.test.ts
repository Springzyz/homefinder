import { describe, expect, it } from "vitest";
import { findAreasM2, findEuroAmounts, parseCondition, parsePtNumber } from "./index";

describe("parsePtNumber", () => {
  it.each([
    ["250 000", 250000], ["250.000", 250000], ["1.250.000", 1250000], ["250 000", 250000],
    ["85,5", 85.5], ["85.5", 85.5], ["1.250,50", 1250.5], ["12", 12],
  ])("%s -> %s", (raw, n) => expect(parsePtNumber(raw)).toBe(n));
  it.each(["", "abc", "1,2,3", "1.2.3", "12.", ",5", "1.25.000,5"])("rejects %j", (raw) => expect(parsePtNumber(raw)).toBeUndefined());
});

describe("findEuroAmounts", () => {
  it("handles the common Portuguese euro formats", () => {
    expect(findEuroAmounts("250 000 €")).toEqual([250000]);
    expect(findEuroAmounts("250.000 €")).toEqual([250000]);
    expect(findEuroAmounts("250.000€")).toEqual([250000]);
    expect(findEuroAmounts("€ 1.250.000")).toEqual([1250000]);
    expect(findEuroAmounts("Preço: 199 500 EUR")).toEqual([199500]);
  });
  it("returns every amount so callers can detect ambiguity", () => {
    expect(findEuroAmounts("antes 300.000 € agora 280.000 €")).toEqual([300000, 280000]);
  });
  it("ignores numbers without a currency", () => {
    expect(findEuroAmounts("T2 com 85 m² no 3º andar")).toEqual([]);
  });
});

describe("findAreasM2", () => {
  it("parses integer and decimal areas", () => {
    expect(findAreasM2("85 m²")).toEqual([85]);
    expect(findAreasM2("85,5 m²")).toEqual([85.5]);
    expect(findAreasM2("85.5m2")).toEqual([85.5]);
    expect(findAreasM2("1.200 m²")).toEqual([1200]);
  });
  it("does not read m3 / km² as an area and finds several", () => {
    expect(findAreasM2("12 m3 e 5 km²")).toEqual([]);
    expect(findAreasM2("útil 85 m² bruta 100 m²")).toEqual([85, 100]);
  });
});

describe("parseCondition", () => {
  it("maps explicit keywords only", () => {
    expect(parseCondition("Apartamento novo")).toBe("new");
    expect(parseCondition("Para recuperar")).toBe("renovate");
    expect(parseCondition("Usado")).toBe("used");
    expect(parseCondition("T2 em Lisboa")).toBeNull();
  });
});
