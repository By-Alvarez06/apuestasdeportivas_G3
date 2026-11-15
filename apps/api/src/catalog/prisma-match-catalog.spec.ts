import type { PrismaService } from '../prisma/prisma.service';
import { PrismaMatchCatalog } from './prisma-match-catalog';

const decimal = (value: string) => ({ toString: () => value });

describe('PrismaMatchCatalog', () => {
  const startsAt = new Date('2026-11-15T03:00:00.000Z');
  const findSelection = jest.fn();
  const findOddsHistory = jest.fn();
  const findMatches = jest.fn();
  const prisma = {
    selection: { findMany: findSelection },
    oddsHistory: { findMany: findOddsHistory },
    match: { findMany: findMatches },
  } as unknown as PrismaService;
  const catalog = new PrismaMatchCatalog(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lee la cuota activa de la base y la convierte a centésimas', async () => {
    findSelection.mockResolvedValue([
      {
        id: 'selection-1',
        label: 'Local',
        odds: decimal('2.105'),
        market: {
          id: 'market-1',
          type: 'RESULT_1X2',
          line: null,
          status: 'OPEN',
          match: {
            id: 'match-1',
            kickoffAt: startsAt,
            status: 'LIVE',
            competition: { name: 'Liga de Prueba' },
            homeTeam: { name: 'Equipo local', logoUrl: 'https://example.test/local.png' },
            awayTeam: { name: 'Equipo visitante', logoUrl: null },
          },
        },
      },
    ]);

    await expect(catalog.getQuotes(['selection-1'])).resolves.toEqual([
      {
        selectionId: 'selection-1',
        marketId: 'market-1',
        matchId: 'match-1',
        odds: 211,
        marketStatus: 'OPEN',
        matchStatus: 'LIVE',
        startsAt,
        liveBettingEnabled: true,
        labels: {
          match: 'Liga de Prueba · Equipo local - Equipo visitante',
          market: 'Resultado del partido',
          selection: 'Local',
        },
      },
    ]);
    expect(findSelection).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['selection-1'] }, isActive: true } }),
    );
  });

  it('no consulta la base cuando no hay selecciones solicitadas', async () => {
    await expect(catalog.getQuotes([])).resolves.toEqual([]);
    expect(findSelection).not.toHaveBeenCalled();
  });

  it('ordena el historial y entrega las cuotas en centésimas', async () => {
    findOddsHistory.mockResolvedValue([
      { createdAt: new Date('2026-11-14T12:01:00Z'), newOdds: decimal('2.20') },
      { createdAt: new Date('2026-11-14T12:02:00Z'), newOdds: decimal('2.35') },
    ]);
    const from = new Date('2026-11-14T12:00:00Z');
    const to = new Date('2026-11-14T13:00:00Z');

    await expect(catalog.oddsHistory('selection-1', from, to)).resolves.toEqual([
      { at: new Date('2026-11-14T12:01:00Z'), odds: 220 },
      { at: new Date('2026-11-14T12:02:00Z'), odds: 235 },
    ]);
  });

  it('lista solo partidos apostables y prefiere la cuota manual a la externa', async () => {
    findMatches.mockResolvedValue([
      {
        id: 'match-1',
        kickoffAt: startsAt,
        status: 'SCHEDULED',
        homeScore: null,
        awayScore: null,
        competition: { name: 'Liga de Prueba' },
        homeTeam: { name: 'Equipo local', logoUrl: 'https://example.test/local.png' },
        awayTeam: { name: 'Equipo visitante', logoUrl: null },
        markets: [
          {
            id: 'market-1',
            type: 'TOTAL_GOALS',
            line: decimal('2.50'),
            status: 'OPEN',
            selections: [
              {
                id: 'external-selection',
                key: 'OVER',
                label: 'Más',
                odds: decimal('1.80'),
                source: 'API_FOOTBALL',
              },
              {
                id: 'manual-selection',
                key: 'OVER',
                label: 'Más',
                odds: decimal('1.95'),
                source: 'MANUAL',
              },
            ],
          },
        ],
      },
    ]);

    await expect(catalog.listOpenMatches()).resolves.toEqual([
      {
        matchId: 'match-1',
        label: 'Liga de Prueba · Equipo local - Equipo visitante',
        startsAt,
        status: 'SCHEDULED',
        homeTeam: { name: 'Equipo local', logoUrl: 'https://example.test/local.png' },
        awayTeam: { name: 'Equipo visitante', logoUrl: null },
        homeScore: null,
        awayScore: null,
        markets: [
          {
            marketId: 'market-1',
            label: 'Total de goles (2.50)',
            status: 'OPEN',
            live: false,
            selections: [{ selectionId: 'manual-selection', label: 'Más', odds: 195 }],
          },
        ],
      },
    ]);
    expect(findMatches).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
  });
});
