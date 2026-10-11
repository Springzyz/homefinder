import { detectPortal, parseAlertEmail, type EmailInput, type EmailPortal, type ParseOutcome } from "./shared";
import { imovirtualSpec } from "./imovirtual";
import { supercasaSpec } from "./supercasa";
import { idealistaSpec } from "./idealista";

export { imovirtualSpec, supercasaSpec, idealistaSpec };
export const EMAIL_SPECS = [imovirtualSpec, supercasaSpec, idealistaSpec];

/** Picks the parser from the email's own links (not from sender or the Worker's hint). */
export function parseEmail(email: EmailInput): { portal: EmailPortal | null; outcome: ParseOutcome } {
  const portal = detectPortal(email.html, EMAIL_SPECS);
  if (!portal) return { portal: null, outcome: { kind: "unsupported", reason: email.html ? "portal_not_identified" : "no_html_body" } };
  const spec = EMAIL_SPECS.find((s) => s.portal === portal)!;
  return { portal, outcome: parseAlertEmail(spec, email) };
}
