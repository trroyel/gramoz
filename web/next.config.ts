import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:5000/api/:path*",
      },
      {
        source: "/public/:path*",
        destination: "http://localhost:5000/public/:path*",
      },
    ];
  },
};

export default nextConfig;
