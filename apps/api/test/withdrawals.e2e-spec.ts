import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { WithdrawalStatus } from '@apuestas/shared';
import type { PrismaClient } from '../src/generated/prisma/client';
import { Role } from '../src/generated/prisma/enums';
import { WalletService } from '../src/wallet/wallet.service';
import {
  createTestApp,
  createTestPrisma,
  payphoneOf,
  resetDatabase,
  signedInUser,
  WEB_ORIGIN,
} from './setup';
import { enableTwoFactor, totp } from './two-factor.helpers';
import { depositThroughPayphone, PAYER } from './withdrawals.helpers';

describe('US4 · Retiros: flujo y revisión (T054)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let wallet: WalletService;
  let user: { id: string; cookie: string };
  let admin: { id: string; cookie: string };
  let secret: string;
  let seq = 0;

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
    wallet = app.get(WalletService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    payphoneOf(app).reset();
    user = await signedInUser(app, prisma);
    admin = await signedInUser(app, prisma, { role: Role.ADMIN });
    await depositThroughPayphone(app, user.cookie, '500.00');
    ({ secret } = await enableTwoFactor(app, user.cookie));
  });

  /** Apuesta simulada después del depósito: quita la sospecha de "depositar y retirar sin jugar". */
  const placeBet = (cents: number) =>
    wallet.debit({
      userId: user.id,
      amount: cents,
      balance: 'REAL',
      idempotencyKey: `apuesta-${++seq}`,
      reference: { type: 'bet', id: String(seq) },
    });

  const withdraw = (amount: string, key = `retiro-${++seq}`) =>
    request(app.getHttpServer())
      .post('/withdrawals')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', key)
      .send({ amount, ...PAYER, totpCode: totp(secret) });

  const adminPost = (path: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(path)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', admin.cookie)
      .send(body);

  it('bajo el umbral y tras haber apostado, se retiene y se paga con referencia simulada', async () => {
    await placeBet(1000);
    const res = await withdraw('30.00').expect(201);
    expect(res.body.status).toBe(WithdrawalStatus.PAID);

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.payoutReference).toMatch(/^SIM-[0-9a-f-]{36}$/);
    expect(await wallet.getBalances(user.id)).toEqual({ real: 46_000, bonus: 0, held: 0 });
    const payout = await prisma.ledgerTransaction.count({ where: { type: 'WITHDRAWAL_PAYOUT' } });
    expect(payout).toBe(1);
  });

  it('sobre el umbral de 200.00 queda pendiente de aprobación con el monto retenido', async () => {
    await placeBet(1000);
    const res = await withdraw('250.00').expect(201);
    expect(res.body.status).toBe(WithdrawalStatus.PENDING_APPROVAL);
    expect(await wallet.getBalances(user.id)).toEqual({ real: 24_000, bonus: 0, held: 25_000 });
    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.reviewReason).toMatch(/umbral/);
  });

  it('dentro de las 24 h de un depósito sin apuestas queda en revisión aunque sea poco', async () => {
    const res = await withdraw('5.00').expect(201);
    expect(res.body.status).toBe(WithdrawalStatus.PENDING_APPROVAL);
    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.reviewReason).toMatch(/depósito reciente/);
  });

  it('el administrador aprueba: se paga desde lo retenido', async () => {
    await placeBet(1000);
    const { body } = await withdraw('250.00').expect(201);
    const approved = await adminPost(`/admin/withdrawals/${body.id}/approve`).expect(201);
    expect(approved.body.status).toBe(WithdrawalStatus.PAID);
    expect(await wallet.getBalances(user.id)).toEqual({ real: 24_000, bonus: 0, held: 0 });
    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.reviewedById).toBe(admin.id);
    expect(await prisma.auditLog.count({ where: { action: 'withdrawal.approved' } })).toBe(1);
    await adminPost(`/admin/withdrawals/${body.id}/approve`).expect(409);
  });

  it('el administrador rechaza: el monto vuelve al saldo real', async () => {
    await placeBet(1000);
    const { body } = await withdraw('250.00').expect(201);
    await adminPost(`/admin/withdrawals/${body.id}/reject`, {
      reason: 'Documento no coincide',
    }).expect(201);
    expect(await wallet.getBalances(user.id)).toEqual({ real: 49_000, bonus: 0, held: 0 });
    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.status).toBe(WithdrawalStatus.REJECTED);
    await adminPost(`/admin/withdrawals/${body.id}/approve`).expect(409);
  });

  it('rechazar exige motivo', async () => {
    await placeBet(1000);
    const { body } = await withdraw('250.00').expect(201);
    await adminPost(`/admin/withdrawals/${body.id}/reject`, {}).expect(400);
  });

  it('dos retiros simultáneos que juntos superan el saldo: solo pasa uno', async () => {
    await placeBet(30_000); // queda 200.00
    const results = await Promise.all([withdraw('150.00'), withdraw('150.00')]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(await prisma.withdrawal.count()).toBe(1);
  });

  it('repetir la petición con la misma clave no crea otro retiro', async () => {
    await placeBet(1000);
    const first = await withdraw('20.00', 'misma-clave-retiro').expect(201);
    const second = await withdraw('20.00', 'misma-clave-retiro').expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect((await wallet.getBalances(user.id)).real).toBe(47_000);
  });

  it('el apostador ve sus retiros y el administrador los pendientes', async () => {
    await placeBet(1000);
    await withdraw('10.00').expect(201);
    await withdraw('250.00').expect(201);

    const mine = await request(app.getHttpServer())
      .get('/withdrawals')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(mine.body.items).toHaveLength(2);
    expect(mine.body.items[0]).toMatchObject({
      amount: '250.00',
      status: WithdrawalStatus.PENDING_APPROVAL,
    });

    const pending = await request(app.getHttpServer())
      .get('/admin/withdrawals?status=PENDING_APPROVAL')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(pending.body.items).toHaveLength(1);
    expect(pending.body.items[0]).toMatchObject({ amount: '250.00', email: expect.any(String) });

    await request(app.getHttpServer())
      .get('/admin/withdrawals')
      .set('Cookie', user.cookie)
      .expect(403);
  });
});
