import type { NextConfig } from 'next';

function readAllowedDevOriginsFromEnv(): string[] {
  const raw = process.env.NEXT_ALLOWED_DEV_ORIGINS;
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

const nextConfig: NextConfig = {
  // Next.js only applies this in `next dev` for HMR/internal dev resources.
  allowedDevOrigins: readAllowedDevOriginsFromEnv(),
  serverExternalPackages: ['@silvia-odwyer/photon-node'],
};

export default nextConfig;
