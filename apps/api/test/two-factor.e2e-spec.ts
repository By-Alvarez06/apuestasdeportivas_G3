import type { NestExpressApplication } from '@nestjs/platform-express';
import { authenticator } from 'otplib';
import request from 'supertest';
import { TwoFactorService } from '../src/auth/two-factor.service';
import type { PrismaClient } from '../src/generated/prisma/client';
import { createTestApp, createTestPrisma, resetDatabase, signedInUser, WEB_ORIGIN } from './setup';
import { enableTwoFactor } from './two-factor.helpers';

describe('US4 · Verificación en dos pasos (T050)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let user: { id: string; cookie: string };

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    user = await signedInUser(app, prisma);
  });

  const post = (path: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(path)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', user.cookie)
      .send(body);

  it('setup entrega el QR y el secreto queda cifrado, sin activar todavía', async () => {
    const res = await post('/auth/2fa/setup').expect(201);
    expect(res.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/.+secret=[A-Z2-7]+/);
    expect(res.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const secret = new URL(res.body.otpauthUrl).searchParams.get('secret') as string;
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.totpSecretEnc).not.toBeNull();
    expect(row.totpSecretEnc).not.toContain(secret);
    expect(row.totpEnabledAt).toBeNull();
  });

  it('enable con un código correcto activa 2FA y entrega 10 códigos de recuperación', async () => {
    const { recoveryCodes } = await enableTwoFactor(app, user.cookie);
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.totpEnabledAt).not.toBeNull();
    expect(await prisma.recoveryCode.count({ where: { userId: user.id } })).toBe(10);
    const me = await request(app.getHttpServer()).get('/auth/me').set('Cookie', user.cookie);
    expect(me.body.twoFactorEnabled).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'auth.2fa.enabled' } })).toBe(1);
  });

  it('enable con un código incorrecto no activa', async () => {
    await post('/auth/2fa/setup').expect(201);
    await post('/auth/2fa/enable', { code: '000000' }).expect(403);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).totpEnabledAt,
    ).toBeNull();
  });

  it('no deja reconfigurar 2FA una vez activa', async () => {
    await enableTwoFactor(app, user.cookie);
    await post('/auth/2fa/setup').expect(409);
  });

  it('verifica códigos TOTP y de recuperación; cada recuperación sirve una vez', async () => {
    const { secret, recoveryCodes } = await enableTwoFactor(app, user.cookie);
    const twoFactor = app.get(TwoFactorService);
    const code = recoveryCodes[0] as string;

    expect(await twoFactor.verify(user.id, authenticator.generate(secret))).toBe(true);
    expect(await twoFactor.verify(user.id, '123456')).toBe(false);
    expect(await twoFactor.verify(user.id, code)).toBe(true);
    expect(await twoFactor.verify(user.id, code)).toBe(false);
  });
});
