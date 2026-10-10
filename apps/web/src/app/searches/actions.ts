"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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

const idOf = (f: FormData) => {
  const v = String(f.get("id") ?? "");
  return /^\d+$/.test(v) ? Number(v) : null;
};

export async function saveSearch(form: FormData) {
  const id = idOf(form);
  const name = String(form.get("name") ?? "").trim() || "Untitled search";
  const concelho = String(form.get("concelho") ?? "").trim();
  const distrito = String(form.get("distrito") ?? "").trim();
  if (!concelho && !distrito) redirect(id ? `/searches/${id}?error=location` : "/searches/new?error=location");
  const filters = {
    locations: [{ distrito: distrito || undefined, concelho: concelho || undefined }],
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
