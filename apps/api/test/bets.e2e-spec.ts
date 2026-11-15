import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { BettingSettingsService } from '../src/betting/settings.service';
import type { PrismaClient } from '../src/generated/prisma/client';
import { LedgerTransactionType, Role } from '../src/generated/prisma/enums';
import {
  balances,
  type BetView,
  catalogOf,
  fund,
  placeBet,
  setSetting,
  single,
} from './bets.helpers';
import {
  createTestApp,
  createTestPrisma,
  drainQueues,
  resetDatabase,
  signedInUser,
  WEB_ORIGIN,
} from './setup';

describe('US1 · Apuesta simple con saldo y cuota garantizados (T020)', () => {
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
    await resetDatabase(prisma);
    await drainQueues();
    app.get(BettingSettingsService).clearCache();
    catalogOf(app).reset();
    user = await signedInUser(app, prisma);
  });

  const noBetsNorDebits = async () => {
    expect(await prisma.bet.count()).toBe(0);
    expect(await prisma.ledgerTransaction.count({ where: { type: 'BET_DEBIT' } })).toBe(0);
  };

  it('escenario 1: acepta la apuesta, congela la cuota y descuenta el monto', async () => {
    await fund(app, user.id, 5000);

    const res = await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '10.00')).expect(
      201,
    );
    const bet = res.body as BetView;

    expect(bet).toMatchObject({
      type: 'SINGLE',
      status: 'OPEN',
      stake: '10.00',
      source: 'REAL',
      totalOdds: '2.10',
      potentialPayout: '21.00',
      payout: '0.00',
      live: false,
      settledAt: null,
    });
    expect(bet.selections).toEqual([
      expect.objectContaining({
        selectionId: 'm1-1x2-home',
        matchLabel: 'Liga Pro · Barcelona SC vs Emelec',
        marketLabel: 'Resultado final',
        selectionLabel: 'Barcelona SC',
        odds: '2.10',
        status: 'PENDING',
      }),
    ]);
    expect((await balances(app, user.id)).real).toBe(4000);

    const debit = await prisma.ledgerTransaction.findFirstOrThrow({
      where: { type: LedgerTransactionType.BET_DEBIT },
    });
    expect(debit).toMatchObject({ referenceType: 'bet', referenceId: bet.id });

    // La cuota queda congelada aunque el mercado cambie después.
    catalogOf(app).setOdds('m1-1x2-home', 150);
    const again = await request(app.getHttpServer())
      .get(`/bets/${bet.id}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect((again.body as BetView).selections[0]!.odds).toBe('2.10');
  });

  it('escenario 2: sin saldo suficiente no crea apuesta ni movimiento', async () => {
    await fund(app, user.id, 500);
    const res = await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '10.00')).expect(
      422,
    );
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    await noBetsNorDebits();
    expect((await balances(app, user.id)).real).toBe(500);
  });

  it('escenario 3: si la cuota cambió, rechaza y devuelve la nueva para reconfirmar', async () => {
    await fund(app, user.id, 5000);
    catalogOf(app).setOdds('m1-1x2-home', 195);

    const res = await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '10.00')).expect(
      409,
    );
    expect(res.body.error.code).toBe('ODDS_CHANGED');
    expect(res.body.error.details).toEqual({
      quotes: [{ selectionId: 'm1-1x2-home', odds: '1.95' }],
    });
    await noBetsNorDebits();

    const reconfirmed = await placeBet(
      app,
      user.cookie,
      single('m1-1x2-home', '1.95', '10.00'),
    ).expect(201);
    expect((reconfirmed.body as BetView).potentialPayout).toBe('19.50');
  });

  it('escenario 4: rechaza apuestas pre-partido cuando el partido ya empezó por el reloj del servidor', async () => {
    await fund(app, user.id, 5000);
    // m3 empezó hace 10 minutos pero su mercado sigue figurando abierto.
    const res = await placeBet(app, user.cookie, single('m3-1x2-home', '1.90', '10.00')).expect(
      409,
    );
    expect(res.body.error.code).toBe('MATCH_STARTED');
    await noBetsNorDebits();
  });

  it('rechaza mercados que no están abiertos', async () => {
    await fund(app, user.id, 5000);
    const closed = await placeBet(
      app,
      user.cookie,
      single('m2-first-goal-home', '1.60', '10.00'),
    ).expect(409);
    expect(closed.body.error.code).toBe('MARKET_CLOSED');

    catalogOf(app).setMarketStatus('m1-1x2', 'SUSPENDED');
    const suspended = await placeBet(
      app,
      user.cookie,
      single('m1-1x2-home', '2.10', '10.00'),
    ).expect(409);
    expect(suspended.body.error.code).toBe('MARKET_CLOSED');
    await noBetsNorDebits();
  });

  it('responde 404 si la selección no existe', async () => {
    await fund(app, user.id, 5000);
    const res = await placeBet(app, user.cookie, single('no-existe', '2.00', '10.00')).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('escenario 7: aplica el mínimo y el máximo por apuesta', async () => {
    await fund(app, user.id, 100_000);
    for (const stake of ['0.10', '600.00']) {
      const res = await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', stake)).expect(
        422,
      );
      expect(res.body.error).toMatchObject({
        code: 'STAKE_OUT_OF_LIMITS',
        details: { min: '0.50', max: '500.00' },
      });
    }
    await noBetsNorDebits();
    await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '0.50')).expect(201);
    await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '500.00')).expect(201);
  });

  it('rechaza una ganancia potencial sobre el máximo e indica el monto máximo apostable', async () => {
    await fund(app, user.id, 5000);
    await setSetting(app, 'limits.maxPayout', 1000);
    const res = await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '10.00')).expect(
      422,
    );
    // 10.00 / 2.10 = 4.7619… → 4.76
    expect(res.body.error).toMatchObject({ code: 'PAYOUT_LIMIT', details: { maxStake: '4.76' } });
    await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '4.76')).expect(201);
  });

  it('aplica el límite diario de monto apostado por usuario', async () => {
    await fund(app, user.id, 5000);
    await setSetting(app, 'limits.dailyStakePerUser', 1500);
    await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '10.00')).expect(201);
    const res = await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '10.00')).expect(
      422,
    );
    expect(res.body.error.code).toBe('DAILY_LIMIT');
    await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '5.00')).expect(201);

    const limits = await request(app.getHttpServer())
      .get('/betting/limits')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(limits.body).toMatchObject({ dailyStakePerUser: '15.00', dailyStakeUsed: '15.00' });
  });

  it('una apuesta pagada con saldo de bono descuenta del bono', async () => {
    await fund(app, user.id, 2000, 'BONUS');
    await placeBet(app, user.cookie, {
      ...single('m1-1x2-home', '2.10', '10.00'),
      source: 'BONUS',
    }).expect(201);
    expect(await balances(app, user.id)).toMatchObject({ real: 0, bonus: 1000 });
  });

  it('valida el cuerpo: monto, cuota, origen y campos desconocidos', async () => {
    await fund(app, user.id, 5000);
    const bad = [
      single('m1-1x2-home', '2.10', '10'),
      single('m1-1x2-home', '2.10', '-1.00'),
      single('m1-1x2-home', '2,10', '10.00'),
      { ...single('m1-1x2-home', '2.10', '10.00'), source: 'CASA' },
      { ...single('m1-1x2-home', '2.10', '10.00'), potentialPayout: '1000.00' },
      { selections: [], stake: '10.00' },
    ];
    for (const body of bad)
      await placeBet(app, user.cookie, body as Parameters<typeof placeBet>[2]).expect(400);
    await noBetsNorDebits();
  });

  it('exige Idempotency-Key, sesión y rol de apostador', async () => {
    const body = single('m1-1x2-home', '2.10', '10.00');
    await request(app.getHttpServer())
      .post('/bets')
      .set('Cookie', user.cookie)
      .set('Origin', WEB_ORIGIN)
      .send({ ...body, source: 'REAL' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/bets')
      .set('Origin', WEB_ORIGIN)
      .set('Idempotency-Key', 'sin-sesion-1')
      .send(body)
      .expect(401);
    const operator = await signedInUser(app, prisma, { role: Role.OPERATOR });
    await placeBet(app, operator.cookie, body).expect(403);
  });

  it('escenario 8: nadie puede modificar ni eliminar una apuesta aceptada', async () => {
    await fund(app, user.id, 5000);
    const { body } = await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '10.00'));
    const bet = body as BetView;
    const admin = await signedInUser(app, prisma, { role: Role.ADMIN });
    for (const cookie of [user.cookie, admin.cookie]) {
      for (const method of ['put', 'patch', 'delete'] as const) {
        const agent = request(app.getHttpServer());
        await agent[method](`/bets/${bet.id}`)
          .set('Cookie', cookie)
          .set('Origin', WEB_ORIGIN)
          .send({ stake: '1.00' })
          .expect(404);
      }
    }
    expect(await prisma.bet.findUniqueOrThrow({ where: { id: bet.id } })).toMatchObject({
      stake: 1000,
      potentialPayout: 2100,
    });
  });

  it('el historial muestra solo las apuestas propias, paginadas y filtradas', async () => {
    await fund(app, user.id, 5000);
    const other = await signedInUser(app, prisma);
    await fund(app, other.id, 5000);
    const mine = await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '10.00'));
    await placeBet(app, user.cookie, single('m4-1x2-home', '2.00', '5.00'));
    const theirs = await placeBet(app, other.cookie, single('m1-1x2-away', '3.40', '1.00'));

    const list = await request(app.getHttpServer())
      .get('/bets?status=OPEN&page=1&pageSize=1')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(list.body).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    expect(list.body.items).toHaveLength(1);
    // Más reciente primero.
    expect(list.body.items[0].stake).toBe('5.00');

    const settled = await request(app.getHttpServer())
      .get('/bets?status=SETTLED')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(settled.body.total).toBe(0);

    await request(app.getHttpServer())
      .get(`/bets/${(mine.body as BetView).id}`)
      .set('Cookie', user.cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/bets/${(theirs.body as BetView).id}`)
      .set('Cookie', user.cookie)
      .expect(404);
  });

  it('audita la apuesta aceptada y los rechazos por seguridad', async () => {
    await fund(app, user.id, 5000);
    const { body } = await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '10.00'));
    catalogOf(app).setOdds('m1-1x2-home', 300);
    await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '10.00')).expect(409);
    await placeBet(app, user.cookie, single('m3-1x2-home', '1.90', '10.00')).expect(409);

    const placed = await prisma.auditLog.findFirstOrThrow({ where: { action: 'bet.placed' } });
    expect(placed).toMatchObject({
      actorId: user.id,
      targetType: 'bet',
      targetId: (body as BetView).id,
      ip: expect.any(String),
      userAgent: expect.any(String),
    });
    const rejected = await prisma.auditLog.findMany({ where: { action: 'bet.rejected' } });
    expect(rejected.map((r) => (r.metadata as { reason: string }).reason).sort()).toEqual([
      'MATCH_STARTED',
      'ODDS_CHANGED',
    ]);
  });
});
