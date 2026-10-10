import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { casasapo } from "./casasapo";
import { olx } from "./olx";

const path = (n: string) => new URL(`../../fixtures/${n}.html`, import.meta.url);
const fx = (n: string) => readFileSync(path(n), "utf8");

for (const [name, adapter] of [["olx", olx], ["casasapo", casasapo]] as const) {
  // Fixtures are raw third-party pages kept out of git; capture them locally with curl to run these.
  describe.skipIf(!existsSync(path(name)))(name, () => {
    const listings = existsSync(path(name)) ? adapter.parse(fx(name)) : [];
    it("parses a healthy number of listings", () => expect(listings.length).toBeGreaterThan(15));
    it("returns complete, sane records", () => {
      for (const l of listings) {
        expect(l.portalId).toBeTruthy();
        expect(l.url).toMatch(/^https?:\/\//);
        expect(l.price).toBeGreaterThan(10_000);
        expect(l.areaM2).toBeGreaterThan(14);
        expect(l.concelho).toBeTruthy();
      }
    });
    it("extracts typology for most listings", () => {
      expect(listings.filter((l) => l.typology).length / listings.length).toBeGreaterThan(0.8);
    });
  });
}

describe.skipIf(!existsSync(path("casasapo")))("casasapo images", () => {
  it("never returns data: placeholders and finds most photos", () => {
    const ls = casasapo.parse(fx("casasapo"));
    expect(ls.every((l) => !l.imageUrl || l.imageUrl.startsWith("http"))).toBe(true);
    expect(ls.filter((l) => l.imageUrl).length / ls.length).toBeGreaterThan(0.9);
  });
});
