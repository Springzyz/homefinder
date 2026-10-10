"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { resolvePlace } from "@homefinder/core";
import { q } from "@/lib/db";

const TYPOLOGIES = ["T0", "T1", "T2", "T3", "T4", "T5+"];
const CONDITIONS = ["new", "used", "renovate"];
const LABELS = ["steal", "great", "good", "fair", "above"];
const CHANNELS = ["email", "telegram"];

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/\s/g, ""));
  return v && Number.isFinite(n) && n > 0 ? n : undefined;
};
const pick = (f: FormData, key: string, allowed: string[]) => f.getAll(key).map(String).filter((x) => allowed.includes(x));

/** Picked places ("distrito|concelho"), plus whatever was typed but not clicked, if it names a real place. */
function readLocations(form: FormData) {
  const seen = new Set<string>();
  const out: { distrito: string; concelho?: string }[] = [];
  const add = (p?: { distrito: string; concelho?: string }) => {
    if (!p) return;
    const k = `${p.distrito}|${p.concelho ?? ""}`;
    if (!seen.has(k)) { seen.add(k); out.push({ distrito: p.distrito, ...(p.concelho ? { concelho: p.concelho } : {}) }); }
  };
  for (const v of form.getAll("loc").map(String)) {
    const [d = "", c = ""] = v.split("|");
    const hit = resolvePlace(c || d, c ? d : undefined);
    // Never alter a stored place just because the lookup list doesn't know it.
    add({ distrito: hit?.distrito ?? d, concelho: c ? (hit?.concelho ?? c) : undefined });
  }
  const typed = String(form.get("locText") ?? "").trim();
  if (typed) { const hit = resolvePlace(typed); add(hit && { distrito: hit.distrito, concelho: hit.concelho }); }
  return out;
}

const idOf = (f: FormData) => {
  const v = String(f.get("id") ?? "");
  return /^\d+$/.test(v) ? Number(v) : null;
};

export async function saveSearch(form: FormData) {
  const id = idOf(form);
  const name = String(form.get("name") ?? "").trim() || "Untitled search";
  const locations = readLocations(form);
  if (!locations.length) redirect(id ? `/searches/${id}?error=location` : "/searches/new?error=location");
  const filters = {
    locations,
    priceMin: num(form.get("priceMin")), priceMax: num(form.get("priceMax")),
    ppsqmMax: num(form.get("ppsqmMax")), areaMin: num(form.get("areaMin")),
    typologies: pick(form, "typologies", TYPOLOGIES), conditions: pick(form, "conditions", CONDITIONS),
  };
  const minLabel = LABELS.includes(String(form.get("minLabel"))) ? String(form.get("minLabel")) : "good";
  const channels = pick(form, "channels", CHANNELS);
  const active = form.get("active") === "on";
  if (id) await q("update searches set name=$2, filters=$3, min_label=$4, channels=$5, active=$6 where id=$1", [id, name, JSON.stringify(filters), minLabel, channels, active]);
  else await q("insert into searches(name, filters, min_label, channels, active) values ($1,$2,$3,$4,$5)", [name, JSON.stringify(filters), minLabel, channels, active]);
  revalidatePath("/searches");
  redirect("/searches");
}

export async function deleteSearch(form: FormData) {
  await q("delete from searches where id=$1", [idOf(form)]);
  revalidatePath("/searches");
  redirect("/searches");
}

export async function toggleSearch(form: FormData) {
  await q("update searches set active = not active where id=$1", [idOf(form)]);
  revalidatePath("/searches");
}
