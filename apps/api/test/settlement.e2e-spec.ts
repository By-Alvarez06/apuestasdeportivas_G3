import type { NestExpressApplication } from '@nestjs/platform-express';
import { BettingSettingsService } from '../src/betting/settings.service';
import type { PrismaClient } from '../src/generated/prisma/client';
import { LedgerTransactionType } from '../src/generated/prisma/enums';
import {
  balances,
  type BetView,
  catalogOf,
  fund,
  placeBet,
  processed,
  publish,
  result1x2,
  single,
} from './bets.helpers';
import { createTestApp, createTestPrisma, drainQueues, resetDatabase, signedInUser } from './setup';

describe('US2 · Liquidación automática e idempotente (T032)', () => {
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
    await drainQueues();
    await resetDatabase(prisma);
    app.get(BettingSettingsService).clearCache();
    catalogOf(app).reset();
    user = await signedInUser(app, prisma);
    await fund(app, user.id, 5000);
  });

  const bet = async (selectionId: string, odds: string, stake = '10.00', cookie = user.cookie) =>
    (await placeBet(app, cookie, single(selectionId, odds, stake)).expect(201)).body as BetView;

  const settle = async (event: ReturnType<typeof result1x2>) => {
    await publish(app, event);
    await processed(prisma, event.sourceEventId);
  };

  /** Suma de los movimientos de la apuesta en las cuentas del usuario (débito negativo, pagos positivos). */
  const netOf = async (betId: string) => {
    const postings = await prisma.ledgerPosting.findMany({
      where: {
        transaction: { referenceType: 'bet', referenceId: betId },
        account: { userId: { not: null } },
      },
    });
    return postings.reduce((sum, p) => sum + p.amount, 0);
  };

  it('escenario 1: una apuesta ganada acredita monto × cuota al saldo de origen', async () => {
    const won = await bet('m1-1x2-home', '2.10');
    await settle(result1x2('m1', 'home'));

    const settled = await prisma.bet.findUniqueOrThrow({
      where: { id: won.id },
      include: { selections: true, settlements: true },
    });
    expect(settled).toMatchObject({ status: 'WON', payout: 2100, settledVersion: 1 });
    expect(settled.settledAt).not.toBeNull();
    expect(settled.selections[0]!.status).toBe('WON');
    expect(settled.settlements).toEqual([
      expect.objectContaining({ version: 1, outcome: 'WON', payout: 2100 }),
    ]);
    expect((await balances(app, user.id)).real).toBe(6100);

    const credit = await prisma.ledgerTransaction.findFirstOrThrow({
      where: { type: LedgerTransactionType.BET_CREDIT },
    });
    expect(credit).toMatchObject({ referenceType: 'bet', referenceId: won.id });
    expect(await netOf(won.id)).toBe(2100 - 1000);
  });

  it('escenario 2: una apuesta perdida se cierra sin movimiento de dinero', async () => {
    const lost = await bet('m1-1x2-draw', '3.20');
    await settle(result1x2('m1', 'home'));

    expect(await prisma.bet.findUniqueOrThrow({ where: { id: lost.id } })).toMatchObject({
      status: 'LOST',
      payout: 0,
      settledVersion: 1,
    });
    expect((await balances(app, user.id)).real).toBe(4000);
    expect(await prisma.ledgerTransaction.count({ where: { type: 'BET_CREDIT' } })).toBe(0);
    expect(await netOf(lost.id)).toBe(-1000);
  });

  it('escenario 4: repetir el mismo resultado 10 veces no paga dos veces (SC-005)', async () => {
    const won = await bet('m1-1x2-home', '2.10');
    const event = result1x2('m1', 'home', 'fuente-unica-1');
    for (let i = 0; i < 10; i++) await settle(event);
    // La fuente reenvía el mismo resultado con otro id.
    await settle(result1x2('m1', 'home', 'fuente-unica-2'));

    expect((await balances(app, user.id)).real).toBe(6100);
    expect(await prisma.betSettlement.count({ where: { betId: won.id } })).toBe(1);
    expect(await prisma.matchEvent.count({ where: { sourceEventId: 'fuente-unica-1' } })).toBe(1);
    expect(await netOf(won.id)).toBe(1100);
  });

  it('una apuesta pagada con bono acredita el premio al bono', async () => {
    await fund(app, user.id, 2000, 'BONUS');
    await placeBet(app, user.cookie, {
      ...single('m1-1x2-home', '2.10', '10.00'),
      source: 'BONUS',
    }).expect(201);
    await settle(result1x2('m1', 'home'));
    expect(await balances(app, user.id)).toMatchObject({ real: 5000, bonus: 1000 + 2100 });
  });

  it('liquida solo las apuestas del mercado resuelto y de todos los apostadores', async () => {
    const other = await signedInUser(app, prisma);
    await fund(app, other.id, 5000);
    const mine = await bet('m1-1x2-home', '2.10');
    const theirs = await bet('m1-1x2-away', '3.40', '5.00', other.cookie);
    const goals = await bet('m1-goals-over', '1.85');
    const elsewhere = await bet('m4-1x2-home', '2.00');

    await settle(result1x2('m1', 'home'));

    const status = async (id: string) =>
      (await prisma.bet.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(mine.id)).toBe('WON');
    expect(await status(theirs.id)).toBe('LOST');
    expect(await status(goals.id)).toBe('OPEN');
    expect(await status(elsewhere.id)).toBe('OPEN');
  });

  it('un resultado sin apuestas se registra sin efectos', async () => {
    await settle(result1x2('m5', 'away'));
    expect(await prisma.matchEvent.count()).toBe(1);
    expect(await prisma.betSettlement.count()).toBe(0);
  });

  it('audita la liquidación como acción del sistema', async () => {
    const won = await bet('m1-1x2-home', '2.10');
    await settle(result1x2('m1', 'home'));
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'bet.settled' } });
    expect(log).toMatchObject({
      actorId: null,
      targetType: 'bet',
      targetId: won.id,
      ip: 'system',
      userAgent: 'worker',
      metadata: expect.objectContaining({ outcome: 'WON', payout: 2100, version: 1 }),
    });
  });

  it('el historial muestra la apuesta liquidada', async () => {
    await bet('m1-1x2-home', '2.10');
    await settle(result1x2('m1', 'home'));
    const res = await import('supertest').then(({ default: request }) =>
      request(app.getHttpServer()).get('/bets?status=SETTLED').set('Cookie', user.cookie),
    );
    expect(res.body.items[0]).toMatchObject({ status: 'WON', payout: '21.00' });
    expect(res.body.items[0].settledAt).not.toBeNull();
  });
});
