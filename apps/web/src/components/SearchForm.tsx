import type { SearchFilters } from "@homefinder/core";
import { LABELS } from "./Label";
import { saveSearch } from "@/app/searches/actions";

const DISTRITOS = ["Aveiro", "Beja", "Braga", "Bragança", "Castelo Branco", "Coimbra", "Évora", "Faro", "Guarda", "Leiria", "Lisboa", "Portalegre", "Porto", "Santarém", "Setúbal", "Viana do Castelo", "Vila Real", "Viseu", "Açores", "Madeira"];
const TYPES = ["T0", "T1", "T2", "T3", "T4", "T5+"];
const CONDS: [string, string][] = [["new", "New"], ["used", "Used / renovated"], ["renovate", "To renovate"]];

export interface SearchRow { id: number; name: string; filters: SearchFilters; min_label: string; channels: string[]; active: boolean }

export function SearchForm({ search, error }: { search?: SearchRow; error?: boolean }) {
  const f = search?.filters;
  const loc = f?.locations[0];
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label className="block space-y-1 text-sm"><span className="text-muted">{label}</span>{children}</label>
  );
  const Checks = ({ name, items, on }: { name: string; items: [string, string][]; on: string[] }) => (
    <div className="flex flex-wrap gap-3">
      {items.map(([v, t]) => (
        <label key={v} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name={name} value={v} defaultChecked={on.includes(v)} />{t}</label>
      ))}
    </div>
  );
  return (
    <form action={saveSearch} className="max-w-2xl space-y-5 rounded-xl border border-line bg-card p-5">
      {search && <input type="hidden" name="id" value={search.id} />}
      <Field label="Name"><input name="name" defaultValue={search?.name} placeholder="e.g. Lisboa T2 under 350k" className="input" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Distrito">
          <select name="distrito" defaultValue={loc?.distrito ?? ""} className="input">
            <option value="">Any</option>
            {DISTRITOS.map((d) => <option key={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Concelho (municipality)"><input name="concelho" defaultValue={loc?.concelho} placeholder="e.g. Lisboa, Oeiras, Santarém" className="input" /></Field>
      </div>
      {error && <p className="text-sm text-[var(--above)]">Pick at least a distrito or a concelho.</p>}
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Min price (€)"><input name="priceMin" inputMode="numeric" defaultValue={f?.priceMin} className="input" /></Field>
        <Field label="Max price (€)"><input name="priceMax" inputMode="numeric" defaultValue={f?.priceMax} className="input" /></Field>
        <Field label="Max €/m²"><input name="ppsqmMax" inputMode="numeric" defaultValue={f?.ppsqmMax} className="input" /></Field>
        <Field label="Min area (m²)"><input name="areaMin" inputMode="numeric" defaultValue={f?.areaMin} className="input" /></Field>
      </div>
      <Field label="Typology"><Checks name="typologies" items={TYPES.map((t) => [t, t])} on={f?.typologies ?? []} /></Field>
      <Field label="Condition"><Checks name="conditions" items={CONDS} on={f?.conditions ?? []} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Only alert when at least">
          <select name="minLabel" defaultValue={search?.min_label ?? "good"} className="input">
            {Object.entries(LABELS).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
          </select>
        </Field>
        <Field label="Notify via"><Checks name="channels" items={[["telegram", "Telegram"], ["email", "Email"]]} on={search?.channels ?? ["telegram", "email"]} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={search?.active ?? true} />Active</label>
      <button className="btn">{search ? "Save changes" : "Create search"}</button>
    </form>
  );
}
