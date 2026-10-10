import type { Label, Listing, Score } from "@homefinder/core";

const LABEL_TEXT: Record<Label, string> = {
  steal: "🔥 Steal", great: "⭐ Great deal", good: "👍 Good deal", fair: "Fair price", above: "Above market",
};
const eur = (n: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export interface Alert { listing: Listing; score: Score; searchName: string; urls: string[]; priceDrop?: number }

function summary(a: Alert) {
  const { listing: l, score: s } = a;
  const label = s.label ? LABEL_TEXT[s.label] : "Not rated yet";
  const bench = s.benchmarkPpsqm
    ? `${Math.round((s.discountPct ?? 0) * 100)}% vs ${l.concelho} median ${eur(s.benchmarkPpsqm)}/m² (${s.benchmarkLevel}${s.lowConfidence ? ", low confidence" : ""})`
    : "no local benchmark yet";
  const head = a.priceDrop ? `Price drop (was ${eur(a.priceDrop)})` : "New listing";
  return { label, bench, head, ppsqm: eur(Math.round(l.price / l.areaM2)) };
}

export async function sendTelegram(token: string, chatId: string, a: Alert) {
  const { label, bench, head, ppsqm } = summary(a);
  const l = a.listing;
  const text = [
    `<b>${label}</b> · ${head}`,
    `${esc(l.title)}`,
    `${eur(l.price)} · ${l.areaM2} m² · ${ppsqm}/m² · ${l.typology ?? "?"}`,
    `${esc([l.freguesia, l.concelho].filter(Boolean).join(", "))}`,
    `<i>${esc(bench)}</i>`,
    `Search: ${esc(a.searchName)}`,
    ...a.urls.map((u) => `<a href="${esc(u)}">${new URL(u).host}</a>`),
  ].join("\n");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: false }),
  });
  if (!res.ok) throw new Error(`telegram ${res.status}: ${await res.text()}`);
}

export async function sendEmail(apiKey: string, from: string, to: string, a: Alert) {
  const { label, bench, head, ppsqm } = summary(a);
  const l = a.listing;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px">
    ${l.imageUrl ? `<img src="${esc(l.imageUrl)}" style="width:100%;border-radius:8px">` : ""}
    <h2 style="margin:12px 0 4px">${label} · ${head}</h2>
    <p style="margin:0 0 8px">${esc(l.title)}<br>${esc([l.freguesia, l.concelho].filter(Boolean).join(", "))}</p>
    <p style="font-size:18px;margin:0 0 8px"><b>${eur(l.price)}</b> · ${l.areaM2} m² · ${ppsqm}/m² · ${l.typology ?? "?"}</p>
    <p style="color:#555;margin:0 0 12px">${esc(bench)}</p>
    ${a.urls.map((u) => `<a href="${esc(u)}">Open on ${new URL(u).host}</a>`).join("<br>")}
    <p style="color:#999;font-size:12px">Search: ${esc(a.searchName)}</p></div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to, subject: `${label}: ${l.typology ?? ""} ${l.concelho} ${eur(l.price)} (${ppsqm}/m²)`, html }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
}
