import Link from "next/link";
import { matchesSearch, atLeast, type Label, type Listing, type SearchFilters } from "@homefinder/core";
import { LabelPill, LABELS, eur } from "@/components/Label";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

const ORDER: Label[] = ["steal", "great", "good", "fair", "above"];

export default async function Deals({ searchParams }: { searchParams: Promise<{ min?: string; sort?: string; search?: string }> }) {
  const sp = await searchParams;
  const sort = sp.sort === "discount" ? "discount" : "new";
  const min = ORDER.includes(sp.min as Label) ? (sp.min as Label) : undefined;
  const searches = await q("select id, name, filters from searches order by id");
  const active = searches.find((s) => String(s.id) === sp.search);

  const rows = await q(
    `select * from (
       select distinct on (l.dedupe_key) l.*, s.label, s.discount_pct, s.benchmark_ppsqm, s.low_confidence,
         (select array_agg(t.portal || '|' || t.url) from listings t where t.dedupe_key = l.dedupe_key and t.active) as links
       from listings l left join listing_scores s on s.listing_id = l.id
       where l.active order by l.dedupe_key, l.first_seen_at
     ) d
     order by ${sort === "discount" ? "discount_pct desc nulls last" : "first_seen_at desc"} limit 600`,
  );
  const items = rows
    .filter((r) => !min || atLeast(r.label, min))
    .filter((r) => {
      if (!active) return true;
      const l: Listing = { portal: r.portal, portalId: r.portal_id, url: r.url, title: r.title, price: Number(r.price), areaM2: Number(r.area_m2), typology: r.typology, condition: r.condition, distrito: r.distrito, concelho: r.concelho, freguesia: r.freguesia };
      return matchesSearch(l, active.filters as SearchFilters);
    })
    .slice(0, 60);

  const href = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][]);
    return `/?${p}`;
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
        <Link href={href({ min: undefined })} className={`btn-ghost ${!min ? "bg-card" : ""}`}>All</Link>
        {ORDER.slice(0, 3).map((l) => (
          <Link key={l} href={href({ min: l })} className={`btn-ghost ${min === l ? "bg-card" : ""}`}>{LABELS[l].text}+</Link>
        ))}
        <span className="mx-2 text-muted">|</span>
        <Link href={href({ sort: undefined })} className={`btn-ghost ${sort === "new" ? "bg-card" : ""}`}>Newest</Link>
        <Link href={href({ sort: "discount" })} className={`btn-ghost ${sort === "discount" ? "bg-card" : ""}`}>Best discount</Link>
        {searches.length > 0 && (
          <>
            <span className="mx-2 text-muted">|</span>
            <Link href={href({ search: undefined })} className={`btn-ghost ${!active ? "bg-card" : ""}`}>Any search</Link>
            {searches.map((s) => (
              <Link key={s.id} href={href({ search: String(s.id) })} className={`btn-ghost ${active?.id === s.id ? "bg-card" : ""}`}>{s.name}</Link>
            ))}
          </>
        )}
      </div>
      {items.length === 0 ? (
        <p className="rounded-xl border border-line bg-card p-8 text-center text-muted">
          No listings yet. Create a <Link href="/searches/new" className="text-accent underline">search</Link> and let the poller run.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((r) => (
            <Link key={r.id} href={`/listing/${r.id}`} className="overflow-hidden rounded-xl border border-line bg-card hover:border-accent">
              {r.image_url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={r.image_url} alt="" loading="lazy" className="h-44 w-full object-cover" />}
              <div className="space-y-1.5 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-lg font-semibold">{eur(r.price)}</span>
                  <LabelPill label={r.label} />
                </div>
                <p className="line-clamp-1 text-sm">{r.title}</p>
                <p className="text-sm text-muted">
                  {r.typology ?? "?"} · {Number(r.area_m2)} m² · {eur(r.price_per_m2)}/m² · {[r.freguesia, r.concelho].filter(Boolean).join(", ")}
                </p>
                {r.discount_pct != null && (
                  <p className="text-xs text-muted">
                    {Math.round(Number(r.discount_pct) * 100)}% vs market median {eur(r.benchmark_ppsqm)}/m²{r.low_confidence ? " (low confidence)" : ""}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
