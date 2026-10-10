import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const [s] = await q("select telegram_chat_id, notify_email from settings where id=1");
  const runs = await q("select distinct on (portal) portal, started_at, ok, listings_found, error from scrape_runs order by portal, started_at desc");
  const [{ n }] = await q("select count(*)::int n from listings where active");
  const Row = ({ k, v, ok }: { k: string; v: string; ok: boolean }) => (
    <div className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
      <span className="text-muted">{k}</span><span className={ok ? "" : "text-[var(--above)]"}>{ok ? "✓ " : "✗ "}{v}</span>
    </div>
  );
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-xl font-semibold">Settings & health</h1>
      <section className="rounded-xl border border-line bg-card px-4 py-2">
        <Row k="Telegram" v={s?.telegram_chat_id ? "linked" : "not linked (run link-telegram)"} ok={!!s?.telegram_chat_id} />
        <Row k="Email" v={s?.notify_email ?? "not set (run set-email)"} ok={!!s?.notify_email} />
        <Row k="Active listings tracked" v={String(n)} ok />
      </section>
      <section>
        <h2 className="mb-2 font-medium">Last scrape per portal</h2>
        <div className="rounded-xl border border-line bg-card px-4 py-2">
          {runs.length === 0 && <p className="py-2 text-sm text-muted">No runs yet.</p>}
          {runs.map((r) => (
            <Row key={r.portal} k={r.portal} ok={r.ok} v={`${new Date(r.started_at).toLocaleString("pt-PT")} · ${r.ok ? `${r.listings_found} listings` : r.error}`} />
          ))}
        </div>
      </section>
    </div>
  );
}
