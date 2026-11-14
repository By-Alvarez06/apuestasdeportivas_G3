import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ErrorCode } from '@apuestas/shared';
import type { PrismaClient } from '../src/generated/prisma/client';
import { Role } from '../src/generated/prisma/enums';
import { WalletService } from '../src/wallet/wallet.service';
import type { FakeMailService } from './fakes';
import {
  cookieHeader,
  createTestApp,
  createTestPrisma,
  mailOf,
  payphoneOf,
  resetDatabase,
  signedInUser,
  WEB_ORIGIN,
} from './setup';
import { enableTwoFactor, totp } from './two-factor.helpers';
import { depositThroughPayphone, PAYER } from './withdrawals.helpers';

describe('US5 · Auditoría y correcciones contables (T059, SC-009)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let mail: FakeMailService;
  let wallet: WalletService;
  let admin: { id: string; cookie: string };
  let seq = 0;

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
    mail = mailOf(app);
    wallet = app.get(WalletService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    mail.clear();
    payphoneOf(app).reset();
    admin = await signedInUser(app, prisma, { role: Role.ADMIN });
  });

  const post = (path: string, body: Record<string, unknown>, cookie?: string) => {
    const req = request(app.getHttpServer())
      .post(path)
      .set('Origin', WEB_ORIGIN)
      .set('User-Agent', 'navegador-de-prueba')
      .set('Idempotency-Key', `audit-${++seq}`)
      .send(body);
    return cookie ? req.set('Cookie', cookie) : req;
  };

  const adjust = (body: Record<string, unknown>, key = `ajuste-${++seq}`) =>
    request(app.getHttpServer())
      .post('/admin/ledger/adjustments')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', key)
      .send(body);

  it('cada acción sensible de FR-011 queda con quién, qué, cuándo, IP y dispositivo', async () => {
    const email = 'auditada@example.com';
    const password = 'una-clave-larga-1';
    await post('/auth/register', {
      email,
      password,
      birthDate: '1990-01-01',
      captchaToken: 'ok',
    }).expect(202);
    await post('/auth/verify-email', { token: mail.lastToken(email) }).expect(204);
    await post('/auth/login', { email, password: 'otra-mala-clave', captchaToken: 'ok' }).expect(
      401,
    );
    for (let i = 0; i < 4; i++)
      await post('/auth/login', { email, password: 'otra-mala-clave', captchaToken: 'ok' });
    await prisma.loginAttempt.deleteMany();
    await post('/auth/login', { email, password, captchaToken: 'ok' }).expect(204);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    await post('/auth/forgot-password', { email }).expect(202);
    await post('/auth/reset-password', {
      token: mail.lastToken(email),
      password: 'otra-clave-larga-2',
    }).expect(204);
    const relogin = cookieHeader(
      await post('/auth/login', {
        email,
        password: 'otra-clave-larga-2',
        captchaToken: 'ok',
      }).expect(204),
    );
    const { secret } = await enableTwoFactor(app, relogin);
    await depositThroughPayphone(app, relogin, '300.00');
    await wallet.debit({
      userId: user.id,
      amount: 100,
      balance: 'REAL',
      idempotencyKey: 'apuesta-audit',
      reference: { type: 'bet', id: '1' },
    });
    const w = await post(
      '/withdrawals',
      { amount: '250.00', ...PAYER, totpCode: totp(secret) },
      relogin,
    ).expect(201);
    await post(`/admin/withdrawals/${w.body.id}/reject`, { reason: 'prueba' }, admin.cookie).expect(
      201,
    );
    await request(app.getHttpServer())
      .patch(`/admin/users/${user.id}/role`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', admin.cookie)
      .send({ role: 'OPERATOR' })
      .expect(200);
    await adjust({
      userId: user.id,
      account: 'REAL',
      amount: '1.00',
      reason: 'Compensación',
    }).expect(201);

    const required = [
      'auth.register',
      'auth.email.verified',
      'auth.login.failed',
      'auth.account.locked',
      'auth.login.success',
      'auth.password.reset',
      'auth.2fa.enabled',
      'deposit.created',
      'deposit.credited',
      'withdrawal.requested',
      'withdrawal.rejected',
      'user.role.changed',
      'ledger.adjustment',
    ];
    const logs = await prisma.auditLog.findMany({ where: { action: { in: required } } });
    expect(new Set(logs.map((l) => l.action))).toEqual(new Set(required));
    for (const log of logs) {
      expect(log.ip).toBeTruthy();
      expect(log.userAgent).toBeTruthy();
      expect(log.createdAt).toBeInstanceOf(Date);
    }
    // La auditoría nunca guarda contraseñas.
    expect(JSON.stringify(logs)).not.toMatch(/una-clave-larga|otra-clave-larga|otra-mala-clave/);
  });

  it('el administrador consulta la auditoría con filtros y paginación', async () => {
    const user = await signedInUser(app, prisma);
    await post('/auth/login', { email: 'nadie@example.com', password: 'x', captchaToken: 'ok' });
    await adjust({
      userId: user.id,
      account: 'REAL',
      amount: '2.00',
      reason: 'Bono manual',
    }).expect(201);

    const all = await request(app.getHttpServer())
      .get('/admin/audit?pageSize=1')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(all.body.items).toHaveLength(1);
    expect(all.body.total).toBeGreaterThanOrEqual(2);

    const byAction = await request(app.getHttpServer())
      .get('/admin/audit?action=ledger.adjustment')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(byAction.body.items).toHaveLength(1);
    expect(byAction.body.items[0]).toMatchObject({
      actorId: admin.id,
      action: 'ledger.adjustment',
    });

    const byActor = await request(app.getHttpServer())
      .get(`/admin/audit?actorId=${admin.id}`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(byActor.body.items.every((i: { actorId: string }) => i.actorId === admin.id)).toBe(true);

    const future = new Date(Date.now() + 60_000).toISOString();
    const none = await request(app.getHttpServer())
      .get(`/admin/audit?from=${future}`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(none.body.total).toBe(0);
  });

  describe('correcciones contables (FR-015)', () => {
    let user: { id: string; cookie: string };

    beforeEach(async () => {
      user = await signedInUser(app, prisma);
    });

    it('un crédito y un débito compensatorios cambian el saldo y llevan motivo y autor', async () => {
      await adjust({
        userId: user.id,
        account: 'REAL',
        amount: '10.00',
        reason: 'Error en premio',
      }).expect(201);
      await adjust({
        userId: user.id,
        account: 'REAL',
        amount: '-2.50',
        reason: 'Corrección parcial',
      }).expect(201);
      await adjust({
        userId: user.id,
        account: 'BONUS',
        amount: '3.00',
        reason: 'Bono de cortesía',
      }).expect(201);
      expect(await wallet.getBalances(user.id)).toEqual({ real: 750, bonus: 300, held: 0 });

      const txs = await prisma.ledgerTransaction.findMany({ where: { type: 'ADJUSTMENT' } });
      expect(txs).toHaveLength(3);
      for (const t of txs)
        expect(t).toMatchObject({ createdById: admin.id, reason: expect.any(String) });
    });

    it('exige motivo', async () => {
      await adjust({ userId: user.id, account: 'REAL', amount: '1.00' }).expect(400);
      await adjust({ userId: user.id, account: 'REAL', amount: '1.00', reason: '   ' }).expect(400);
    });

    it('no deja el saldo negativo', async () => {
      const res = await adjust({
        userId: user.id,
        account: 'REAL',
        amount: '-0.01',
        reason: 'x',
      }).expect(422);
      expect(res.body.error.code).toBe(ErrorCode.INSUFFICIENT_FUNDS);
    });

    it('es idempotente por Idempotency-Key', async () => {
      const body = { userId: user.id, account: 'REAL', amount: '5.00', reason: 'Una vez' };
      await adjust(body, 'ajuste-unico').expect(201);
      await adjust(body, 'ajuste-unico').expect(201);
      expect((await wallet.getBalances(user.id)).real).toBe(500);
    });

    it.each([
      { account: 'HELD', amount: '1.00' },
      { account: 'REAL', amount: '0.00' },
      { account: 'REAL', amount: '1.001' },
    ])('valida la cuenta y el monto: %p', async (body) => {
      await adjust({ userId: user.id, reason: 'x', ...body }).expect(400);
    });

    it('un usuario sin billetera responde 404', async () => {
      const operator = await signedInUser(app, prisma, { role: Role.OPERATOR });
      await adjust({ userId: operator.id, account: 'REAL', amount: '1.00', reason: 'x' }).expect(
        404,
      );
    });
  });
});
