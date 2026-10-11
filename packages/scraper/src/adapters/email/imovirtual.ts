import { parseAlertEmail, type EmailInput, type ParseOutcome, type PortalSpec } from "./shared";

/** UNVERIFIED assumptions (no real sample yet): listings live at /anuncio/<slug>-ID<id>. */
export const imovirtualSpec: PortalSpec = {
  portal: "imovirtual",
  hosts: ["www.imovirtual.com", "imovirtual.com"],
  isListingPath: (p) => /^\/(?:pt\/)?anuncio\/[^/]+$/.test(p),
  idFromPath: (p) => p.match(/-ID([0-9A-Za-z]+)$/)?.[1] ?? null,
};

export const parseImovirtualEmail = (e: EmailInput): ParseOutcome => parseAlertEmail(imovirtualSpec, e);
