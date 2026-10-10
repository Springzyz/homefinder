"use client";
import { useMemo, useState } from "react";
import { suggestPlaces, type Place } from "@homefinder/core";

interface Chosen { distrito: string; concelho?: string }
const key = (p: Chosen) => `${p.distrito}|${p.concelho ?? ""}`;

/** Type without accents ("santarem") and pick the properly spelled place. Several places allowed. */
export function LocationPicker({ initial }: { initial: Chosen[] }) {
  const [chosen, setChosen] = useState<Chosen[]>(initial);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const options = useMemo(() => suggestPlaces(text).filter((p) => !chosen.some((c) => key(c) === key(p))), [text, chosen]);

  const add = (p: Place) => {
    setChosen((c) => [...c, { distrito: p.distrito, concelho: p.concelho }]);
    setText("");
    setIdx(0);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {chosen.map((c) => (
          <span key={key(c)} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm">
            {c.concelho ? <>{c.concelho} <span className="text-muted">· {c.distrito}</span></> : <>Distrito de {c.distrito}</>}
            <button type="button" aria-label="Remove" onClick={() => setChosen((x) => x.filter((y) => key(y) !== key(c)))} className="text-muted hover:text-fg">×</button>
            <input type="hidden" name="loc" value={key(c)} />
          </span>
        ))}
      </div>
      <div className="relative">
        <input
          name="locText"
          value={text}
          autoComplete="off"
          placeholder="Type a city or district, e.g. santarem, setubal, lisboa…"
          className="input"
          onChange={(e) => { setText(e.target.value); setOpen(true); setIdx(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, options.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter" && open && options[idx]) { e.preventDefault(); add(options[idx]!); }
          }}
        />
        {open && options.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-card shadow-lg">
            {options.map((p, i) => (
              <li key={key(p)}>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); add(p); }} className={`flex w-full justify-between px-3 py-2 text-left text-sm ${i === idx ? "bg-bg" : ""}`}>
                  <span>{p.concelho ?? `Distrito de ${p.distrito}`}</span>
                  <span className="text-muted">{p.concelho ? p.distrito : "whole district"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
