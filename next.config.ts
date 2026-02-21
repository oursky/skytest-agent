import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@langfuse/openai', 'langfuse', 'langsmith'],
};

export default nextConfig;
