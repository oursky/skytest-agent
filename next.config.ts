import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@langfuse/openai', 'langfuse', 'langsmith', '@silvia-odwyer/photon-node'],
};

export default nextConfig;
