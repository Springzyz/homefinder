import Link from "next/link";
import { LABELS, eur } from "@/components/Label";
import { q } from "@/lib/db";
import { deleteSearch, toggleSearch } from "./actions";

export const dynamic = "force-dynamic";

export default async function Searches() {
  const rows = await q("select * from searches order by id");
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Saved searches</h1>
        <Link href="/searches/new" className="btn">New search</Link>
      </div>
      <div className="space-y-3">
        {rows.length === 0 && <p className="rounded-xl border border-line bg-card p-8 text-center text-muted">No searches yet.</p>}
        {rows.map((s) => {
          const f = s.filters;
          const where = f.locations.map((l: any) => [l.concelho, l.distrito].filter(Boolean).join(", ")).join(" · ");
          const bits = [
            where,
            f.typologies?.length ? f.typologies.join("/") : "any typology",
            f.priceMax ? `≤ ${eur(f.priceMax)}` : null,
            f.ppsqmMax ? `≤ ${eur(f.ppsqmMax)}/m²` : null,
          ].filter(Boolean);
          return (
            <div key={s.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card p-4 ${s.active ? "" : "opacity-60"}`}>
              <div>
                <Link href={`/searches/${s.id}`} className="font-medium hover:text-accent">{s.name}</Link>
                <p className="text-sm text-muted">{bits.join(" · ")}</p>
                <p className="text-xs text-muted">Alerts: {LABELS[s.min_label as keyof typeof LABELS]?.text}+ via {s.channels.join(", ") || "none"}</p>
              </div>
              <div className="flex gap-2">
                <form action={toggleSearch}><input type="hidden" name="id" value={s.id} /><button className="btn-ghost">{s.active ? "Pause" : "Resume"}</button></form>
                <Link href={`/searches/${s.id}`} className="btn-ghost">Edit</Link>
                <form action={deleteSearch}><input type="hidden" name="id" value={s.id} /><button className="btn-ghost text-[var(--above)]">Delete</button></form>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
