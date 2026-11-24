import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg-boss", "postgres"],
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default nextConfig;
