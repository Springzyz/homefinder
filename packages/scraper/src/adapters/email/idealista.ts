import { parseAlertEmail, type EmailInput, type ParseOutcome, type PortalSpec } from "./shared";

/**
 * Built from ONE real (manually forwarded) "Resumo diário de novos imóveis" mail. Each card reads, in order:
 * label (Novidade | Recomendação), title "<typology> na <street>, <zone>", "<price> €", "<n> €/m²",
 * "<typology> <area> m² <floor…>", advertiser free text, "Ver N fotos". Only "Novidade" cards (matches of the
 * saved search) are ingested; "Recomendação" cards are outside the user's filters. Only the title and the
 * structured price/details are read: the advertiser's free text is never used as data.
 */
const isAreaPart = (p: string) => /\d\s*m(?:²|2)(?!\d)/i.test(p.replace(/€\s*\/\s*m(?:²|2)/gi, ""));

export function idealistaCardFields(parts: string[]): { skip: true } | { parts: string[] } {
  if (parts[0] !== "Novidade") return { skip: true };
  const end = parts.findIndex((p, i) => i >= 2 && isAreaPart(p));
  if (end < 0) return { parts: [] }; // no details line: no area -> rejected as missing_area
  // Drop the "€/m²" figure (derived by the portal) so only the asking price counts; "Cidade de X" -> "X".
  // The details line starts with the typology ("T3 100 m²"): remove it so "3 100" is never read as 3 100 m².
  const fields = parts.slice(1, end + 1)
    .filter((p) => !/€\s*\/\s*m(?:²|2)/i.test(p))
    .map((p, i, all) => (i === all.length - 1 ? p.replace(/^\s*T\d\+?\s+/i, "") : p.replace(/\bCidade de\s+/i, "")));
  return { parts: fields };
}

export const idealistaSpec: PortalSpec = {
  portal: "idealista",
  hosts: ["idealista.pt", "www.idealista.pt"],
  isListingPath: (p) => /^\/imovel\/\d{5,}$/.test(p),
  idFromPath: (p) => p.match(/^\/imovel\/(\d+)$/)?.[1] ?? null,
  cardFields: idealistaCardFields,
};

export const parseIdealistaEmail = (e: EmailInput): ParseOutcome => parseAlertEmail(idealistaSpec, e);
