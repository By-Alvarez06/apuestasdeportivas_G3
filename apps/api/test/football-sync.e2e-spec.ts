import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import {
  ApiFootballClient,
  ApiFootballPermissionError,
  type FootballFixture,
} from '../src/matches/api-football.client';
import { FootballSyncService } from '../src/matches/football-sync';
import type { PrismaClient } from '../src/generated/prisma/client';
import { MarketType, MatchStatus, OddsSource } from '../src/generated/prisma/enums';
import { createTestApp, createTestPrisma, resetDatabase } from './setup';

const fixture: FootballFixture = {
  fixtureId: 900_001,
  kickoffAt: new Date('2027-01-20T20:00:00.000Z'),
  status: '1H',
  competition: { id: 700, name: 'Liga de Prueba', country: 'Ecuador' },
  homeTeam: { id: 701, name: 'Quito FC', logoUrl: null },
  awayTeam: { id: 702, name: 'Cuenca SC', logoUrl: null },
  homeScore: 1,
  awayScore: 0,
};

describe('Sincronización de partidos de API-Football', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let sync: FootballSyncService;
  let fixtureRequest: jest.SpyInstance;

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
    sync = app.get(FootballSyncService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fixtureRequest = jest
      .spyOn(app.get(ApiFootballClient), 'fixturesForDate')
      .mockResolvedValue([fixture]);
  });

  afterEach(() => {
    fixtureRequest.mockRestore();
  });

  it('importa de forma idempotente y registra la actividad del proveedor', async () => {
    const first = await sync.syncDate('2027-01-20');
    const repeated = await sync.syncDate('2027-01-20');

    expect(first).toMatchObject({ imported: 1, unchanged: 0, liveMatches: 1 });
    expect(repeated).toMatchObject({ imported: 0, unchanged: 1, liveMatches: 1 });
    expect(await prisma.match.count()).toBe(1);
    expect(await prisma.team.count()).toBe(2);
    expect(await prisma.competition.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'match.sync.created' } })).toBe(1);
    expect(await prisma.match.findFirstOrThrow()).toMatchObject({
      status: MatchStatus.LIVE,
      statusSource: OddsSource.API_FOOTBALL,
      homeScore: 1,
      awayScore: 0,
    });
  });

  it('no sobrescribe cambios manuales de estado ni marcador', async () => {
    await sync.syncDate('2027-01-20');
    await prisma.match.update({
      where: { apiFootballId: fixture.fixtureId },
      data: {
        status: MatchStatus.SUSPENDED,
        statusSource: OddsSource.MANUAL,
        homeScore: null,
        awayScore: null,
      },
    });
    fixtureRequest.mockResolvedValue([{ ...fixture, status: 'FT', homeScore: 2, awayScore: 1 }]);

    const result = await sync.syncDate('2027-01-20');
    const saved = await prisma.match.findUniqueOrThrow({
      where: { apiFootballId: fixture.fixtureId },
    });

    expect(result.manualOverrides).toBe(1);
    expect(saved).toMatchObject({
      status: MatchStatus.SUSPENDED,
      statusSource: OddsSource.MANUAL,
      homeScore: null,
      awayScore: null,
    });
  });

  it('ignora estados del proveedor que no reconoce', async () => {
    fixtureRequest.mockResolvedValue([{ ...fixture, status: 'UNK' }]);
    const result = await sync.syncDate('2027-01-20');
    expect(result.unknownStatuses).toBe(1);
    expect(await prisma.match.count()).toBe(0);
  });

  it('sincroniza cuotas externas por separado e idempotentemente de las cuotas manuales', async () => {
    const configGet = jest.spyOn(app.get(ConfigService), 'get').mockImplementation((key) => {
      if (key === 'API_FOOTBALL_BOOKMAKER_ID') return '123';
      return undefined;
    });
    const oddsRequest = jest.spyOn(app.get(ApiFootballClient), 'oddsForDate').mockResolvedValue([
      {
        fixtureId: fixture.fixtureId,
        odds: [
          {
            type: MarketType.RESULT_1X2,
            line: null,
            selection: 'HOME',
            odds: '2.500',
          },
        ],
      },
    ]);
    try {
      const first = await sync.syncDate('2027-01-20');
      const second = await sync.syncDate('2027-01-20');
      expect(first.oddsError).toBeNull();
      expect(second.oddsError).toBeNull();

      const market = await prisma.market.findFirstOrThrow({
        where: { match: { apiFootballId: fixture.fixtureId }, type: MarketType.RESULT_1X2 },
      });
      const selection = await prisma.selection.findUniqueOrThrow({
        where: {
          marketId_key_source: {
            marketId: market.id,
            key: 'HOME',
            source: OddsSource.API_FOOTBALL,
          },
        },
      });
      expect(selection.odds.toFixed(3)).toBe('2.500');
      expect(await prisma.oddsHistory.count({ where: { selectionId: selection.id } })).toBe(1);
      expect(oddsRequest).toHaveBeenCalledTimes(2);
    } finally {
      oddsRequest.mockRestore();
      configGet.mockRestore();
    }
  });

  it('evita crear mercados duplicados si dos sincronizaciones guardan la misma cuota a la vez', async () => {
    const configGet = jest.spyOn(app.get(ConfigService), 'get').mockImplementation((key) => {
      if (key === 'API_FOOTBALL_BOOKMAKER_ID') return '123';
      return undefined;
    });
    const oddsRequest = jest.spyOn(app.get(ApiFootballClient), 'oddsForDate').mockResolvedValue([
      {
        fixtureId: fixture.fixtureId,
        odds: [
          {
            type: MarketType.RESULT_1X2,
            line: null,
            selection: 'HOME',
            odds: '2.500',
          },
        ],
      },
    ]);
    try {
      await sync.syncDate('2027-01-20');
      await Promise.all([sync.syncDate('2027-01-20'), sync.syncDate('2027-01-20')]);

      const match = await prisma.match.findUniqueOrThrow({
        where: { apiFootballId: fixture.fixtureId },
      });
      const market = await prisma.market.findMany({
        where: { matchId: match.id, type: MarketType.RESULT_1X2 },
      });
      expect(market).toHaveLength(1);
      expect(
        await prisma.selection.count({
          where: {
            marketId: market[0].id,
            key: 'HOME',
            source: OddsSource.API_FOOTBALL,
          },
        }),
      ).toBe(1);
    } finally {
      oddsRequest.mockRestore();
      configGet.mockRestore();
    }
  });

  it('expone denegación de cuotas sin bloquear la sincronización de partidos', async () => {
    const configGet = jest.spyOn(app.get(ConfigService), 'get').mockImplementation((key) => {
      if (key === 'API_FOOTBALL_BOOKMAKER_ID') return '123';
      return undefined;
    });
    const oddsRequest = jest
      .spyOn(app.get(ApiFootballClient), 'oddsForDate')
      .mockRejectedValue(new ApiFootballPermissionError(403));
    try {
      const result = await sync.syncDate('2027-01-20');
      expect(result.imported).toBe(1);
      expect(result.oddsError).toContain('HTTP 403');
      expect(await prisma.match.count()).toBe(1);
      expect(await prisma.selection.count()).toBe(0);
    } finally {
      oddsRequest.mockRestore();
      configGet.mockRestore();
    }
  });

  it('no envía solicitudes al proveedor si no se ha configurado un presupuesto diario', async () => {
    fixtureRequest.mockRestore();
    const configGet = jest.spyOn(app.get(ConfigService), 'get').mockImplementation((key) => {
      if (key === 'API_FOOTBALL_KEY') return 'test-key';
      if (key === 'API_FOOTBALL_BASE_URL') return 'https://v3.football.api-sports.io';
      return undefined;
    });
    const fetch = jest.spyOn(global, 'fetch');
    try {
      await expect(app.get(ApiFootballClient).fixturesForDate('2027-01-20')).rejects.toThrow(
        'API_FOOTBALL_DAILY_BUDGET',
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(await prisma.apiRequestBudget.count()).toBe(0);
    } finally {
      fetch.mockRestore();
      configGet.mockRestore();
    }
  });
});
