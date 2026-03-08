import type { NextConfig } from 'next';

type ImageRemotePattern = {
  protocol: 'http' | 'https';
  hostname: string;
  port?: string;
  pathname: string;
};

const defaultImageRemotePatterns: ImageRemotePattern[] = [
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
  serverExternalPackages: ['@langfuse/openai', 'langfuse', 'langsmith', '@silvia-odwyer/photon-node'],
  images: {
    dangerouslyAllowLocalIP: true,
    remotePatterns: resolveImageRemotePatterns(),
  },
};

export default nextConfig;
