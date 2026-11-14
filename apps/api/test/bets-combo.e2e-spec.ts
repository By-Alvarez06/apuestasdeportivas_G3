import type { NestExpressApplication } from '@nestjs/platform-express';
import { BettingSettingsService } from '../src/betting/settings.service';
import type { PrismaClient } from '../src/generated/prisma/client';
import {
  balances,
  type BetBody,
  type BetView,
  catalogOf,
  fund,
  placeBet,
  processed,
  publish,
  result1x2,
  setSetting,
} from './bets.helpers';
import { createTestApp, createTestPrisma, drainQueues, resetDatabase, signedInUser } from './setup';

describe('US3 · Apuestas combinadas (T043)', () => {
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
    const catalog = catalogOf(app);
    catalog.reset();
    // Tres partidos distintos con cuotas 1.50, 2.00 y 1.80.
    catalog.setOdds('m1-1x2-home', 150);
    catalog.setOdds('m4-1x2-home', 200);
    catalog.setOdds('m5-1x2-home', 180);
    user = await signedInUser(app, prisma);
    await fund(app, user.id, 5000);
  });

  const threeWay: BetBody = {
    selections: [
      { selectionId: 'm1-1x2-home', odds: '1.50' },
      { selectionId: 'm4-1x2-home', odds: '2.00' },
      { selectionId: 'm5-1x2-home', odds: '1.80' },
    ],
    stake: '10.00',
  };

  const settle = async (event: ReturnType<typeof result1x2>) => {
    await publish(app, event);
    await processed(prisma, event.sourceEventId);
  };

  const noBets = async () => {
    expect(await prisma.bet.count()).toBe(0);
    expect((await balances(app, user.id)).real).toBe(5000);
  };

  it('escenario 1: acepta la combinada con la cuota total congelada y un solo débito', async () => {
    const res = await placeBet(app, user.cookie, threeWay).expect(201);
    expect(res.body as BetView).toMatchObject({
      type: 'COMBO',
      status: 'OPEN',
      stake: '10.00',
      totalOdds: '5.40',
      potentialPayout: '54.00',
    });
    expect((res.body as BetView).selections).toHaveLength(3);
    expect(await prisma.ledgerTransaction.count({ where: { type: 'BET_DEBIT' } })).toBe(1);
    expect((await balances(app, user.id)).real).toBe(4000);
  });

  it('escenario 2: no deja combinar dos selecciones del mismo partido', async () => {
    const res = await placeBet(app, user.cookie, {
      selections: [
        { selectionId: 'm1-1x2-home', odds: '1.50' },
        { selectionId: 'm1-goals-over', odds: '1.85' },
      ],
      stake: '10.00',
    }).expect(400);
    expect(res.body.error.message).toMatch(/partidos distintos/);
    await noBets();
  });

  it('no deja repetir una selección', async () => {
    await placeBet(app, user.cookie, {
      selections: [
        { selectionId: 'm1-1x2-home', odds: '1.50' },
        { selectionId: 'm1-1x2-home', odds: '1.50' },
      ],
      stake: '10.00',
    }).expect(400);
    await noBets();
  });

  it('respeta el máximo de selecciones configurado', async () => {
    await setSetting(app, 'combo.maxSelections', 2);
    const res = await placeBet(app, user.cookie, threeWay).expect(400);
    expect(res.body.error.message).toMatch(/como máximo 2/);
    await noBets();
  });

  it('escenario 5: si cambió la cuota de una sola selección, no acepta nada', async () => {
    catalogOf(app).setOdds('m4-1x2-home', 190);
    const res = await placeBet(app, user.cookie, threeWay).expect(409);
    expect(res.body.error).toMatchObject({
      code: 'ODDS_CHANGED',
      details: { quotes: [{ selectionId: 'm4-1x2-home', odds: '1.90' }] },
    });
    await noBets();
  });

  it('aplica la ganancia máxima al pago de la combinada', async () => {
    await setSetting(app, 'limits.maxPayout', 5000);
    const res = await placeBet(app, user.cookie, threeWay).expect(422);
    // 50.00 / 5.40 = 9.259… → 9.25
    expect(res.body.error).toMatchObject({ code: 'PAYOUT_LIMIT', details: { maxStake: '9.25' } });
  });

  it('escenario 3: se liquida como perdida en cuanto pierde una selección', async () => {
    const bet = (await placeBet(app, user.cookie, threeWay).expect(201)).body as BetView;

    await settle(result1x2('m1', 'away'));
    const lost = await prisma.bet.findUniqueOrThrow({
      where: { id: bet.id },
      include: { selections: true },
    });
    expect(lost).toMatchObject({ status: 'LOST', payout: 0, settledVersion: 1 });
    expect(lost.settledAt).not.toBeNull();
    expect(lost.selections.filter((s) => s.status === 'PENDING')).toHaveLength(2);

    // Los resultados posteriores se registran en sus selecciones (historial y re-liquidación),
    // pero no cambian la apuesta ya liquidada ni mueven dinero.
    await settle(result1x2('m4', 'home'));
    const after = await prisma.bet.findUniqueOrThrow({
      where: { id: bet.id },
      include: { selections: true },
    });
    expect(after).toMatchObject({ status: 'LOST', settledVersion: 1 });
    expect(after.selections.find((s) => s.matchId === 'm4')!.status).toBe('WON');
    expect(await prisma.betSettlement.count()).toBe(1);
    expect((await balances(app, user.id)).real).toBe(4000);
  });

  it('escenario 4: gana cuando ganan todas y paga monto × cuota total congelada', async () => {
    const bet = (await placeBet(app, user.cookie, threeWay).expect(201)).body as BetView;
    // Las cuotas cambian después de aceptar: no afecta al pago.
    catalogOf(app).setOdds('m1-1x2-home', 300);

    await settle(result1x2('m1', 'home'));
    await settle(result1x2('m4', 'home'));
    const partial = await prisma.bet.findUniqueOrThrow({
      where: { id: bet.id },
      include: { selections: true },
    });
    expect(partial.status).toBe('OPEN');
    expect(partial.selections.filter((s) => s.status === 'WON')).toHaveLength(2);
    expect((await balances(app, user.id)).real).toBe(4000);

    await settle(result1x2('m5', 'home'));
    expect(await prisma.bet.findUniqueOrThrow({ where: { id: bet.id } })).toMatchObject({
      status: 'WON',
      payout: 5400,
      settledVersion: 1,
    });
    expect((await balances(app, user.id)).real).toBe(4000 + 5400);
    expect(await prisma.betSettlement.count()).toBe(1);
  });
});
