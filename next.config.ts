import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Files are written to ./data at runtime, so keep them out of the build trace.
  outputFileTracingExcludes: { "*": ["./data/**"] },
};

export default nextConfig;
