import type { Typology } from "./types";

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseTypology(text: string): Typology | null {
  const m = text.match(/\bT\s?(\d)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 5 ? "T5+" : (`T${n}` as Typology);
}

export function pricePerSqm(price: number, areaM2: number): number {
  return Math.round(price / areaM2);
}

/** Basic sanity filter: drops typos, rentals mislabelled as sales, land etc. */
export function isSane(price: number, areaM2: number): boolean {
  if (!(price >= 10_000) || !(areaM2 >= 15) || areaM2 > 2_000) return false;
  const p = price / areaM2;
  return p >= 200 && p <= 25_000;
}
