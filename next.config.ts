import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // apify-client does dynamic requires that Turbopack can't statically analyze.
  // Marking it as external tells Next to let Node resolve it at runtime.
  serverExternalPackages: ["apify-client"],
};

export default nextConfig;
