import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { BettingSettingsService } from '../src/betting/settings.service';
import type { MatchEventJob } from '../src/catalog/match-catalog.port';
import type { PrismaClient } from '../src/generated/prisma/client';
import { LedgerTransactionType, Role } from '../src/generated/prisma/enums';
import { HoldsService } from '../src/settlement/holds.service';
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
  single,
  statusEvent,
} from './bets.helpers';
import { createTestApp, createTestPrisma, drainQueues, resetDatabase, signedInUser } from './setup';

const HOUR = 3_600_000;

describe('US4 · Partidos suspendidos, aplazados y cancelados (T047, SC-006)', () => {
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
    catalog.setOdds('m1-1x2-home', 150);
    catalog.setOdds('m4-1x2-home', 200);
    catalog.setOdds('m5-1x2-home', 180);
    user = await signedInUser(app, prisma);
    await fund(app, user.id, 5000);
  });

  const send = async (event: MatchEventJob) => {
    await publish(app, event);
    await processed(prisma, event.sourceEventId);
  };

  const bet = async (body: BetBody) =>
    (await placeBet(app, user.cookie, body).expect(201)).body as BetView;

  const statusOf = async (id: string) =>
    prisma.bet.findUniqueOrThrow({ where: { id }, include: { selections: true } });

  const threeWay: BetBody = {
    selections: [
      { selectionId: 'm1-1x2-home', odds: '1.50' },
      { selectionId: 'm4-1x2-home', odds: '2.00' },
      { selectionId: 'm5-1x2-home', odds: '1.80' },
    ],
    stake: '10.00',
  };

  /** Ejecuta el vencimiento de plazos como si hubieran pasado `ms` desde ahora. */
  const expireAfter = (ms: number) => app.get(HoldsService).expireHolds(new Date(Date.now() + ms));

  it('escenario 1: suspendido y reanudado dentro del plazo, la apuesta se mantiene y se liquida', async () => {
    const b = await bet(single('m1-1x2-home', '1.50', '10.00'));
    await send(await statusEvent(app, 'm1', 'SUSPENDED'));
    expect(await prisma.matchHold.findUniqueOrThrow({ where: { matchId: 'm1' } })).toMatchObject({
      status: 'SUSPENDED',
      resolvedAt: null,
    });
    expect((await statusOf(b.id)).status).toBe('OPEN');

    await send(await statusEvent(app, 'm1', 'LIVE'));
    expect(await prisma.matchHold.findUniqueOrThrow({ where: { matchId: 'm1' } })).toMatchObject({
      resolution: 'RESUMED',
    });
    // Aunque luego pase el plazo, ya no se anula.
    await expireAfter(72 * HOUR);
    await send(result1x2('m1', 'home'));
    expect(await statusOf(b.id)).toMatchObject({ status: 'WON', payout: 1500 });
  });

  it('escenario 2: aplazado sin jugarse en plazo, se anula y se reembolsa al saldo de origen', async () => {
    await fund(app, user.id, 2000, 'BONUS');
    const real = await bet(single('m1-1x2-home', '1.50', '10.00'));
    const bonus = await bet({ ...single('m1-1x2-draw', '3.20', '5.00'), source: 'BONUS' });
    await send(await statusEvent(app, 'm1', 'POSTPONED'));

    // Antes del plazo (48 h desde el inicio programado) no pasa nada.
    await expireAfter(HOUR);
    expect((await statusOf(real.id)).status).toBe('OPEN');

    await expireAfter(51 * HOUR);
    expect(await statusOf(real.id)).toMatchObject({ status: 'VOID', payout: 1000 });
    expect(await statusOf(bonus.id)).toMatchObject({ status: 'VOID', payout: 500 });
    expect(await balances(app, user.id)).toMatchObject({ real: 5000, bonus: 2000 });
    expect(
      await prisma.ledgerTransaction.count({ where: { type: LedgerTransactionType.BET_REFUND } }),
    ).toBe(2);
    expect(await prisma.matchHold.findUniqueOrThrow({ where: { matchId: 'm1' } })).toMatchObject({
      resolution: 'VOIDED',
    });
  });

  it('el plazo es configurable', async () => {
    await setSetting(app, 'suspension.windowMs', HOUR);
    const b = await bet(single('m1-1x2-home', '1.50', '10.00'));
    await send(await statusEvent(app, 'm1', 'SUSPENDED'));
    // m1 empieza en 2 h: plazo = inicio + 1 h.
    await expireAfter(2 * HOUR + 30 * 60_000);
    expect((await statusOf(b.id)).status).toBe('OPEN');
    await expireAfter(3 * HOUR + 60_000);
    expect((await statusOf(b.id)).status).toBe('VOID');
  });

  it('escenario 3: cancelado, se anula y se reembolsa de inmediato', async () => {
    const b = await bet(single('m1-1x2-home', '1.50', '10.00'));
    await send(await statusEvent(app, 'm1', 'CANCELLED'));
    expect(await statusOf(b.id)).toMatchObject({ status: 'VOID', payout: 1000 });
    expect((await balances(app, user.id)).real).toBe(5000);
  });

  it('escenario 4: en una combinada, la selección anulada cuenta 1.00 y el resto sigue', async () => {
    const b = await bet(threeWay);
    await send(await statusEvent(app, 'm4', 'CANCELLED'));
    const afterCancel = await statusOf(b.id);
    expect(afterCancel.status).toBe('OPEN');
    expect(afterCancel.selections.find((s) => s.matchId === 'm4')!.status).toBe('VOID');

    await send(result1x2('m1', 'home'));
    await send(result1x2('m5', 'home'));
    // 10.00 × 1.50 × 1.00 × 1.80 = 27.00
    expect(await statusOf(b.id)).toMatchObject({ status: 'WON', payout: 2700 });
    expect((await balances(app, user.id)).real).toBe(4000 + 2700);
  });

  it('escenario 5: una combinada con todas sus selecciones anuladas se reembolsa', async () => {
    const b = await bet(threeWay);
    for (const m of ['m1', 'm4', 'm5']) await send(await statusEvent(app, m, 'CANCELLED'));
    expect(await statusOf(b.id)).toMatchObject({ status: 'VOID', payout: 1000 });
    expect((await balances(app, user.id)).real).toBe(5000);
  });

  it('escenario 6: los mercados resueltos antes de la suspensión se liquidan; el resto se anula', async () => {
    const goals = await bet(single('m1-goals-over', '1.85', '10.00'));
    const result = await bet(single('m1-1x2-home', '1.50', '10.00'));
    await send({
      type: 'MARKET_RESULTED',
      sourceEventId: 'primer-mercado',
      matchId: 'm1',
      marketId: 'm1-goals',
      results: { 'm1-goals-over': 'WON', 'm1-goals-under': 'LOST' },
      occurredAt: new Date().toISOString(),
    });
    await send(await statusEvent(app, 'm1', 'SUSPENDED'));
    await expireAfter(72 * HOUR);

    expect(await statusOf(goals.id)).toMatchObject({ status: 'WON', payout: 1850 });
    expect(await statusOf(result.id)).toMatchObject({ status: 'VOID', payout: 1000 });
    expect((await balances(app, user.id)).real).toBe(3000 + 1850 + 1000);
  });

  it('escenario 8: anulaciones repetidas reembolsan una sola vez', async () => {
    const b = await bet(single('m1-1x2-home', '1.50', '10.00'));
    await send(await statusEvent(app, 'm1', 'CANCELLED', 'cancelado-1'));
    await send(await statusEvent(app, 'm1', 'CANCELLED', 'cancelado-2'));
    await send(await statusEvent(app, 'm1', 'POSTPONED'));
    await expireAfter(72 * HOUR);
    await expireAfter(96 * HOUR);

    expect(await statusOf(b.id)).toMatchObject({ status: 'VOID', settledVersion: 1 });
    expect(await prisma.betSettlement.count({ where: { betId: b.id } })).toBe(1);
    expect((await balances(app, user.id)).real).toBe(5000);
  });

  it('un partido reanudado después del plazo no reactiva las apuestas anuladas', async () => {
    const b = await bet(single('m1-1x2-home', '1.50', '10.00'));
    await send(await statusEvent(app, 'm1', 'SUSPENDED'));
    await expireAfter(72 * HOUR);
    await send(await statusEvent(app, 'm1', 'LIVE'));
    await send(result1x2('m1', 'home'));

    expect(await statusOf(b.id)).toMatchObject({ status: 'VOID', payout: 1000 });
    expect(await prisma.matchHold.findUniqueOrThrow({ where: { matchId: 'm1' } })).toMatchObject({
      resolution: 'VOIDED',
    });
    expect((await balances(app, user.id)).real).toBe(5000);
  });

  it('audita la anulación como acción del sistema', async () => {
    const b = await bet(single('m1-1x2-home', '1.50', '10.00'));
    await send(await statusEvent(app, 'm1', 'CANCELLED'));
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'bet.voided' } });
    expect(log).toMatchObject({
      targetId: b.id,
      actorId: null,
      metadata: expect.objectContaining({ outcome: 'VOID', payout: 1000 }),
    });
  });

  describe('vista de partidos en espera (T052, FR-025)', () => {
    it('el operador ve el plazo y las apuestas en espera; el apostador no tiene acceso', async () => {
      await bet(single('m1-1x2-home', '1.50', '10.00'));
      await bet(threeWay);
      await send(await statusEvent(app, 'm1', 'SUSPENDED'));
      const operator = await signedInUser(app, prisma, { role: Role.OPERATOR });

      const res = await request(app.getHttpServer())
        .get('/operator/holds')
        .set('Cookie', operator.cookie)
        .expect(200);
      expect(res.body).toEqual([
        expect.objectContaining({
          matchId: 'm1',
          matchLabel: 'Liga Pro · Barcelona SC vs Emelec',
          status: 'SUSPENDED',
          deadline: expect.any(String),
          resolution: null,
          openBets: 2,
        }),
      ]);

      const bets = await request(app.getHttpServer())
        .get('/operator/bets?matchId=m1&status=OPEN')
        .set('Cookie', operator.cookie)
        .expect(200);
      expect(bets.body.total).toBe(2);
      expect(bets.body.items[0]).toEqual(expect.objectContaining({ userId: user.id }));

      await request(app.getHttpServer())
        .get('/operator/holds')
        .set('Cookie', user.cookie)
        .expect(403);
      await request(app.getHttpServer())
        .get('/operator/bets')
        .set('Cookie', user.cookie)
        .expect(403);
    });

    it('el apostador ve su selección en espera con el plazo', async () => {
      const b = await bet(single('m1-1x2-home', '1.50', '10.00'));
      await send(await statusEvent(app, 'm1', 'POSTPONED'));
      const res = await request(app.getHttpServer())
        .get(`/bets/${b.id}`)
        .set('Cookie', user.cookie)
        .expect(200);
      expect((res.body as BetView).selections[0]).toMatchObject({
        hold: { status: 'POSTPONED', deadline: expect.any(String) },
      });

      await send(await statusEvent(app, 'm1', 'LIVE'));
      const resumed = await request(app.getHttpServer())
        .get('/bets?status=OPEN')
        .set('Cookie', user.cookie)
        .expect(200);
      expect(resumed.body.items[0].selections[0].hold).toBeNull();
    });
  });
});
