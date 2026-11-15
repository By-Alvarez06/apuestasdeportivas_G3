import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MarketType } from '../generated/prisma/enums';
import { ApiFootballClient, ApiFootballPermissionError } from './api-football.client';
import { FootballBudgetService } from './football-budget';

describe('Cliente de API-Football', () => {
  let client: ApiFootballClient;
  let reserve: jest.Mock;
  let originalKey: string | undefined;
  let originalBaseUrl: string | undefined;

  beforeEach(async () => {
    originalKey = process.env.API_FOOTBALL_KEY;
    originalBaseUrl = process.env.API_FOOTBALL_BASE_URL;
    delete process.env.API_FOOTBALL_KEY;
    delete process.env.API_FOOTBALL_BASE_URL;
    reserve = jest.fn().mockResolvedValue(undefined);
    const testingModule = await Test.createTestingModule({
      providers: [
        ApiFootballClient,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            API_FOOTBALL_KEY: 'test-provider-secret',
            API_FOOTBALL_BASE_URL: 'https://provider.test',
          }),
        },
        { provide: FootballBudgetService, useValue: { reserve } },
      ],
    }).compile();
    client = testingModule.get(ApiFootballClient);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalKey === undefined) delete process.env.API_FOOTBALL_KEY;
    else process.env.API_FOOTBALL_KEY = originalKey;
    if (originalBaseUrl === undefined) delete process.env.API_FOOTBALL_BASE_URL;
    else process.env.API_FOOTBALL_BASE_URL = originalBaseUrl;
  });

  it('reserva presupuesto antes de validar y devolver partidos del proveedor', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          response: [
            {
              fixture: {
                id: 901,
                date: '2026-11-14T20:00:00Z',
                status: { short: 'NS' },
              },
              league: { id: 100, name: 'Liga de Prueba', country: 'Ecuador' },
              teams: {
                home: { id: 1, name: 'Local', logo: null },
                away: { id: 2, name: 'Visitante', logo: null },
              },
              goals: { home: null, away: null },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(client.fixturesForDate('2026-11-14')).resolves.toMatchObject([
      { fixtureId: 901, status: 'NS', homeScore: null, awayScore: null },
    ]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]?.toString()).toContain('/fixtures?date=2026-11-14');
  });

  it('parsea únicamente mercados y selecciones reconocidos para la casa configurada', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          response: [
            {
              fixture: { id: 901 },
              bookmakers: [
                {
                  id: 123,
                  bets: [
                    {
                      name: 'Match Winner',
                      values: [
                        { value: 'Home', odd: '2.10' },
                        { value: 'Draw', odd: '3.20' },
                        { value: 'Away', odd: '3.40' },
                      ],
                    },
                    {
                      name: 'Goals Over/Under',
                      values: [
                        { value: 'Over 2.5', odd: '1.85' },
                        { value: 'Under 2.5', odd: '2.05' },
                      ],
                    },
                    {
                      name: 'Unrecognized market',
                      values: [{ value: 'Home', odd: '99.0' }],
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await client.oddsForDate('2026-11-14', 123);
    expect(result).toHaveLength(1);
    expect(result[0]?.odds).toEqual([
      { type: MarketType.RESULT_1X2, line: null, selection: 'HOME', odds: '2.100' },
      { type: MarketType.RESULT_1X2, line: null, selection: 'DRAW', odds: '3.200' },
      { type: MarketType.RESULT_1X2, line: null, selection: 'AWAY', odds: '3.400' },
      { type: MarketType.TOTAL_GOALS, line: '2.5', selection: 'OVER', odds: '1.850' },
      { type: MarketType.TOTAL_GOALS, line: '2.5', selection: 'UNDER', odds: '2.050' },
    ]);
    expect(reserve).toHaveBeenCalledTimes(1);
  });

  it('cuenta los errores HTTP 403 y los comunica sin exponer la clave', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 403 }));
    await expect(client.oddsForDate('2026-11-14', 123)).rejects.toThrow(ApiFootballPermissionError);
    expect(reserve).toHaveBeenCalledTimes(1);
  });

  it('cuenta una petición con timeout y no la reintenta automáticamente', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    await expect(client.fixturesForDate('2026-11-14')).rejects.toThrow(
      'No se pudo consultar API-Football',
    );
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rechaza fechas inválidas antes de consumir presupuesto', async () => {
    await expect(client.fixturesForDate('2026-02-30')).rejects.toThrow('La fecha');
    expect(reserve).not.toHaveBeenCalled();
  });
});
