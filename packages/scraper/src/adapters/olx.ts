import { isSane, parseTypology, type Condition, type Listing } from "@homefinder/core";
import { slug } from "./slug";
import type { PortalAdapter } from "./types";

interface OlxParam { key: string; value: string; normalizedValue: string }
interface OlxAd {
  id: number; title: string; url: string; photos?: string[];
  params: OlxParam[];
  location?: { pathName?: string; cityName?: string; regionName?: string };
  price?: { regularPrice?: { value?: number } };
}

const CONDITION: Record<string, Condition> = { novo: "new", usado: "used", renovado: "used", "para-recuperar": "renovate", "em-construcao": "new" };

export function extractState(html: string): { ads: OlxAd[] } {
  const m = html.match(/__PRERENDERED_STATE__= ("(?:[^"\\]|\\.)*")/);
  if (!m?.[1]) throw new Error("OLX: embedded state not found (layout changed or blocked)");
  const state = JSON.parse(JSON.parse(m[1]));
  return { ads: state?.listing?.listing?.ads ?? [] };
}

export const olx: PortalAdapter = {
  portal: "olx",
  searchUrls: ({ distrito, concelho }, page = 1) => [
    `https://www.olx.pt/imoveis/apartamento-casa-a-venda/apartamentos-venda/${slug(concelho ?? distrito ?? "")}/?search%5Border%5D=created_at:desc${page > 1 ? `&page=${page}` : ""}`,
  ],
  parse(html) {
    const out: Listing[] = [];
    for (const ad of extractState(html).ads) {
      const param = (k: string) => ad.params.find((p) => p.key === k);
      const price = ad.price?.regularPrice?.value;
      const area = Number(param("area_util")?.normalizedValue ?? param("area_bruta")?.normalizedValue);
      if (!price || !area || !isSane(price, area)) continue;
      const [concelho = "", freguesia = null] = (ad.location?.pathName ?? "").split(",").map((s) => s.trim());
      out.push({
        portal: "olx",
        portalId: String(ad.id),
        url: ad.url,
        title: ad.title,
        price,
        areaM2: area,
        typology: parseTypology(param("tipologia")?.value ?? ad.title),
        condition: CONDITION[param("condicao")?.normalizedValue ?? ""] ?? null,
        distrito: ad.location?.regionName ?? concelho,
        concelho,
        freguesia: freguesia || null,
        imageUrl: ad.photos?.[0]?.replace(/;s=\{width\}x\{height\}/, ";s=640x480") ?? null,
      });
    }
    return out;
  },
};
