import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client';
import { MarketType, OddsSource, Role, UserStatus } from '../src/generated/prisma/enums';
import { fund, placeBet, single, type BetView } from './bets.helpers';
import { createTestApp, createTestPrisma, drainQueues, resetDatabase, signedInUser } from './setup';

describe('Catálogo real de partidos para apuestas', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let bettor: { id: string; cookie: string };
  let selectionId: string;

  beforeAll(async () => {
    process.env.CATALOG_MODE = 'database';
    prisma = createTestPrisma();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    process.env.CATALOG_MODE = 'simulated';
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await drainQueues();
    bettor = await signedInUser(app, prisma, { role: Role.BETTOR, status: UserStatus.ACTIVE });

    const competition = await prisma.competition.create({
      data: { name: 'Liga de Prueba', country: 'Ecuador' },
    });
    const [home, away] = await Promise.all([
      prisma.team.create({
        data: { name: 'Equipo local', logoUrl: 'https://example.test/local.png' },
      }),
      prisma.team.create({ data: { name: 'Equipo visitante' } }),
    ]);
    const match = await prisma.match.create({
      data: {
        competitionId: competition.id,
        homeTeamId: home.id,
        awayTeamId: away.id,
        kickoffAt: new Date('2099-01-20T20:00:00.000Z'),
        statusSource: OddsSource.MANUAL,
        markets: {
          create: {
            type: MarketType.RESULT_1X2,
            selections: {
              create: [
                { key: 'HOME', label: 'Local', source: OddsSource.API_FOOTBALL, odds: '1.80' },
                { key: 'DRAW', label: 'Empate', source: OddsSource.API_FOOTBALL, odds: '3.10' },
                { key: 'AWAY', label: 'Visitante', source: OddsSource.API_FOOTBALL, odds: '4.20' },
                { key: 'HOME', label: 'Local', source: OddsSource.MANUAL, odds: '2.10' },
              ],
            },
          },
        },
      },
    });
    selectionId = (
      await prisma.selection.findFirstOrThrow({
        where: {
          market: { matchId: match.id },
          key: 'HOME',
          source: OddsSource.MANUAL,
        },
        select: { id: true },
      })
    ).id;
  });

  it('muestra cuotas reales y permite apostar con la selección vigente de la base', async () => {
    const catalog = await request(app.getHttpServer())
      .get('/catalog/matches')
      .set('Cookie', bettor.cookie)
      .expect(200);
    expect(catalog.body).toEqual([
      expect.objectContaining({
        label: 'Liga de Prueba · Equipo local - Equipo visitante',
        homeTeam: { name: 'Equipo local', logoUrl: 'https://example.test/local.png' },
        awayTeam: { name: 'Equipo visitante', logoUrl: null },
        homeScore: null,
        awayScore: null,
        markets: [
          expect.objectContaining({
            label: 'Resultado del partido',
            selections: expect.arrayContaining([
              expect.objectContaining({ selectionId, label: 'Local', odds: '2.10' }),
            ]),
          }),
        ],
      }),
    ]);
    expect(catalog.body[0].markets[0].selections).toHaveLength(3);

    await fund(app, bettor.id, 5000);
    const placed = await placeBet(app, bettor.cookie, single(selectionId, '2.10', '10.00')).expect(
      201,
    );
    expect((placed.body as BetView).selections[0]).toMatchObject({
      selectionId,
      matchLabel: 'Liga de Prueba · Equipo local - Equipo visitante',
      marketLabel: 'Resultado del partido',
      selectionLabel: 'Local',
      odds: '2.10',
    });
  });
});
