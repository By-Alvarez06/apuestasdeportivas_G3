import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ErrorCode } from '@apuestas/shared';
import type { PrismaClient } from '../src/generated/prisma/client';
import { UserStatus } from '../src/generated/prisma/enums';
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

describe('US4 · Retiros: abuso (T053, SC-006)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let wallet: WalletService;
  let user: { id: string; cookie: string };
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
    await depositThroughPayphone(app, user.cookie, '50.00');
    ({ secret } = await enableTwoFactor(app, user.cookie));
  });

  const withdraw = (body: Record<string, unknown>, cookie = user.cookie) =>
    request(app.getHttpServer())
      .post('/withdrawals')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `retiro-${++seq}-${Date.now()}`)
      .send({ amount: '10.00', ...PAYER, totpCode: totp(secret), ...body });

  const realBalance = async () => (await wallet.getBalances(user.id)).real;

  it('sin 2FA activa se rechaza y no se crea el retiro', async () => {
    const other = await signedInUser(app, prisma);
    await depositThroughPayphone(app, other.cookie, '20.00');
    const res = await withdraw({ totpCode: '123456' }, other.cookie).expect(403);
    expect(res.body.error.code).toBe(ErrorCode.TWO_FACTOR_REQUIRED);
    expect(await prisma.withdrawal.count()).toBe(0);
  });

  it('con un código 2FA incorrecto se rechaza', async () => {
    const res = await withdraw({ totpCode: '000000' }).expect(403);
    expect(res.body.error.code).toBe(ErrorCode.TWO_FACTOR_REQUIRED);
    expect(await realBalance()).toBe(5000);
  });

  it.each([
    ['otro documento', { destinationDocument: '0999999999' }],
    ['otro teléfono', { destinationPhone: '593900000000' }],
  ])('a %s se rechaza y queda auditado', async (_, change) => {
    const res = await withdraw(change).expect(403);
    expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
    expect(await prisma.withdrawal.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'withdrawal.holder_mismatch' } })).toBe(
      1,
    );
    expect(await realBalance()).toBe(5000);
  });

  it('sin depósitos acreditados no hay titular al que retirar', async () => {
    const fresh = await signedInUser(app, prisma);
    const { secret: s } = await enableTwoFactor(app, fresh.cookie);
    await wallet.credit({
      userId: fresh.id,
      amount: 1000,
      balance: 'REAL',
      idempotencyKey: 'premio-sin-deposito',
      reference: { type: 'test', id: '1' },
    });
    await withdraw({ totpCode: totp(s) }, fresh.cookie).expect(403);
  });

  it('el saldo de bono no se puede retirar', async () => {
    await wallet.credit({
      userId: user.id,
      amount: 10_000,
      balance: 'BONUS',
      idempotencyKey: 'bono-grande',
      reference: { type: 'test', id: '1' },
    });
    const res = await withdraw({ amount: '60.00' }).expect(422);
    expect(res.body.error.code).toBe(ErrorCode.INSUFFICIENT_FUNDS);
    expect((await wallet.getBalances(user.id)).bonus).toBe(10_000);
  });

  it('sin saldo suficiente responde 422', async () => {
    const res = await withdraw({ amount: '50.01' }).expect(422);
    expect(res.body.error.code).toBe(ErrorCode.INSUFFICIENT_FUNDS);
  });

  it('una cuenta sin correo verificado no puede retirar', async () => {
    await prisma.user.update({ where: { id: user.id }, data: { status: UserStatus.UNVERIFIED } });
    await withdraw({}).expect(403);
  });

  it('el cliente no puede fijar el estado ni saltarse la revisión', async () => {
    await withdraw({ status: 'PAID' }).expect(400);
  });

  it.each(['0', '-1', '1.001', 'mucho'])('rechaza el monto %p', async (amount) => {
    await withdraw({ amount }).expect(400);
  });
});
