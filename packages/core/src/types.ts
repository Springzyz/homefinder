export type Portal = "idealista" | "imovirtual" | "olx" | "casasapo" | "supercasa";
export type Condition = "new" | "used" | "renovate";
export type Typology = "T0" | "T1" | "T2" | "T3" | "T4" | "T5+";
export type Channel = "email" | "telegram";

export interface Listing {
  portal: Portal;
  portalId: string;
  url: string;
  title: string;
  price: number;
  areaM2: number;
  typology: Typology | null;
  condition: Condition | null;
  distrito: string;
  concelho: string;
  freguesia: string | null;
  imageUrl?: string | null;
}

export type Label = "steal" | "great" | "good" | "fair" | "above";

export interface MarketStat {
  level: "freguesia" | "concelho" | "distrito";
  key: string; // normalised area name
  typology: Typology;
  condition: Condition | "any";
  medianPpsqm: number;
  n: number;
}

export interface Score {
  benchmarkLevel: MarketStat["level"] | "none";
  benchmarkPpsqm: number | null;
  discountPct: number | null;
  label: Label | null;
  lowConfidence: boolean;
}

export interface SearchFilters {
  locations: { distrito?: string; concelho?: string; freguesia?: string }[];
  priceMin?: number;
  priceMax?: number;
  ppsqmMax?: number;
  areaMin?: number;
  typologies?: Typology[];
  conditions?: Condition[];
}
