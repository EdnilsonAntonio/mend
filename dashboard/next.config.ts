import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // `pg` uses dynamic requires and native optional deps; keep it out of the bundle.
  serverExternalPackages: ['pg'],
};

export default nextConfig;
