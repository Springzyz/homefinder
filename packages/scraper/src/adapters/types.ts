import type { Listing } from "@homefinder/core";

export interface PortalAdapter {
  portal: Listing["portal"];
  /** Parse one result page (HTML) into listings. Pure; tested against fixtures. */
  parse(html: string): Listing[];
  /** Newest-first result page URL(s) for a concelho/distrito. */
  searchUrls(loc: { distrito?: string; concelho?: string }, page?: number): string[];
}
