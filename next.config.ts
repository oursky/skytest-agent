import type { NextConfig } from 'next';

type ImageRemotePattern = {
  protocol: 'http' | 'https';
  hostname: string;
  port?: string;
  pathname: string;
};

const isDevelopment = process.env.NODE_ENV === 'development';

const localImageRemotePatterns: ImageRemotePattern[] = [
  {
    protocol: 'http',
    hostname: '127.0.0.1',
    port: '9000',
    pathname: '/**',
  },
  {
    protocol: 'http',
    hostname: 'localhost',
    port: '9000',
    pathname: '/**',
  },
];

function resolveImageRemotePatterns(): ImageRemotePattern[] {
  const defaultImageRemotePatterns = isDevelopment ? localImageRemotePatterns : [];
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint) {
    return defaultImageRemotePatterns;
  }

  try {
    const parsed = new URL(endpoint);
    const endpointPattern: ImageRemotePattern = {
      protocol: parsed.protocol === 'https:' ? 'https' : 'http',
      hostname: parsed.hostname,
      pathname: '/**',
    };

    if (parsed.port) {
      endpointPattern.port = parsed.port;
    }

    const alreadyIncluded = defaultImageRemotePatterns.some((pattern) =>
      pattern.protocol === endpointPattern.protocol
      && pattern.hostname === endpointPattern.hostname
      && pattern.port === endpointPattern.port,
    );

    if (alreadyIncluded) {
      return defaultImageRemotePatterns;
    }

    return [...defaultImageRemotePatterns, endpointPattern];
  } catch {
    return defaultImageRemotePatterns;
  }
}

const nextConfig: NextConfig = {
  serverExternalPackages: ['@silvia-odwyer/photon-node'],
  images: {
    dangerouslyAllowLocalIP: isDevelopment,
    remotePatterns: resolveImageRemotePatterns(),
  },
};

export default nextConfig;
