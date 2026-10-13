import type { NextConfig } from "next";
const config: NextConfig = {
  reactStrictMode: true,
  images: { remotePatterns: [{ protocol: "https", hostname: "img.logo.dev" }] },
};
export default config;
