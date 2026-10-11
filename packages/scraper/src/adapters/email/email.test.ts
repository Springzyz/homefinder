import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEmail } from "./index";
import { parseImovirtualEmail } from "./imovirtual";
import { parseSupercasaEmail } from "./supercasa";
import { parseIdealistaEmail } from "./idealista";

const fx = (n: string) => readFileSync(new URL(`../../../fixtures/email/${n}`, import.meta.url), "utf8");
const mail = (html: string | null, subject = "Novos imóveis") => ({ subject, html, text: null });
const imo = (body: string) => `<html><body>${body}</body></html>`;
const card = (href: string, text: string) => `<div><a href="${href}">Título</a><p>${text}</p></div>`;
const IMO = "https://www.imovirtual.com/pt/anuncio/x-ID1";

describe("synthetic Imovirtual alert", () => {
  const out = parseImovirtualEmail(mail(fx("imovirtual-two-listings.html")));
  it("emits one candidate per listing with grounded fields", () => {
    expect(out.kind).toBe("listings");
    if (out.kind !== "listings") return;
    expect(out.listings).toHaveLength(2);
    expect(out.rejected).toEqual([]);
    const [a, b] = out.listings;
    expect(a).toMatchObject({ portal: "imovirtual", portalId: "4abc1", price: 250000, areaM2: 85, typology: "T2", condition: "new", concelho: "Lisboa", distrito: "Lisboa", freguesia: null, imageUrl: null });
    expect(b).toMatchObject({ portalId: "4abc2", price: 1250000, areaM2: 210.5, typology: "T3", concelho: "Oeiras", distrito: "Lisboa" });
  });
  it("only emits canonical https URLs on the expected host, without query strings", () => {
    if (out.kind !== "listings") throw new Error("expected listings");
    for (const l of out.listings) {
      const u = new URL(l.url);
      expect(u.protocol).toBe("https:");
      expect(["www.imovirtual.com", "imovirtual.com"]).toContain(u.hostname);
      expect(u.search).toBe("");
    }
  });
  it("is detected as Imovirtual from its links, not from hints", () => {
    expect(parseEmail(mail(fx("imovirtual-two-listings.html"))).portal).toBe("imovirtual");
  });
});

describe("synthetic Supercasa alert", () => {
  it("parses Portuguese formats (129.500 €, 62,5 m²) and the place", () => {
    const out = parseSupercasaEmail(mail(fx("supercasa-one-listing.html")));
    expect(out).toMatchObject({ kind: "listings", rejected: [] });
    if (out.kind !== "listings") return;
    expect(out.listings).toHaveLength(1);
    expect(out.listings[0]).toMatchObject({ portal: "supercasa", portalId: "1234567", price: 129500, areaM2: 62.5, typology: "T1", concelho: "Santarém", distrito: "Santarém" });
  });
});

describe("rejection: nothing is guessed or invented", () => {
  const rejectedCodes = (html: string) => {
    const o = parseImovirtualEmail(mail(imo(html)));
    if (o.kind !== "listings") throw new Error("expected listings outcome, got " + o.kind);
    return { codes: o.rejected.map((r) => r.code), listings: o.listings };
  };
  it("two different prices -> ambiguous_price, no listing", () => {
    expect(rejectedCodes(card(IMO, "300.000 € agora 280.000 € · 85 m² · Lisboa"))).toEqual({ codes: ["ambiguous_price"], listings: [] });
  });
  it("no area -> missing_area (never derived from anything else)", () => {
    expect(rejectedCodes(card(IMO, "250.000 € · T2 · Lisboa"))).toEqual({ codes: ["missing_area"], listings: [] });
  });
  it("two areas without an explicit 'útil' label -> ambiguous_area", () => {
    expect(rejectedCodes(card(IMO, "250.000 € · 85 m² · 100 m² · Lisboa")).codes).toEqual(["ambiguous_area"]);
  });
  it("implausible price/area -> implausible_values", () => {
    expect(rejectedCodes(card(IMO, "5 000 € · 85 m² · Lisboa")).codes).toEqual(["implausible_values"]);
  });
  it("unknown place -> location_unresolved", () => {
    expect(rejectedCodes(card(IMO, "250.000 € · 85 m² · Atlantida")).codes).toEqual(["location_unresolved"]);
  });
  it("valid and invalid candidates in one email are reported separately", () => {
    const r = rejectedCodes(card(IMO, "250.000 € · 85 m² · Lisboa") + card("https://www.imovirtual.com/pt/anuncio/y-ID2", "250.000 € · Lisboa"));
    expect(r.listings).toHaveLength(1);
    expect(r.codes).toEqual(["missing_area"]);
  });
});

describe("untrusted links", () => {
  const body = "250.000 € · 85 m² · Lisboa";
  it.each([
    ["http (not https)", "http://www.imovirtual.com/pt/anuncio/x-ID1"],
    ["lookalike host", "https://www.imovirtual.com.evil.example/pt/anuncio/x-ID1"],
    ["other portal host", "https://example.com/pt/anuncio/x-ID1"],
    ["embedded credentials", "https://user:pw@www.imovirtual.com/pt/anuncio/x-ID1"],
    ["custom port", "https://www.imovirtual.com:8443/pt/anuncio/x-ID1"],
    ["javascript:", "javascript:alert(1)"],
    ["non-listing path", "https://www.imovirtual.com/pt/ajuda"],
  ])("ignores %s", (_n, href) => {
    expect(parseImovirtualEmail(mail(imo(card(href, body))))).toEqual({ kind: "unsupported", reason: "no_listing_links" });
  });
  it("never reads script content as data", () => {
    const o = parseImovirtualEmail(mail(imo(`<script>var x="250.000 € 85 m² Lisboa"</script>` + card(IMO, "Lisboa"))));
    expect(o.kind).toBe("unsupported");
  });
});

describe("non-listing mail is explicit", () => {
  it("a confirmation email is deliberately ignored, with a reason", () => {
    const html = imo(`<a href="https://www.imovirtual.com/pt/anuncio/x-ID1">Confirmar</a>`);
    expect(parseImovirtualEmail(mail(html, "Confirme o seu alerta"))).toEqual({ kind: "ignored", reason: "non_listing_subject" });
  });
  it("the same shape with an ordinary subject is quarantined, not silently accepted", () => {
    const html = imo(`<a href="https://www.imovirtual.com/pt/anuncio/x-ID1">Ver</a>`);
    expect(parseImovirtualEmail(mail(html, "Novos imóveis"))).toEqual({ kind: "unsupported", reason: "no_priced_listing_blocks" });
  });
  it("no HTML body is unsupported; an email linking to both portals is not guessed", () => {
    expect(parseEmail({ subject: "x", html: null, text: "250.000 €" }).outcome).toEqual({ kind: "unsupported", reason: "no_html_body" });
    const both = imo(`<a href="${IMO}">a</a><a href="https://supercasa.pt/comprar-casas/x/1234567">b</a>`);
    expect(parseEmail(mail(both)).outcome).toEqual({ kind: "unsupported", reason: "portal_not_identified" });
  });
});

describe("location resolution", () => {
  const one = (text: string) => {
    const o = parseImovirtualEmail(mail(imo(card(IMO, text))));
    if (o.kind !== "listings") throw new Error(o.kind);
    return o;
  };
  it("keeps neighbouring fields separate and ignores a district name next to its concelho", () => {
    const o = one("<span>1.250.000 €</span><span>210 m²</span><span>Oeiras</span><span>Lisboa</span>");
    expect(o.listings[0]).toMatchObject({ concelho: "Oeiras", distrito: "Lisboa" });
  });
  it("two different concelhos in one listing is ambiguous, not guessed", () => {
    const o = one("<span>250.000 €</span><span>85 m²</span><span>Porto</span><span>Braga</span>");
    expect(o.listings).toEqual([]);
    expect(o.rejected.map((r) => r.code)).toEqual(["location_unresolved"]);
  });
  it("resolves 'em <place>' from a title without accents typed", () => {
    expect(one("<span>Apartamento T2 em Setubal</span><span>250.000 €</span><span>85 m²</span>").listings[0]).toMatchObject({ concelho: "Setúbal" });
  });
});

describe("Idealista daily summary (structure taken from one real mail, values invented)", () => {
  const out = parseIdealistaEmail(mail(fx("idealista-daily-summary.html"), "Resumo diário de novos imóveis"));
  it("ingests only Novidade cards, with the asking price (not €/m²) and the card's own area", () => {
    expect(out.kind).toBe("listings");
    if (out.kind !== "listings") return;
    expect(out.listings).toHaveLength(2);
    expect(out.listings[0]).toMatchObject({ portal: "idealista", portalId: "90000001", url: "https://www.idealista.pt/imovel/90000001", price: 150000, areaM2: 100, typology: "T3", concelho: "Santarém", distrito: "Santarém" });
  });
  it("resolves a bare freguesia (Beato) to its concelho; skips Recomendação silently", () => {
    if (out.kind !== "listings") throw new Error("expected listings");
    expect(out.rejected).toEqual([]);
    expect(out.listings.map((l) => l.portalId)).toEqual(["90000001", "90000002"]);
    expect(out.listings[1]).toMatchObject({ price: 150000, areaM2: 25, typology: "T1", concelho: "Lisboa", distrito: "Lisboa" });
  });
  it("is detected as Idealista from its links", () => {
    expect(parseEmail(mail(fx("idealista-daily-summary.html"))).portal).toBe("idealista");
  });
  it("a summary with only recommendations yields zero listings, not a quarantine", () => {
    const html = fx("idealista-daily-summary.html").replace(/<div>Novidade<\/div>/g, "<div>Recomendação</div>");
    expect(parseIdealistaEmail(mail(html))).toEqual({ kind: "listings", listings: [], rejected: [] });
  });
});

describe("freguesia fallback for places", () => {
  const place = (zone: string) => {
    const o = parseImovirtualEmail(mail(imo(card(IMO, `<span>250.000 €</span><span>85 m²</span><span>${zone}</span>`))));
    if (o.kind !== "listings") throw new Error(o.kind);
    return o.listings[0] ? o.listings[0].concelho : o.rejected[0]!.code;
  };
  it("resolves unique freguesias nationwide, accent-insensitive", () => {
    expect(place("Marvila")).toBe("Lisboa");
    expect(place("Rua Exemplo, 5, belem")).toBe("Lisboa");
  });
  it("a freguesia name shared by several concelhos is not guessed", () => {
    expect(place("Rua Exemplo, Santa Maria Maior")).toBe("location_unresolved");
  });
  it("an earlier component can disambiguate a shared name", () => {
    expect(place("Mouraria, Santa Maria Maior")).toBe("location_unresolved"); // Mouraria is not a freguesia: nothing narrows it
    expect(place("Misericórdia, Santa Maria Maior")).toBe("Lisboa"); // Misericórdia is a Lisboa freguesia
  });
});
