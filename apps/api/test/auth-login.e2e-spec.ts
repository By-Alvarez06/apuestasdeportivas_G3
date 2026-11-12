import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ErrorCode } from '@apuestas/shared';
import type { PrismaClient } from '../src/generated/prisma/client';
import { UserStatus } from '../src/generated/prisma/enums';
import { type FakeMailService, INVALID_CAPTCHA } from './fakes';
import {
  cookieHeader,
  createTestApp,
  createTestPrisma,
  mailOf,
  resetDatabase,
  setCookies,
  WEB_ORIGIN,
} from './setup';

const EMAIL = 'luis@example.com';
const PASSWORD = 'una-clave-larga-1';

describe('US1 · Verificación de correo e inicio de sesión (T020)', () => {
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
      birthDate: '1995-05-05',
      captchaToken: 'ok',
    }).expect(202);
  });

  function post(path: string, body: Record<string, unknown> = {}, cookie?: string) {
    const req = request(app.getHttpServer()).post(path).set('Origin', WEB_ORIGIN).send(body);
    return cookie ? req.set('Cookie', cookie) : req;
  }

  const login = (password = PASSWORD, email = EMAIL) =>
    post('/auth/login', { email, password, captchaToken: 'ok' });

  describe('verificación de correo', () => {
    it('un token válido activa la cuenta una sola vez', async () => {
      const token = mail.lastToken(EMAIL);
      await post('/auth/verify-email', { token }).expect(204);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
      expect(user.status).toBe(UserStatus.ACTIVE);

      const reused = await post('/auth/verify-email', { token }).expect(410);
      expect(reused.body.error.code).toBe(ErrorCode.TOKEN_EXPIRED);
    });

    it('un token caducado o inventado responde 410', async () => {
      const token = mail.lastToken(EMAIL);
      await prisma.emailToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await post('/auth/verify-email', { token }).expect(410);
      await post('/auth/verify-email', { token: 'inventado-123456' }).expect(410);
    });

    it('reenviar responde 202 siempre y solo manda correo a cuentas sin verificar', async () => {
      mail.clear();
      await post('/auth/resend-verification', { email: EMAIL }).expect(202);
      await post('/auth/resend-verification', { email: 'nadie@example.com' }).expect(202);
      expect(mail.sent.map((m) => m.to)).toEqual([EMAIL]);
    });
  });

  describe('inicio de sesión', () => {
    it('con credenciales correctas pone cookies httpOnly y abre la sesión', async () => {
      const res = await login().expect(204);
      const cookies = setCookies(res);
      expect(cookies['access_token']).toMatch(/HttpOnly/i);
      expect(cookies['access_token']).toMatch(/SameSite=Lax/i);
      expect(cookies['refresh_token']).toMatch(/HttpOnly/i);
      expect(cookies['refresh_token']).toMatch(/Path=\/auth/);

      const me = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', cookieHeader(res))
        .expect(200);
      expect(me.body).toEqual({
        id: expect.any(String),
        email: EMAIL,
        role: 'BETTOR',
        status: UserStatus.UNVERIFIED,
        twoFactorEnabled: false,
      });
      expect(await prisma.auditLog.count({ where: { action: 'auth.login.success' } })).toBe(1);
    });

    it('contraseña incorrecta y correo inexistente responden el mismo 401', async () => {
      const wrong = await login('otra-clave-larga').expect(401);
      const unknown = await login(PASSWORD, 'nadie@example.com').expect(401);
      expect(wrong.body).toEqual(unknown.body);
      expect(await prisma.auditLog.count({ where: { action: 'auth.login.failed' } })).toBe(2);
    });

    it('5 fallos en 15 minutos bloquean la cuenta, aunque luego la contraseña sea correcta', async () => {
      for (let i = 0; i < 5; i++) await login('otra-clave-larga').expect(401);

      const locked = await login().expect(423);
      expect(locked.body.error.code).toBe(ErrorCode.ACCOUNT_LOCKED);
      expect(await prisma.auditLog.count({ where: { action: 'auth.account.locked' } })).toBe(1);
      expect(mail.to(EMAIL).at(-1)!.subject).toMatch(/bloque/i);
    });

    it('el bloqueo se levanta pasados 15 minutos', async () => {
      for (let i = 0; i < 5; i++) await login('otra-clave-larga').expect(401);
      await login().expect(423);
      await prisma.loginAttempt.updateMany({
        data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) },
      });
      await login().expect(204);
    });

    it('un correo inexistente también se bloquea, para no revelar qué cuentas existen', async () => {
      for (let i = 0; i < 5; i++) await login(PASSWORD, 'nadie@example.com').expect(401);
      await login(PASSWORD, 'nadie@example.com').expect(423);
    });

    it('una cuenta suspendida no puede iniciar sesión', async () => {
      await prisma.user.update({ where: { email: EMAIL }, data: { status: UserStatus.SUSPENDED } });
      await login().expect(401);
    });

    it('rechaza si la verificación anti-bots falla', async () => {
      await post('/auth/login', {
        email: EMAIL,
        password: PASSWORD,
        captchaToken: INVALID_CAPTCHA,
      }).expect(400);
    });
  });
});
