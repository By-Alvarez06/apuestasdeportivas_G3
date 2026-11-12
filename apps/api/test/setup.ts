import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
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

/**
 * Levanta la app de Nest completa contra apuestas_test, con la misma configuración que main.ts.
 * `controllers` permite montar controladores de prueba detrás de los guards globales.
 */
export async function createTestApp(
  options: { controllers?: Type[] } = {},
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}

/** Origen que acepta el chequeo CSRF; las pruebas lo envían como haría el navegador. */
export const WEB_ORIGIN = process.env.WEB_URL ?? 'http://localhost:3000';
