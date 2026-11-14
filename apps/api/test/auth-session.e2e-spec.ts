import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client';
import type { FakeMailService } from './fakes';
import {
  cookieHeader,
  createTestApp,
  createTestPrisma,
  mailOf,
  resetDatabase,
  WEB_ORIGIN,
} from './setup';

const EMAIL = 'eva@example.com';
const PASSWORD = 'una-clave-larga-1';

describe('US1 · Sesiones, cierre y recuperación de contraseña (T021)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let mail: FakeMailService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
    mail = mailOf(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    mail.clear();
    await post('/auth/register', {
      email: EMAIL,
      password: PASSWORD,
      birthDate: '1990-01-01',
      captchaToken: 'ok',
    }).expect(202);
  });

  function post(path: string, body: Record<string, unknown> = {}, cookie?: string) {
    const req = request(app.getHttpServer()).post(path).set('Origin', WEB_ORIGIN).send(body);
    return cookie ? req.set('Cookie', cookie) : req;
  }

  const me = (cookie: string) => request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie);

  async function login(password = PASSWORD): Promise<string> {
    const res = await post('/auth/login', { email: EMAIL, password, captchaToken: 'ok' }).expect(
      204,
    );
    return cookieHeader(res);
  }

  it('refresh entrega cookies nuevas y la sesión sigue activa', async () => {
    const first = await login();
    const res = await post('/auth/refresh', {}, first).expect(204);
    const second = cookieHeader(res);
    expect(second).not.toEqual(first);
    await me(second).expect(200);
  });

  it('reusar un refresh ya usado revoca todas las sesiones del usuario', async () => {
    const first = await login();
    const other = await login();
    const rotated = cookieHeader(await post('/auth/refresh', {}, first).expect(204));

    await post('/auth/refresh', {}, first).expect(401);

    await me(rotated).expect(401);
    await me(other).expect(401);
    await post('/auth/refresh', {}, rotated).expect(401);
    expect(await prisma.auditLog.count({ where: { action: 'auth.refresh.reuse' } })).toBe(1);
  });

  it('renovaciones simultáneas con el mismo refresh no dejan ninguna sesión viva', async () => {
    const cookie = await login();
    await Promise.all(Array.from({ length: 10 }, () => post('/auth/refresh', {}, cookie)));
    // Una gana y las demás detectan el reuso: la revocación alcanza también al sucesor recién creado.
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });

  it('sin cookie de refresh o con una inventada responde 401', async () => {
    await post('/auth/refresh').expect(401);
    await post('/auth/refresh', {}, 'refresh_token=inventado').expect(401);
  });

  it('un refresh caducado responde 401', async () => {
    const cookie = await login();
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await post('/auth/refresh', {}, cookie).expect(401);
  });

  it('cerrar sesión invalida al instante el acceso y la renovación', async () => {
    const cookie = await login();
    const other = await login();
    await post('/auth/logout', {}, cookie).expect(204);

    await me(cookie).expect(401);
    await post('/auth/refresh', {}, cookie).expect(401);
    await me(other).expect(200);
  });

  it('/auth/me exige sesión', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  describe('recuperación de contraseña', () => {
    it('responde 202 exista o no el correo, y solo envía enlace a cuentas reales', async () => {
      mail.clear();
      await post('/auth/forgot-password', { email: EMAIL }).expect(202);
      await post('/auth/forgot-password', { email: 'nadie@example.com' }).expect(202);
      expect(mail.sent.map((m) => m.to)).toEqual([EMAIL]);
    });

    it('cambia la contraseña, cierra todas las sesiones y el enlace no se puede reusar', async () => {
      const session = await login();
      await post('/auth/forgot-password', { email: EMAIL }).expect(202);
      const token = mail.lastToken(EMAIL);

      await post('/auth/reset-password', { token, password: 'nueva-clave-larga-9' }).expect(204);

      await me(session).expect(401);
      await post('/auth/login', { email: EMAIL, password: PASSWORD, captchaToken: 'ok' }).expect(
        401,
      );
      await login('nueva-clave-larga-9');
      await post('/auth/reset-password', { token, password: 'otra-clave-larga-8' }).expect(410);
      expect(await prisma.auditLog.count({ where: { action: 'auth.password.reset' } })).toBe(1);
    });

    it('un enlace de recuperación caduca en 1 hora', async () => {
      await post('/auth/forgot-password', { email: EMAIL }).expect(202);
      const token = mail.lastToken(EMAIL);
      await prisma.emailToken.updateMany({
        where: { purpose: 'RESET_PASSWORD' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await post('/auth/reset-password', { token, password: 'nueva-clave-larga-9' }).expect(410);
    });

    it('exige una contraseña válida', async () => {
      await post('/auth/forgot-password', { email: EMAIL }).expect(202);
      const token = mail.lastToken(EMAIL);
      await post('/auth/reset-password', { token, password: 'corta' }).expect(400);
    });

    it('un token de verificación no sirve para cambiar la contraseña', async () => {
      const verifyToken = mail.lastToken(EMAIL);
      await post('/auth/reset-password', {
        token: verifyToken,
        password: 'nueva-clave-larga-9',
      }).expect(410);
    });
  });
});
