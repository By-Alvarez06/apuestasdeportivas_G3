import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { BettingSettingsService } from '../src/betting/settings.service';
import type { MatchEventJob } from '../src/catalog/match-catalog.port';
import type { PrismaClient } from '../src/generated/prisma/client';
import { LedgerTransactionType } from '../src/generated/prisma/enums';
import { DebtService } from '../src/settlement/debt.service';
import { WithdrawalsService } from '../src/withdrawals/withdrawals.service';
import {
  balances,
  type BetView,
  catalogOf,
  correction1x2,
  fund,
  placeBet,
  processed,
  publish,
  result1x2,
  single,
} from './bets.helpers';
import { createTestApp, createTestPrisma, drainQueues, resetDatabase, signedInUser } from './setup';

describe('US4 · Re-liquidación por corrección de resultado y saldo adeudado (T048)', () => {
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
  });

  const send = async (event: MatchEventJob) => {
    await publish(app, event);
    await processed(prisma, event.sourceEventId);
  };

  const bet = async (selectionId: string, odds: string, stake: string) =>
    (await placeBet(app, user.cookie, single(selectionId, odds, stake)).expect(201))
      .body as BetView;

  const betRow = (id: string) => prisma.bet.findUniqueOrThrow({ where: { id } });

  it('ganada → perdida: revierte el pago y lo audita con el resultado anterior y el nuevo', async () => {
    await fund(app, user.id, 5000);
    const b = await bet('m1-1x2-home', '2.10', '10.00');
    await send(result1x2('m1', 'home'));
    expect((await balances(app, user.id)).real).toBe(6100);

    await send(correction1x2('m1', 'draw'));

    expect(await betRow(b.id)).toMatchObject({ status: 'LOST', payout: 0, settledVersion: 2 });
    expect((await balances(app, user.id)).real).toBe(4000);
    const v2 = await prisma.betSettlement.findUniqueOrThrow({
      where: { betId_version: { betId: b.id, version: 2 } },
    });
    expect(v2).toMatchObject({ outcome: 'LOST', payout: 0, reversedAmount: 2100 });
    expect(
      await prisma.ledgerTransaction.count({ where: { type: LedgerTransactionType.BET_REVERSAL } }),
    ).toBe(1);

    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'bet.resettled' } });
    expect(log).toMatchObject({
      actorId: null,
      targetId: b.id,
      metadata: expect.objectContaining({
        previousOutcome: 'WON',
        previousPayout: 2100,
        outcome: 'LOST',
        payout: 0,
        version: 2,
        reversed: 2100,
        debt: 0,
      }),
    });
  });

  it('perdida → ganada: paga una sola vez', async () => {
    await fund(app, user.id, 5000);
    const b = await bet('m1-1x2-draw', '3.20', '10.00');
    await send(result1x2('m1', 'home'));
    await send(correction1x2('m1', 'draw'));
    expect(await betRow(b.id)).toMatchObject({ status: 'WON', payout: 3200, settledVersion: 2 });
    expect((await balances(app, user.id)).real).toBe(4000 + 3200);
  });

  it('la misma corrección repetida 10 veces tiene un solo efecto', async () => {
    await fund(app, user.id, 5000);
    const b = await bet('m1-1x2-home', '2.10', '10.00');
    await send(result1x2('m1', 'home'));
    const fix = correction1x2('m1', 'draw', 'correccion-unica');
    for (let i = 0; i < 10; i++) await send(fix);
    // La fuente reenvía la misma corrección con otro id: el resultado ya es ese, no cambia nada.
    await send(correction1x2('m1', 'draw'));

    expect(await betRow(b.id)).toMatchObject({ status: 'LOST', settledVersion: 2 });
    expect(await prisma.betSettlement.count({ where: { betId: b.id } })).toBe(2);
    expect((await balances(app, user.id)).real).toBe(4000);
  });

  it('corregir dos veces vuelve al resultado original con una versión nueva cada vez', async () => {
    await fund(app, user.id, 5000);
    const b = await bet('m1-1x2-home', '2.10', '10.00');
    await send(result1x2('m1', 'home'));
    await send(correction1x2('m1', 'away'));
    await send(correction1x2('m1', 'home'));
    expect(await betRow(b.id)).toMatchObject({ status: 'WON', payout: 2100, settledVersion: 3 });
    expect((await balances(app, user.id)).real).toBe(6100);
  });

  it('una corrección antes de liquidar se aplica como resultado normal', async () => {
    await fund(app, user.id, 5000);
    const b = await bet('m1-1x2-home', '2.10', '10.00');
    await send(correction1x2('m1', 'home'));
    expect(await betRow(b.id)).toMatchObject({ status: 'WON', payout: 2100, settledVersion: 1 });
  });

  describe('si la reversión supera el saldo disponible', () => {
    /** Gana 21.00, apuesta 20.00 de eso y luego le corrigen el resultado. */
    async function owes20() {
      await fund(app, user.id, 1000);
      const won = await bet('m1-1x2-home', '2.10', '10.00');
      await send(result1x2('m1', 'home'));
      await bet('m4-1x2-home', '2.00', '20.00');
      expect((await balances(app, user.id)).real).toBe(100);
      await send(correction1x2('m1', 'draw'));
      return won;
    }

    it('no deja saldo negativo: debita lo disponible y registra el resto como deuda', async () => {
      const won = await owes20();
      expect((await balances(app, user.id)).real).toBe(0);
      const debt = await prisma.betDebt.findFirstOrThrow({ where: { userId: user.id } });
      expect(debt).toMatchObject({ betId: won.id, amount: 2000, collected: 0, closedAt: null });
      expect(
        await prisma.auditLog.count({ where: { action: 'debt.created', targetId: debt.id } }),
      ).toBe(1);
    });

    it('bloquea nuevas apuestas y retiros mientras haya deuda', async () => {
      await owes20();
      await fund(app, user.id, 500);
      const res = await placeBet(app, user.cookie, single('m5-1x2-home', '1.80', '1.00')).expect(
        423,
      );
      expect(res.body.error.code).toBe('DEBT_OUTSTANDING');
      await expect(
        app
          .get(WithdrawalsService)
          // El bloqueo va antes del 2FA y del titular: no hace falta un retiro completo.
          .request(user.id, { amount: '1.00' } as never, 'retiro-con-deuda-1', {
            ip: '127.0.0.1',
            userAgent: 'jest',
          }),
      ).rejects.toMatchObject({ code: 'DEBT_OUTSTANDING' });

      const limits = await request(app.getHttpServer())
        .get('/betting/limits')
        .set('Cookie', user.cookie)
        .expect(200);
      expect(limits.body.openDebt).toBe('20.00');
    });

    it('cobra la deuda con los créditos posteriores y luego desbloquea', async () => {
      await owes20();
      await fund(app, user.id, 1500);
      await app.get(DebtService).collect();
      let debt = await prisma.betDebt.findFirstOrThrow({ where: { userId: user.id } });
      expect(debt).toMatchObject({ collected: 1500, closedAt: null });
      expect((await balances(app, user.id)).real).toBe(0);

      await fund(app, user.id, 2000);
      await app.get(DebtService).collect();
      debt = await prisma.betDebt.findFirstOrThrow({ where: { userId: user.id } });
      expect(debt.collected).toBe(2000);
      expect(debt.closedAt).not.toBeNull();
      expect((await balances(app, user.id)).real).toBe(1500);
      // Cobrar otra vez no hace nada.
      await app.get(DebtService).collect();
      expect((await balances(app, user.id)).real).toBe(1500);
      expect(
        await prisma.ledgerTransaction.count({
          where: { type: LedgerTransactionType.DEBT_COLLECTION },
        }),
      ).toBe(2);

      await placeBet(app, user.cookie, single('m5-1x2-home', '1.80', '1.00')).expect(201);
    });
  });
});
