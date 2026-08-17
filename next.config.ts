import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/n8n-handbook", destination: "/n8n-handbook/index.html" },
      { source: "/n8n-handbook/", destination: "/n8n-handbook/index.html" },
    ];
  },
};

export default nextConfig;
