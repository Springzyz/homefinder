import type { Condition } from "./types";

const SPACES = /[\s   ]/g;

/**
 * Parses a Portuguese-formatted number: "250 000", "250.000", "85,5", "1.250,50", "85.5".
 * Returns undefined for anything ambiguous or malformed rather than guessing.
 */
export function parsePtNumber(raw: string): number | undefined {
  const s = raw.replace(SPACES, "");
  if (!/^\d[\d.,]*$/.test(s) || /[.,]$/.test(s)) return undefined;
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  let normalised: string;
  if (dots && commas) {
    // Last separator is the decimal mark, the other must be the thousands mark.
    const dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const thou = dec === "," ? "." : ",";
    if (s.split(dec).length !== 2 || !new RegExp(`^\\d{1,3}(\\${thou}\\d{3})+\\${dec}\\d+$`).test(s)) return undefined;
    normalised = s.split(thou).join("").replace(dec, ".");
  } else if (commas) {
    if (commas > 1) return undefined;
    normalised = s.replace(",", ".");
  } else if (dots) {
    // "250.000" / "1.250.000" are thousands; "85.5" is a decimal.
    normalised = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : dots === 1 ? s : "";
    if (!normalised) return undefined;
  } else normalised = s;
  const n = Number(normalised);
  return Number.isFinite(n) ? n : undefined;
}

const AMOUNT = String.raw`(\d{1,3}(?:[ .   ]\d{3})+|\d+)(?:,(\d{1,2}))?`;
const EURO_RE = new RegExp(String.raw`(?:€\s*${AMOUNT}(?![\d,.]*\d)|${AMOUNT}\s*(?:€|EUR\b))`, "gi");

/** Every euro amount mentioned in the text, as numbers (duplicates kept in order). */
export function findEuroAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(EURO_RE)) {
    const whole = m[1] ?? m[3];
    const cents = m[2] ?? m[4];
    const n = parsePtNumber(cents ? `${whole},${cents}` : whole!);
    if (n !== undefined) out.push(n);
  }
  return out;
}

const AREA_RE = /(\d{1,3}(?:[.\s ]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*m(?:²|2)(?![\w²])/gi;

/** Every area in square metres mentioned in the text. */
export function findAreasM2(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(AREA_RE)) {
    const n = parsePtNumber(m[1]!);
    if (n !== undefined && n > 0) out.push(n);
  }
  return out;
}

/** Condition only when a clear keyword is present. */
export function parseCondition(text: string): Condition | null {
  if (/para\s+recuperar|a\s+recuperar|para\s+remodelar|devoluto/i.test(text)) return "renovate";
  if (/\bnovo\b|em\s+constru[cç][aã]o|\bnova\s+constru/i.test(text)) return "new";
  if (/\busado\b|\brenovado\b|\bremodelado\b/i.test(text)) return "used";
  return null;
}
