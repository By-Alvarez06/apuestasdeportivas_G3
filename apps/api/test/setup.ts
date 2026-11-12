import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import type { PrismaClient } from '../src/generated/prisma/client';
import { createPrismaClient } from '../src/prisma/prisma.service';
import { ensureSystemAccounts } from '../src/wallet/system-accounts';

export function createTestPrisma(): PrismaClient {
  return createPrismaClient(process.env.DATABASE_URL as string);
}

/**
 * Vacía todas las tablas y recrea las cuentas del sistema.
 * TRUNCATE no dispara los triggers por fila de inmutabilidad, por eso sirve para limpiar entre pruebas.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) {
    const list = tables.map(({ tablename }) => `"${tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  }
  await ensureSystemAccounts(prisma);
}

/** Levanta la app de Nest completa contra apuestas_test, con la misma configuración que main.ts. */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}
