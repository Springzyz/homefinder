import { parseAlertEmail, type EmailInput, type ParseOutcome, type PortalSpec } from "./shared";

/** UNVERIFIED assumptions (no real sample yet): sale listings live under a /comprar... path and end with a numeric id. */
export const supercasaSpec: PortalSpec = {
  portal: "supercasa",
  hosts: ["supercasa.pt", "www.supercasa.pt"],
  isListingPath: (p) => /^\/comprar[a-z-]*\/.+/.test(p),
  idFromPath: (p) => p.match(/(\d{5,})$/)?.[1] ?? null,
};

export const parseSupercasaEmail = (e: EmailInput): ParseOutcome => parseAlertEmail(supercasaSpec, e);
