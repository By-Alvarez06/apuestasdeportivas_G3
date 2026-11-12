import { defineConfig } from 'prisma/config';

// Prisma 7 ya no lee .env solo; el .env vive en la raíz del monorepo y es opcional (CI usa variables).
try {
  process.loadEnvFile('../../.env');
} catch {
  // sin .env: se usan las variables del entorno
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // `prisma generate` no necesita base de datos, así que no se exige la variable aquí.
    url: process.env.DATABASE_URL ?? '',
  },
});
