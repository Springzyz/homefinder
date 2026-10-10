import type { Label } from "@homefinder/core";

export const LABELS: Record<Label, { text: string; color: string }> = {
  steal: { text: "🔥 Steal", color: "var(--steal)" },
  great: { text: "⭐ Great deal", color: "var(--great)" },
  good: { text: "👍 Good deal", color: "var(--good)" },
  fair: { text: "Fair price", color: "var(--fair)" },
  above: { text: "Above market", color: "var(--above)" },
};

export function LabelPill({ label }: { label: Label | null }) {
  const l = label ? LABELS[label] : { text: "Not rated", color: "var(--muted)" };
  return (
    <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium" style={{ color: l.color, borderColor: l.color }}>
      {l.text}
    </span>
  );
}

export const eur = (n: number | string) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n));
