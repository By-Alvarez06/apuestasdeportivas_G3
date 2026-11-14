import type { NextConfig } from 'next';

// El .env vive en la raíz del monorepo (Next solo lee el de apps/web). En Vercel no existe y se usan sus variables.
try {
  process.loadEnvFile('../../.env');
} catch {
  // sin .env local
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@apuestas/shared'],
  // La web habla con la API por /api/* en su mismo dominio: las cookies de sesión quedan de primer
  // nivel (SameSite=Lax funciona aunque la API viva en otro dominio, p. ej. Render).
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL ?? 'http://localhost:3001'}/:path*`,
      },
    ];
  },
};

export default nextConfig;
