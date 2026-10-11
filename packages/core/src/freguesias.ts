import { CONCELHOS } from "./locations";
import { FREGUESIAS_BY_CONCELHO } from "./freguesias.data";
import { normalizeName } from "./normalize";

export interface FreguesiaMatch { freguesia: string; concelho: string; distrito: string }

const DISTRITO_OF = new Map(CONCELHOS.map(([c, d]) => [c, d]));

/** Names a parish can be listed under: the full name, text before "(", and the parenthesised/"A, B e C" components. */
function aliases(name: string): string[] {
  const out = new Set<string>([name]);
  const paren = name.match(/^(.*?)\s*\((.+)\)\s*$/);
  if (paren) {
    out.add(paren[1]!.trim());
    for (const p of paren[2]!.split(/,\s*|\s+e\s+/)) out.add(p.trim());
  } else if (/,|\se\s/.test(name)) {
    for (const p of name.split(/,\s*|\s+e\s+/)) out.add(p.trim());
  }
  return [...out].filter((a) => normalizeName(a).length >= 3);
}

let index: Map<string, FreguesiaMatch[]> | undefined;
function build() {
  const m = new Map<string, FreguesiaMatch[]>();
  for (const [concelho, names] of Object.entries(FREGUESIAS_BY_CONCELHO)) {
    const distrito = DISTRITO_OF.get(concelho);
    if (!distrito) continue;
    for (const name of names) for (const a of aliases(name)) {
      const key = normalizeName(a);
      const list = m.get(key) ?? [];
      if (!list.some((x) => x.concelho === concelho)) list.push({ freguesia: a, concelho, distrito });
      m.set(key, list);
    }
  }
  return m;
}

/** Every concelho that has a freguesia with this name (accent/case-insensitive); empty when unknown. */
export function findFreguesia(text: string): FreguesiaMatch[] {
  index ??= build();
  return index.get(normalizeName(text)) ?? [];
}
