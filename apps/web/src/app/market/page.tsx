import { eur } from "@/components/Label";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Market({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const typ = ["T0", "T1", "T2", "T3", "T4", "T5+"].includes((await searchParams).t ?? "") ? (await searchParams).t! : "T2";
  const rows = await q("select key, level, median_ppsqm, n from market_stats where typology=$1 and condition='any' order by level, median_ppsqm desc", [typ]);
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Market medians (€/m²)</h1>
        <div className="flex gap-1">
          {["T0", "T1", "T2", "T3", "T4", "T5+"].map((t) => (
            <a key={t} href={`/market?t=${encodeURIComponent(t)}`} className={`btn-ghost ${t === typ ? "bg-card" : ""}`}>{t}</a>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-card p-8 text-center text-muted">
          No benchmarks yet. A benchmark needs at least 15 listings of the same typology in an area. Run a backfill (workflow input pages=5).
        </p>
      ) : (
        <table className="w-full overflow-hidden rounded-xl border border-line bg-card text-sm">
          <thead className="text-left text-muted"><tr><th className="p-3">Area</th><th>Level</th><th className="text-right">Median</th><th className="p-3 text-right">Samples</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.level + r.key} className="border-t border-line"><td className="p-3 capitalize">{r.key}</td><td className="text-muted">{r.level}</td><td className="text-right font-medium">{eur(r.median_ppsqm)}</td><td className="p-3 text-right text-muted">{r.n}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
