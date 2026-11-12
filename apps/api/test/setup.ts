import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { BreachedPasswordChecker } from '../src/auth/breached-password.checker';
import { CaptchaService } from '../src/auth/captcha.service';
import { TokenService } from '../src/auth/token.service';
import type { PrismaClient } from '../src/generated/prisma/client';
import { Role, UserStatus } from '../src/generated/prisma/enums';
import { MailService } from '../src/mail/mail.service';
import { createPrismaClient } from '../src/prisma/prisma.service';
import { ensureSystemAccounts } from '../src/wallet/system-accounts';
import { newUserWallet } from '../src/wallet/user-wallet';
import { FakeBreachedPasswordChecker, FakeCaptchaService, FakeMailService } from './fakes';

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
 * Correo, CAPTCHA y consulta de contraseñas filtradas se reemplazan por dobles sin red.
 * `controllers` permite montar controladores de prueba detrás de los guards globales.
 */
export async function createTestApp(
  options: { controllers?: Type[] } = {},
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(MailService)
    .useValue(new FakeMailService())
    .overrideProvider(CaptchaService)
    .useValue(new FakeCaptchaService())
    .overrideProvider(BreachedPasswordChecker)
    .useValue(new FakeBreachedPasswordChecker())
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}

export function mailOf(app: NestExpressApplication): FakeMailService {
  return app.get(MailService) as unknown as FakeMailService;
}

/** Origen que acepta el chequeo CSRF; las pruebas lo envían como haría el navegador. */
export const WEB_ORIGIN = process.env.WEB_URL ?? 'http://localhost:3000';

/** Crea un usuario con sesión abierta y devuelve el header Cookie para usarla. */
export async function signedInUser(
  app: NestExpressApplication,
  prisma: PrismaClient,
  { role = Role.BETTOR, status = UserStatus.ACTIVE }: { role?: Role; status?: UserStatus } = {},
): Promise<{ id: string; cookie: string }> {
  const user = await prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${crypto.randomUUID()}@test.local`,
      passwordHash: 'x',
      birthDate: new Date('1990-01-01'),
      role,
      status,
      ...(role === Role.BETTOR ? newUserWallet() : {}),
    },
  });
  const session = await app
    .get(TokenService)
    .issueSession(user.id, { ip: '127.0.0.1', userAgent: 'jest' });
  return {
    id: user.id,
    cookie: `access_token=${session.accessToken}; refresh_token=${session.refreshToken}`,
  };
}

/** Cookies de una respuesta como mapa nombre → atributos crudos (`valor; HttpOnly; …`). */
export function setCookies(res: Response): Record<string, string> {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return Object.fromEntries(
    (raw ?? []).map((c) => {
      const [name, ...rest] = c.split('=');
      return [name as string, rest.join('=')];
    }),
  );
}

/** Header Cookie para reenviar las cookies que puso una respuesta (como haría el navegador). */
export function cookieHeader(res: Response): string {
  return Object.entries(setCookies(res))
    .map(([name, attrs]) => `${name}=${attrs.split(';')[0]}`)
    .join('; ');
}
