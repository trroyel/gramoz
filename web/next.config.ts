import type { NextConfig } from "next";
import { resolveBackendOrigin, resolveImageRemotePatterns } from "./src/lib/config";

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
    remotePatterns: resolveImageRemotePatterns(),
  },
  async rewrites() {
    const backendOrigin = resolveBackendOrigin();
    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin}/api/:path*`,
      },
      {
        source: "/public/:path*",
        destination: `${backendOrigin}/public/:path*`,
      },
    ];
  },
};

export default nextConfig;
