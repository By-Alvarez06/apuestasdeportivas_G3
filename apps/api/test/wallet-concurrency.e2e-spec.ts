import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '../src/generated/prisma/client';
import { describeWalletContract } from '../src/wallet/testing/wallet-contract';
import { WalletService } from '../src/wallet/wallet.service';
import { InsufficientFundsError, type MoneyOp } from '../src/wallet/wallet.port';
import { createTestApp, createTestPrisma, resetDatabase, signedInUser } from './setup';

let app: NestExpressApplication;
let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createTestPrisma();
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describeWalletContract('PostgreSQL', async () => {
  await resetDatabase(prisma);
  return {
    wallet: app.get(WalletService),
    newUser: async () => (await signedInUser(app, prisma)).id,
  };
});

describe('Concurrencia sobre una misma billetera (T033, SC-002)', () => {
  let wallet: WalletService;
  let userId: string;
  let seq = 0;

  beforeEach(async () => {
    await resetDatabase(prisma);
    wallet = app.get(WalletService);
    userId = (await signedInUser(app, prisma)).id;
  });

  const op = (amount: number): MoneyOp => ({
    userId,
    amount,
    balance: 'REAL',
    idempotencyKey: `conc:${++seq}`,
    reference: { type: 'test', id: String(seq) },
  });

  it('20 débitos simultáneos de 10.00 sobre 100.00: pasan exactamente 10 y el saldo queda en 0', async () => {
    await wallet.credit(op(10_000));

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => wallet.debit(op(1000))),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(10);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(InsufficientFundsError);
    expect((await wallet.getBalances(userId)).real).toBe(0);
  });

  it('100 operaciones mixtas simultáneas cuadran al centavo y el saldo nunca es negativo', async () => {
    await wallet.credit(op(5000));

    const ops = Array.from({ length: 100 }, (_, i) =>
      i % 2 === 0 ? wallet.credit(op(137)) : wallet.debit(op(137)),
    );
    const results = await Promise.allSettled(ops);

    const okDebits = results.filter((r, i) => i % 2 === 1 && r.status === 'fulfilled').length;
    expect(okDebits).toBe(50);
    expect((await wallet.getBalances(userId)).real).toBe(5000);

    const [{ min }] = await prisma.$queryRaw<{ min: bigint | null }[]>`
      SELECT MIN(running) AS min FROM (
        SELECT SUM(p.amount) OVER (ORDER BY t."createdAt", t.id) AS running
        FROM "LedgerPosting" p
        JOIN "LedgerTransaction" t ON t.id = p."transactionId"
        JOIN "LedgerAccount" a ON a.id = p."accountId"
        WHERE a."userId" = ${userId}::uuid AND a.type = 'USER_REAL'
      ) s`;
    expect(Number(min)).toBeGreaterThanOrEqual(0);
  });

  it('la misma operación repetida en paralelo se aplica una sola vez', async () => {
    const credit = op(2500);
    await Promise.allSettled(Array.from({ length: 10 }, () => wallet.credit(credit)));
    expect((await wallet.getBalances(userId)).real).toBe(2500);
  });
});
