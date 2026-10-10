import * as cheerio from "cheerio";
import { isSane, parseTypology, type Condition, type Listing } from "@homefinder/core";
import { slug } from "./slug";
import type { PortalAdapter } from "./types";

const CONDITION: [RegExp, Condition][] = [
  [/novo|em constru/i, "new"],
  [/recuperar/i, "renovate"],
  [/usado|renovado/i, "used"],
];

const num = (s: string) => Number(s.replace(/[^\d,]/g, "").replace(",", "."));

export const casasapo: PortalAdapter = {
  portal: "casasapo",
  searchUrls: ({ concelho, distrito }, page = 1) => [
    `https://casa.sapo.pt/comprar-apartamentos/${slug(concelho ?? distrito ?? "")}/?ordenar=mais-recentes${page > 1 ? `&pn=${page}` : ""}`,
  ],
  parse(html) {
    const $ = cheerio.load(html);
    const out: Listing[] = [];
    $(".property-media[data-uid]").each((_, el) => {
      const id = $(el).attr("data-uid")!;
      const info = $(el).nextAll(".property-info-content").first();
      const a = info.find("a.property-info");
      // Direct link is embedded in the tracking redirect's `l=` parameter.
      const tracked = a.attr("href") ?? "";
      const url = new URL(tracked, "https://casa.sapo.pt").searchParams.get("l")?.split("?")[0] ?? tracked;
      const type = info.find(".property-type").text().trim();
      const features = info.find(".property-features-text").text().replace(/ /g, " ");
      const area = num(features.match(/([\d.,]+)\s*m²/)?.[1] ?? "");
      const price = num(info.find(".property-price-value").first().text());
      if (!price || !area || !isSane(price, area)) return;
      const [freguesia, concelho, distritoRaw] = info.find(".property-location").text().split(",").map((s) => s.trim());
      if (!concelho) return;
      out.push({
        portal: "casasapo",
        portalId: id,
        url,
        title: type,
        price,
        areaM2: area,
        typology: parseTypology(type),
        condition: CONDITION.find(([re]) => re.test(features))?.[1] ?? null,
        distrito: (distritoRaw ?? concelho).replace(/^Distrito de\s+/i, ""),
        concelho,
        freguesia: freguesia || null,
        imageUrl: $(el).find("picture img").first().attr("src") ?? null,
      });
    });
    return out;
  },
};
