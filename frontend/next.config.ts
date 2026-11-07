import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: __dirname,
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
