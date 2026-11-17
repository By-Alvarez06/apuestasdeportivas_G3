import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  MarketStatus as PublicMarketStatus,
  MarketType as PublicMarketType,
  MatchStatus as PublicMatchStatus,
} from '@apuestas/shared';
import type { PrismaClient } from '../src/generated/prisma/client';
import {
  MarketStatus,
  MarketType as DbMarketType,
  MatchStatus as DbMatchStatus,
  OddsSource,
  Role,
  UserStatus,
} from '../src/generated/prisma/enums';
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

  async function createMatch(cookie = operatorCookie, competitionId?: string): Promise<string> {
    const response = await post(
      '/operator/matches',
      {
        homeTeamName: 'Quito FC',
        awayTeamName: 'Cuenca SC',
        kickoffAt: '2027-01-20T20:00:00.000Z',
        ...(competitionId ? { competitionId } : {}),
      },
      cookie,
    ).expect(201);
    expect(response.body.status).toBe(PublicMatchStatus.SCHEDULED);
    return response.body.id as string;
  }

  async function addExternalOdds(matchId: string): Promise<void> {
    const market = await prisma.market.create({
      data: { matchId, type: DbMarketType.TOTAL_GOALS, line: '2.5' },
    });
    await prisma.selection.create({
      data: {
        marketId: market.id,
        key: 'OVER',
        label: 'Más de 2.5',
        source: OddsSource.API_FOOTBALL,
        odds: '1.850',
      },
    });
  }

  it('permite editar competiciones y conserva la auditoría del cambio', async () => {
    const created = await post(
      '/operator/competitions',
      { name: 'Liga de Prueba', country: 'Ecuador' },
      operatorCookie,
    ).expect(201);
    await patch(
      `/operator/competitions/${created.body.id}`,
      { name: 'Liga Nacional', country: 'Ecuador' },
      operatorCookie,
    )
      .expect(200)
      .expect(({ body }) => expect(body.name).toBe('Liga Nacional'));

    expect(await prisma.auditLog.count({ where: { action: 'match.competition.updated' } })).toBe(1);
  });

  it('publica competiciones para filtrar la cartelera sin iniciar sesión', async () => {
    const competition = await post(
      '/operator/competitions',
      { name: 'Liga de Prueba', country: 'Ecuador' },
      operatorCookie,
    ).expect(201);
    const matchId = await createMatch(operatorCookie, competition.body.id as string);
    await addExternalOdds(matchId);
    await prisma.match.update({
      where: { id: matchId },
      data: { kickoffAt: new Date('2099-01-20T20:00:00.000Z') },
    });
    await request(app.getHttpServer())
      .get('/matches/competitions')
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual([
          expect.objectContaining({ name: 'Liga de Prueba', country: 'Ecuador', count: 1 }),
        ]),
      );
  });

  it('publica dos partidos en vivo aunque aún no tengan cuotas abiertas', async () => {
    const upcomingId = await createMatch();
    const liveId = await createMatch();
    const liveWithoutOddsId = await createMatch();
    const finishedId = await createMatch();
    const withoutOddsId = await createMatch();
    await Promise.all([upcomingId, liveId, finishedId].map(addExternalOdds));
    await prisma.match.updateMany({
      where: { id: { in: [liveId, liveWithoutOddsId] } },
      data: { kickoffAt: new Date(Date.now() - 60 * 60 * 1000), status: DbMatchStatus.LIVE },
    });
    await prisma.match.update({
      where: { id: finishedId },
      data: {
        kickoffAt: new Date('2026-11-12T20:00:00.000Z'),
        status: DbMatchStatus.FINISHED,
      },
    });

    const response = await request(app.getHttpServer()).get('/matches').expect(200);
    const ids = response.body.items.map((match: { id: string }) => match.id);
    expect(ids).toContain(upcomingId);
    expect(ids).toContain(liveId);
    expect(ids).toContain(liveWithoutOddsId);
    expect(ids).not.toContain(withoutOddsId);
    expect(ids).not.toContain(finishedId);
  });

  it('pagina todos los próximos partidos que tienen cuotas abiertas', async () => {
    const matchIds: string[] = [];
    for (let index = 0; index < 21; index += 1) {
      const matchId = await createMatch();
      matchIds.push(matchId);
      await addExternalOdds(matchId);
    }
    const closedMarket = await prisma.market.create({
      data: {
        matchId: matchIds[0]!,
        type: DbMarketType.RESULT_1X2,
        status: MarketStatus.CLOSED,
      },
    });

    await prisma.selection.create({
      data: {
        marketId: closedMarket.id,
        key: 'HOME',
        label: 'Local',
        source: OddsSource.API_FOOTBALL,
        odds: '2.500',
      },
    });

    const response = await request(app.getHttpServer()).get('/matches?pageSize=100').expect(200);

    expect(response.body).toMatchObject({ total: 21, pageSize: 20 });
    expect(response.body.items).toHaveLength(20);
    expect(
      response.body.items.every(
        (match: {
          markets: {
            status: string;
            selections: { source: string; isActive: boolean }[];
          }[];
        }) =>
          match.markets.length > 0 &&
          match.markets.every(
            (market) =>
              market.status === PublicMarketStatus.OPEN &&
              market.selections.every(
                (selection) => selection.source === 'API_FOOTBALL' && selection.isActive,
              ),
          ),
      ),
    ).toBe(true);

    const secondPage = await request(app.getHttpServer())
      .get('/matches?page=2&pageSize=20')
      .expect(200);
    expect(secondPage.body).toMatchObject({ total: 21, page: 2, pageSize: 20 });
    expect(secondPage.body.items).toHaveLength(1);
  });

  it('muestra contadores solo para partidos apostables y excluye horarios pasados', async () => {
    const activeCompetition = await post(
      '/operator/competitions',
      { name: 'Liga con partidos', country: 'Ecuador' },
      operatorCookie,
    ).expect(201);
    const emptyCompetition = await post(
      '/operator/competitions',
      { name: 'Liga sin partidos', country: 'Ecuador' },
      operatorCookie,
    ).expect(201);
    const upcomingId = await createMatch(operatorCookie, activeCompetition.body.id as string);
    const liveId = await createMatch(operatorCookie, activeCompetition.body.id as string);
    const liveWithoutOddsId = await createMatch(
      operatorCookie,
      activeCompetition.body.id as string,
    );
    const pastScheduledId = await createMatch(operatorCookie, activeCompetition.body.id as string);
    const soonScheduledId = await createMatch(operatorCookie, activeCompetition.body.id as string);
    await addExternalOdds(upcomingId);
    await addExternalOdds(liveId);
    await addExternalOdds(pastScheduledId);
    await addExternalOdds(soonScheduledId);
    await prisma.match.update({
      where: { id: upcomingId },
      data: { kickoffAt: new Date('2099-01-20T20:00:00.000Z') },
    });
    await prisma.match.update({
      where: { id: liveId },
      data: {
        kickoffAt: new Date(Date.now() - 60 * 60 * 1000),
        status: DbMatchStatus.LIVE,
      },
    });
    await prisma.match.update({
      where: { id: liveWithoutOddsId },
      data: {
        kickoffAt: new Date(Date.now() - 90 * 60 * 1000),
        status: DbMatchStatus.LIVE,
      },
    });
    await prisma.match.update({
      where: { id: pastScheduledId },
      data: { kickoffAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    await prisma.match.update({
      where: { id: soonScheduledId },
      data: { kickoffAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    const noOddsId = await createMatch(operatorCookie, emptyCompetition.body.id as string);
    await prisma.match.update({
      where: { id: noOddsId },
      data: { kickoffAt: new Date('2099-01-20T21:00:00.000Z') },
    });

    const filters = await request(app.getHttpServer()).get('/matches/filters').expect(200);
    expect(filters.body.competitions).toEqual([
      expect.objectContaining({ id: activeCompetition.body.id, count: 4 }),
    ]);
    expect(filters.body.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: PublicMatchStatus.SCHEDULED, count: 2 }),
        expect.objectContaining({ value: PublicMatchStatus.LIVE, count: 2 }),
      ]),
    );
    expect(filters.body.statuses).toHaveLength(2);

    const dateRange = new URLSearchParams({
      from: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      to: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      status: PublicMatchStatus.SCHEDULED,
    });
    const dateFiltered = await request(app.getHttpServer())
      .get(`/matches?${dateRange}`)
      .expect(200);
    expect(dateFiltered.body.items.map((match: { id: string }) => match.id)).toContain(
      soonScheduledId,
    );
    expect(dateFiltered.body.items.map((match: { id: string }) => match.id)).not.toContain(
      pastScheduledId,
    );
  });

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

  it('incluye en la cartelera los mercados abiertos con cuotas manuales', async () => {
    const matchId = await createMatch();
    await createResultMarket(matchId);

    const response = await request(app.getHttpServer()).get('/matches').expect(200);
    expect(response.body.items).toEqual([
      expect.objectContaining({
        id: matchId,
        markets: [
          expect.objectContaining({
            selections: expect.arrayContaining([
              expect.objectContaining({ source: OddsSource.MANUAL, isActive: true }),
            ]),
          }),
        ],
      }),
    ]);
  });

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
    expect(await prisma.match.findUniqueOrThrow({ where: { id: matchId } })).toMatchObject({
      statusSource: OddsSource.MANUAL,
    });

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
    const resultEvents = await prisma.matchEvent.findMany({
      where: { matchId },
      orderBy: { receivedAt: 'asc' },
    });
    expect(resultEvents.map(({ type }) => type)).toEqual([
      'MATCH_STATUS_CHANGED',
      'MARKET_RESULTED',
      'MATCH_STATUS_CHANGED',
    ]);
    expect(
      (resultEvents[1]!.payload as { results: Record<string, string> }).results[
        (
          await prisma.selection.findFirstOrThrow({
            where: { marketId, key: 'HOME', source: OddsSource.MANUAL },
            select: { id: true },
          })
        ).id
      ],
    ).toBe('WON');
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
