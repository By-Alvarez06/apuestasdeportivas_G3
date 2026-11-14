import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  MarketStatus as PublicMarketStatus,
  MarketType as PublicMarketType,
  MatchStatus as PublicMatchStatus,
} from '@apuestas/shared';
import type { PrismaClient } from '../src/generated/prisma/client';
import { MarketStatus, OddsSource, Role, UserStatus } from '../src/generated/prisma/enums';
import { createTestApp, createTestPrisma, resetDatabase, signedInUser, WEB_ORIGIN } from './setup';

describe('Partidos y mercados (spec 3)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let operatorCookie: string;

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
    operatorCookie = (
      await signedInUser(app, prisma, { role: Role.OPERATOR, status: UserStatus.ACTIVE })
    ).cookie;
  });

  const post = (path: string, body: object, cookie?: string) => {
    const req = request(app.getHttpServer()).post(path).set('Origin', WEB_ORIGIN).send(body);
    return cookie ? req.set('Cookie', cookie) : req;
  };

  const patch = (path: string, body: object, cookie: string) =>
    request(app.getHttpServer())
      .patch(path)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', cookie)
      .send(body);

  async function createMatch(cookie = operatorCookie): Promise<string> {
    const response = await post(
      '/operator/matches',
      {
        homeTeamName: 'Quito FC',
        awayTeamName: 'Cuenca SC',
        kickoffAt: '2027-01-20T20:00:00.000Z',
      },
      cookie,
    ).expect(201);
    expect(response.body.status).toBe(PublicMatchStatus.SCHEDULED);
    return response.body.id as string;
  }

  async function createResultMarket(matchId: string): Promise<string> {
    const response = await post(
      `/operator/matches/${matchId}/markets`,
      {
        type: PublicMarketType.RESULT_1X2,
        selections: [
          { key: 'HOME', odds: '2.10' },
          { key: 'DRAW', odds: '3.20' },
          { key: 'AWAY', odds: '3.40' },
        ],
      },
      operatorCookie,
    ).expect(201);
    return response.body.id as string;
  }

  it('publica partidos y solo las cuotas manuales vigentes cuando existe una externa', async () => {
    const matchId = await createMatch();
    const marketId = await createResultMarket(matchId);
    await post(
      `/operator/matches/${matchId}/markets`,
      {
        type: PublicMarketType.RESULT_1X2,
        selections: [
          { key: 'HOME', odds: '2.10' },
          { key: 'DRAW', odds: '3.20' },
          { key: 'AWAY', odds: '3.40' },
        ],
      },
      operatorCookie,
    ).expect(409);
    const manual = await prisma.selection.findFirstOrThrow({
      where: { marketId, key: 'HOME', source: OddsSource.MANUAL },
    });
    await prisma.selection.create({
      data: {
        marketId,
        key: 'HOME',
        label: 'Local',
        source: OddsSource.API_FOOTBALL,
        odds: '2.50',
      },
    });

    const publicResponse = await request(app.getHttpServer())
      .get(`/matches/${matchId}`)
      .expect(200);
    expect(publicResponse.body.markets[0].status).toBe(PublicMarketStatus.OPEN);
    expect(publicResponse.body.markets[0].selections).toContainEqual(
      expect.objectContaining({
        key: 'HOME',
        odds: '2.100',
        source: OddsSource.MANUAL,
      }),
    );
    expect(
      publicResponse.body.markets[0].selections.filter(
        (selection: { key: string }) => selection.key === 'HOME',
      ),
    ).toHaveLength(1);

    const operatorResponse = await request(app.getHttpServer())
      .get(`/operator/matches/${matchId}`)
      .set('Cookie', operatorCookie)
      .expect(200);
    expect(
      operatorResponse.body.markets[0].selections.filter(
        (selection: { key: string }) => selection.key === 'HOME',
      ),
    ).toHaveLength(2);
    expect(manual.odds.toFixed(3)).toBe('2.100');
  });

  it('audita cambios manuales de cuota y conserva cada valor anterior', async () => {
    const matchId = await createMatch();
    const marketId = await createResultMarket(matchId);
    await patch(`/operator/markets/${marketId}/odds`, { key: 'HOME', odds: '2.25' }, operatorCookie)
      .expect(200)
      .expect(({ body }) => expect(body.odds).toBe('2.250'));

    const history = await prisma.oddsHistory.findMany({
      where: { selection: { marketId, key: 'HOME', source: OddsSource.MANUAL } },
      orderBy: { createdAt: 'asc' },
    });
    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.previousOdds?.toFixed(3) ?? null)).toEqual([null, '2.100']);
    expect(await prisma.auditLog.count({ where: { action: 'match.odds.manual.changed' } })).toBe(1);
    await expect(
      prisma.oddsHistory.update({
        where: { id: history[0]!.id },
        data: { newOdds: '3.00' },
      }),
    ).rejects.toThrow();
  });

  it('deniega gestión a visitantes y apostadores', async () => {
    await post('/operator/matches', {
      homeTeamName: 'Quito FC',
      awayTeamName: 'Cuenca SC',
      kickoffAt: '2027-01-20T20:00:00.000Z',
    }).expect(401);

    const bettorCookie = (
      await signedInUser(app, prisma, { role: Role.BETTOR, status: UserStatus.ACTIVE })
    ).cookie;
    await post(
      '/operator/matches',
      {
        homeTeamName: 'Quito FC',
        awayTeamName: 'Cuenca SC',
        kickoffAt: '2027-01-20T20:00:00.000Z',
      },
      bettorCookie,
    ).expect(403);
  });

  it('valida estados, marcador final y cierre de mercados', async () => {
    const matchId = await createMatch();
    const marketId = await createResultMarket(matchId);
    const adminCookie = (
      await signedInUser(app, prisma, { role: Role.ADMIN, status: UserStatus.ACTIVE })
    ).cookie;

    await patch(
      `/operator/matches/${matchId}/status`,
      {
        status: PublicMatchStatus.FINISHED,
        homeScore: 1,
        awayScore: 0,
        reason: 'Resultado confirmado antes de iniciar el partido',
      },
      operatorCookie,
    ).expect(409);

    await patch(
      `/operator/matches/${matchId}/status`,
      { status: PublicMatchStatus.LIVE },
      operatorCookie,
    ).expect(200);

    await patch(
      `/operator/matches/${matchId}/status`,
      { status: PublicMatchStatus.FINISHED },
      operatorCookie,
    ).expect(400);

    await patch(
      `/operator/matches/${matchId}/status`,
      {
        status: PublicMatchStatus.FINISHED,
        homeScore: 1,
        awayScore: 0,
        reason: 'Resultado confirmado por el administrador',
      },
      adminCookie,
    ).expect(200);
    expect(
      await prisma.market.findUniqueOrThrow({ where: { id: marketId }, select: { status: true } }),
    ).toEqual({ status: MarketStatus.CLOSED });
  });

  it('requiere a un administrador y motivo para corregir un estado terminal', async () => {
    const matchId = await createMatch();
    const adminCookie = (
      await signedInUser(app, prisma, { role: Role.ADMIN, status: UserStatus.ACTIVE })
    ).cookie;
    await patch(
      `/operator/matches/${matchId}/status`,
      { status: PublicMatchStatus.CANCELLED, reason: 'Cancelación confirmada' },
      adminCookie,
    ).expect(200);

    await patch(
      `/operator/matches/${matchId}/status`,
      { status: PublicMatchStatus.SCHEDULED },
      adminCookie,
    ).expect(409);
    await patch(
      `/operator/matches/${matchId}/status`,
      { status: PublicMatchStatus.SCHEDULED, reason: 'La cancelación fue un error' },
      adminCookie,
    ).expect(200);
  });

  it('suspende los mercados con partidos aplazados y no los reabre al reprogramar', async () => {
    const matchId = await createMatch();
    const marketId = await createResultMarket(matchId);
    await patch(
      `/operator/matches/${matchId}/status`,
      { status: PublicMatchStatus.POSTPONED },
      operatorCookie,
    ).expect(200);
    await patch(
      `/operator/matches/${matchId}/status`,
      { status: PublicMatchStatus.SCHEDULED },
      operatorCookie,
    ).expect(200);

    const market = await prisma.market.findUniqueOrThrow({
      where: { id: marketId },
      select: { status: true },
    });
    expect(market.status).toBe(MarketStatus.SUSPENDED);
    await patch(
      `/operator/markets/${marketId}/status`,
      { status: PublicMarketStatus.OPEN },
      operatorCookie,
    ).expect(200);
  });

  it('no publica partidos cancelados ni siquiera cuando se filtra explícitamente por ese estado', async () => {
    const matchId = await createMatch();
    const adminCookie = (
      await signedInUser(app, prisma, { role: Role.ADMIN, status: UserStatus.ACTIVE })
    ).cookie;
    await patch(
      `/operator/matches/${matchId}/status`,
      { status: PublicMatchStatus.CANCELLED, reason: 'Cancelación oficial' },
      adminCookie,
    ).expect(200);

    await request(app.getHttpServer())
      .get('/matches')
      .query({ status: PublicMatchStatus.CANCELLED })
      .expect(200)
      .expect(({ body }) => expect(body.total).toBe(0));
    await request(app.getHttpServer()).get(`/matches/${matchId}`).expect(404);
  });
});
