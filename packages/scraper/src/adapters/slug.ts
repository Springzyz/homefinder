import { normalizeName } from "@homefinder/core";
export const slug = (s: string) => normalizeName(s).replace(/ /g, "-");
