import Link from "next/link";
import { notFound } from "next/navigation";
import { LabelPill, eur } from "@/components/Label";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [l] = await q("select l.*, s.label, s.discount_pct, s.benchmark_ppsqm, s.benchmark_level, s.low_confidence from listings l left join listing_scores s on s.listing_id=l.id where l.id=$1", [id]);
  if (!l) notFound();
  const [history, twins] = await Promise.all([
    q("select price, seen_at from price_history where listing_id=$1 order by seen_at", [id]),
    q("select portal, url from listings where dedupe_key=$1 and active", [l.dedupe_key]),
  ]);
  return (
    <article className="mx-auto max-w-2xl space-y-5">
      <Link href="/" className="text-sm text-muted hover:text-fg">← Deals</Link>
      {l.image_url?.startsWith("http") && /* eslint-disable-next-line @next/next/no-img-element */ <img src={l.image_url} alt="" className="w-full rounded-xl" />}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{eur(l.price)}</h1>
          <p className="text-muted">{l.title}</p>
        </div>
        <LabelPill label={l.label} />
      </div>
      <dl className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-card p-4 text-sm sm:grid-cols-4">
        {[["Typology", l.typology ?? "?"], ["Area", `${Number(l.area_m2)} m²`], ["€/m²", eur(l.price_per_m2)], ["Condition", l.condition ?? "unknown"]].map(([k, v]) => (
          <div key={k}><dt className="text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>
        ))}
      </dl>
      <p className="text-sm">{[l.freguesia, l.concelho, l.distrito].filter(Boolean).join(" · ")}</p>
      {l.benchmark_ppsqm && (
        <p className="rounded-xl border border-line bg-card p-4 text-sm">
          Market median for this typology in <b>{l.benchmark_level}</b> level: <b>{eur(l.benchmark_ppsqm)}/m²</b>. This listing is{" "}
          <b>{Math.abs(Math.round(Number(l.discount_pct) * 100))}% {Number(l.discount_pct) >= 0 ? "below" : "above"}</b> it.
          {l.low_confidence && <span className="text-muted"> Benchmark has low confidence (coarse area or few samples).</span>}
        </p>
      )}
      <section>
        <h2 className="mb-2 font-medium">Price history</h2>
        <ul className="space-y-1 text-sm">
          {history.map((h, i) => (
            <li key={i} className="flex justify-between border-b border-line py-1"><span className="text-muted">{new Date(h.seen_at).toLocaleString("pt-PT")}</span><span>{eur(h.price)}</span></li>
          ))}
        </ul>
      </section>
      <section className="flex flex-wrap gap-2">
        {twins.map((t) => (
          <a key={t.url} href={t.url} target="_blank" rel="noreferrer noopener" className="btn">Open on {t.portal}</a>
        ))}
      </section>
    </article>
  );
}
