import type { PrismaClient } from '../src/generated/prisma/client';
import { LedgerAccountType, LedgerTransactionType } from '../src/generated/prisma/enums';
import { createTestPrisma, resetDatabase } from './setup';

describe('Inmutabilidad del libro contable y la auditoría (T008)', () => {
  let prisma: PrismaClient;
  let house: string;
  let gateway: string;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const accounts = await prisma.ledgerAccount.findMany({ where: { userId: null } });
    house = accounts.find((a) => a.type === LedgerAccountType.HOUSE)!.id;
    gateway = accounts.find((a) => a.type === LedgerAccountType.GATEWAY)!.id;
  });

  function postBalanced(idempotencyKey: string) {
    return prisma.ledgerTransaction.create({
      data: {
        type: LedgerTransactionType.ADJUSTMENT,
        idempotencyKey,
        referenceType: 'test',
        referenceId: idempotencyKey,
        postings: {
          create: [
            { accountId: gateway, amount: -500 },
            { accountId: house, amount: 500 },
          ],
        },
      },
      include: { postings: true },
    });
  }

  it('acepta un asiento cuadrado', async () => {
    const tx = await postBalanced('ok');
    expect(tx.postings.reduce((sum, p) => sum + p.amount, 0)).toBe(0);
  });

  it('rechaza un asiento descuadrado', async () => {
    await expect(
      prisma.ledgerTransaction.create({
        data: {
          type: LedgerTransactionType.ADJUSTMENT,
          idempotencyKey: 'descuadrado',
          referenceType: 'test',
          referenceId: '1',
          postings: { create: [{ accountId: house, amount: 500 }] },
        },
      }),
    ).rejects.toThrow(/descuadrado/);
    expect(await prisma.ledgerTransaction.count()).toBe(0);
  });

  it('rechaza líneas con monto 0', async () => {
    await expect(
      prisma.ledgerPosting.create({
        data: {
          amount: 0,
          account: { connect: { id: house } },
          transaction: {
            create: {
              type: LedgerTransactionType.ADJUSTMENT,
              idempotencyKey: 'cero',
              referenceType: 'test',
              referenceId: '1',
            },
          },
        },
      }),
    ).rejects.toThrow();
  });

  it('rechaza una clave de idempotencia repetida', async () => {
    await postBalanced('misma');
    await expect(postBalanced('misma')).rejects.toThrow();
  });

  it('no deja editar ni borrar asientos', async () => {
    const tx = await postBalanced('fijo');
    const posting = tx.postings[0]!;
    await expect(
      prisma.ledgerPosting.update({ where: { id: posting.id }, data: { amount: -1 } }),
    ).rejects.toThrow(/solo agregar/);
    await expect(prisma.ledgerPosting.delete({ where: { id: posting.id } })).rejects.toThrow(
      /solo agregar/,
    );
    await expect(
      prisma.ledgerTransaction.update({ where: { id: tx.id }, data: { reason: 'x' } }),
    ).rejects.toThrow(/solo agregar/);
    await expect(prisma.ledgerTransaction.delete({ where: { id: tx.id } })).rejects.toThrow(
      /solo agregar/,
    );
  });

  it('no deja añadir líneas, ni compensadas, a un asiento ya confirmado', async () => {
    const tx = await postBalanced('cerrado');
    await expect(
      prisma.ledgerPosting.createMany({
        data: [
          { transactionId: tx.id, accountId: gateway, amount: -900 },
          { transactionId: tx.id, accountId: house, amount: 900 },
        ],
      }),
    ).rejects.toThrow(/cerrado/);
    expect(await prisma.ledgerPosting.count({ where: { transactionId: tx.id } })).toBe(2);
  });

  it('no deja editar ni borrar la auditoría', async () => {
    const log = await prisma.auditLog.create({
      data: { action: 'test.action', ip: '127.0.0.1', userAgent: 'jest' },
    });
    await expect(
      prisma.auditLog.update({ where: { id: log.id }, data: { action: 'otra' } }),
    ).rejects.toThrow(/solo agregar/);
    await expect(prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(/solo agregar/);
  });

  it('impide duplicar una cuenta del sistema', async () => {
    await expect(
      prisma.ledgerAccount.create({ data: { type: LedgerAccountType.HOUSE } }),
    ).rejects.toThrow();
  });
});
