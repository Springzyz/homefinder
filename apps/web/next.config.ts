import type { NextConfig } from "next";

// Share the repo-root .env (local dev). On Vercel the variables come from project settings.
try { process.loadEnvFile("../../.env"); } catch {}

const config: NextConfig = {
  transpilePackages: ["@homefinder/core"],
  images: { unoptimized: true },
};
export default config;
