import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DepositStatus, ErrorCode } from '@apuestas/shared';
import { DepositsService } from '../src/deposits/deposits.service';
import type { PrismaClient } from '../src/generated/prisma/client';
import { UserStatus } from '../src/generated/prisma/enums';
import { WalletService } from '../src/wallet/wallet.service';
import type { FakePayphoneClient } from './fakes';
import {
  createTestApp,
  createTestPrisma,
  payphoneOf,
  resetDatabase,
  signedInUser,
  WEB_ORIGIN,
} from './setup';

describe('US3 · Depósitos con Payphone (T041)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let payphone: FakePayphoneClient;
  let wallet: WalletService;
  let user: { id: string; cookie: string };
  let seq = 0;

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
    payphone = payphoneOf(app);
    wallet = app.get(WalletService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    payphone.reset();
    user = await signedInUser(app, prisma);
  });

  const deposit = (amount: unknown, cookie = user.cookie, key = `dep-key-${++seq}`) =>
    request(app.getHttpServer())
      .post('/deposits')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ amount });

  /** El navegador vuelve de Payphone a la URL de respuesta con id y clientTransactionId. */
  const returnFromPayphone = (id: number, reference: string) =>
    request(app.getHttpServer())
      .get(`/payments/payphone/return?id=${id}&clientTransactionId=${reference}`)
      .expect(302);

  async function startDeposit(amount = '20.00') {
    const res = await deposit(amount).expect(201);
    const row = await prisma.deposit.findUniqueOrThrow({ where: { id: res.body.id } });
    return { res, row };
  }

  it('crea la intención de pago y devuelve la URL de Payphone sin acreditar nada', async () => {
    const { res, row } = await startDeposit('20.00');
    expect(res.body).toEqual({
      id: row.id,
      amount: '20.00',
      status: DepositStatus.PENDING,
      paymentUrl: `https://payphone.test/pagar/${row.reference}`,
      createdAt: row.createdAt.toISOString(),
    });
    expect(payphone.prepared.get(row.reference)?.amount).toBe(2000);
    expect((await wallet.getBalances(user.id)).real).toBe(0);
  });

  it('acredita al volver de Payphone solo tras confirmar servidor a servidor', async () => {
    const { row } = await startDeposit('20.00');
    const id = payphone.pay(row.reference);

    const back = await returnFromPayphone(id, row.reference);

    expect(back.headers.location).toBe(`${WEB_ORIGIN}/billetera/depositos/${row.id}`);
    expect(payphone.confirmCalls).toEqual([{ id, clientTxId: row.reference }]);
    expect((await wallet.getBalances(user.id)).real).toBe(2000);
    const credited = await prisma.deposit.findUniqueOrThrow({ where: { id: row.id } });
    expect(credited).toMatchObject({
      status: DepositStatus.CREDITED,
      providerTxId: String(id),
      payerDocument: '1104567890',
      payerPhone: '593987654321',
    });
    expect(credited.ledgerTransactionId).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'deposit.credited' } })).toBe(1);

    const status = await request(app.getHttpServer())
      .get(`/deposits/${row.id}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(status.body).toMatchObject({
      id: row.id,
      amount: '20.00',
      status: DepositStatus.CREDITED,
    });
  });

  it('10 confirmaciones repetidas (incluso simultáneas) acreditan una sola vez (SC-003)', async () => {
    const { row } = await startDeposit('15.00');
    const id = payphone.pay(row.reference);
    await Promise.all(Array.from({ length: 10 }, () => returnFromPayphone(id, row.reference)));
    expect((await wallet.getBalances(user.id)).real).toBe(1500);
    expect(await prisma.ledgerTransaction.count({ where: { type: 'DEPOSIT' } })).toBe(1);
  });

  it.each([
    ['monto', { amount: 1 }],
    ['moneda', { currency: 'EUR' }],
    ['referencia', { clientTransactionId: 'DEP-otra' }],
  ])('si no coincide el %s, queda en revisión y no acredita', async (_, change) => {
    const { row } = await startDeposit('20.00');
    payphone.override(row.reference, change);
    await returnFromPayphone(payphone.pay(row.reference), row.reference);

    expect((await prisma.deposit.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      DepositStatus.IN_REVIEW,
    );
    expect((await wallet.getBalances(user.id)).real).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'deposit.mismatch' } })).toBe(1);
  });

  it('un pago cancelado en Payphone queda fallido sin efecto en el saldo', async () => {
    const { row } = await startDeposit('20.00');
    payphone.override(row.reference, { approved: false });
    await returnFromPayphone(payphone.pay(row.reference), row.reference);
    expect((await prisma.deposit.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      DepositStatus.FAILED,
    );
    expect((await wallet.getBalances(user.id)).real).toBe(0);
  });

  it('si Payphone no responde, el depósito sigue pendiente y no se acredita', async () => {
    const { row } = await startDeposit('20.00');
    payphone.override(row.reference, 'unavailable');
    await returnFromPayphone(payphone.pay(row.reference), row.reference);
    const pending = await prisma.deposit.findUniqueOrThrow({ where: { id: row.id } });
    expect(pending.status).toBe(DepositStatus.PENDING);
    expect(pending.providerTxId).not.toBeNull();
    expect((await wallet.getBalances(user.id)).real).toBe(0);
  });

  it('volver con una referencia desconocida no hace nada y lleva a la billetera', async () => {
    const back = await returnFromPayphone(99, 'DEP-inventada');
    expect(back.headers.location).toBe(`${WEB_ORIGIN}/billetera`);
    expect(payphone.confirmCalls).toHaveLength(0);
  });

  it('exige correo verificado', async () => {
    const unverified = await signedInUser(app, prisma, { status: UserStatus.UNVERIFIED });
    const res = await deposit('20.00', unverified.cookie).expect(403);
    expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it.each(['0.99', '1000.01', '-5', '10.001', 'diez', 20])(
    'rechaza el monto %p',
    async (amount) => {
      await deposit(amount).expect(400);
      expect(await prisma.deposit.count()).toBe(0);
    },
  );

  it('acepta los límites exactos de 1.00 y 1000.00', async () => {
    await deposit('1.00').expect(201);
    await deposit('1000.00').expect(201);
  });

  it('repetir la petición con la misma clave no crea otro depósito', async () => {
    const first = await deposit('20.00', user.cookie, 'misma-clave-123').expect(201);
    const second = await deposit('20.00', user.cookie, 'misma-clave-123').expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.deposit.count()).toBe(1);
    await deposit('30.00', user.cookie, 'misma-clave-123').expect(409);
  });

  it('nadie ve el depósito de otro usuario', async () => {
    const { row } = await startDeposit('20.00');
    const other = await signedInUser(app, prisma);
    await request(app.getHttpServer())
      .get(`/deposits/${row.id}`)
      .set('Cookie', other.cookie)
      .expect(404);
  });

  it('el cliente no puede declarar el depósito como pagado', async () => {
    await deposit('20.00').send({ amount: '20.00', status: 'CREDITED' }).expect(400);
  });

  describe('reconciliación (T042)', () => {
    it('confirma pendientes que ya tienen id de Payphone y expira los de más de 24 h', async () => {
      const retry = await startDeposit('12.00');
      payphone.override(retry.row.reference, 'unavailable');
      await returnFromPayphone(payphone.pay(retry.row.reference), retry.row.reference);
      payphone.override(retry.row.reference, {});

      const abandoned = await startDeposit('5.00');
      await prisma.deposit.update({
        where: { id: abandoned.row.id },
        data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
      });

      await app.get(DepositsService).reconcile();

      expect((await prisma.deposit.findUniqueOrThrow({ where: { id: retry.row.id } })).status).toBe(
        DepositStatus.CREDITED,
      );
      expect(
        (await prisma.deposit.findUniqueOrThrow({ where: { id: abandoned.row.id } })).status,
      ).toBe(DepositStatus.EXPIRED);
      expect((await wallet.getBalances(user.id)).real).toBe(1200);
    });
  });
});
