import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validationError } from '../common/errors/domain-error';
import { FootballBudgetService } from './football-budget';
import { MarketType } from '../generated/prisma/enums';

export interface FootballFixture {
  fixtureId: number;
  kickoffAt: Date;
  status: string;
  competition: { id: number; name: string; country: string | null };
  homeTeam: { id: number; name: string; logoUrl: string | null };
  awayTeam: { id: number; name: string; logoUrl: string | null };
  homeScore: number | null;
  awayScore: number | null;
}

export interface FootballOdd {
  type: MarketType;
  line: string | null;
  selection: string;
  odds: string;
}

export class ApiFootballPermissionError extends Error {
  constructor(status: number) {
    super(`API-Football denegó el acceso a las cuotas (HTTP ${status}).`);
    this.name = ApiFootballPermissionError.name;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveId(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value > 0;
}

function requiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function validScore(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && typeof value === 'number' && value >= 0);
}

function parseFixture(value: unknown): FootballFixture {
  if (!isRecord(value)) throw validationError('API-Football devolvió un partido inválido.');
  const { fixture, league, teams, goals } = value;
  if (!isRecord(fixture) || !isRecord(league) || !isRecord(teams) || !isRecord(goals)) {
    throw validationError('API-Football devolvió un partido incompleto.');
  }
  const home = teams.home;
  const away = teams.away;
  if (!isRecord(home) || !isRecord(away) || !isRecord(fixture.status)) {
    throw validationError('API-Football devolvió equipos o estado inválidos.');
  }
  if (
    !positiveId(fixture.id) ||
    !requiredText(fixture.date) ||
    !requiredText(fixture.status.short) ||
    !positiveId(league.id) ||
    !requiredText(league.name) ||
    !nullableText(league.country) ||
    !positiveId(home.id) ||
    !requiredText(home.name) ||
    !nullableText(home.logo) ||
    !positiveId(away.id) ||
    !requiredText(away.name) ||
    !nullableText(away.logo) ||
    !validScore(goals.home) ||
    !validScore(goals.away)
  ) {
    throw validationError('API-Football devolvió campos de partido inválidos.');
  }
  const kickoffAt = new Date(fixture.date);
  if (Number.isNaN(kickoffAt.getTime())) {
    throw validationError('API-Football devolvió una fecha de partido inválida.');
  }
  return {
    fixtureId: fixture.id,
    kickoffAt,
    status: fixture.status.short,
    competition: { id: league.id, name: league.name, country: league.country },
    homeTeam: { id: home.id, name: home.name, logoUrl: home.logo },
    awayTeam: { id: away.id, name: away.name, logoUrl: away.logo },
    homeScore: goals.home,
    awayScore: goals.away,
  };
}

function decimalOdds(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{1,5}(?:\.\d{1,3})?$/.test(value)) return null;
  const parsed = Number(value);
  return parsed > 1 ? parsed.toFixed(3) : null;
}

function parseTotalLine(value: string): { selection: string; line: string } | null {
  const match = /^(over|under)\s+(\d{1,3}(?:\.\d{1,2})?)$/i.exec(value.trim());
  const side = match?.[1]?.toLowerCase();
  const line = match?.[2];
  if (!side || !line || Number(line) <= 0) return null;
  return { selection: side === 'over' ? 'OVER' : 'UNDER', line };
}

function parseDoubleChance(value: string): string | null {
  const normalized = value.toLowerCase().replace(/[^a-z]/g, '');
  if (['homedraw', 'drawhome', '1x'].includes(normalized)) return 'HOME_OR_DRAW';
  if (['homeaway', 'awayhome', '12'].includes(normalized)) return 'HOME_OR_AWAY';
  if (['drawaway', 'awaydraw', 'x2'].includes(normalized)) return 'DRAW_OR_AWAY';
  return null;
}

function parseOdds(value: unknown): FootballOdd[] {
  if (!isRecord(value) || !requiredText(value.name) || !Array.isArray(value.values)) return [];
  const name = value.name.trim().toLowerCase();
  const type =
    name === 'match winner' || name === '1x2'
      ? MarketType.RESULT_1X2
      : name === 'double chance'
        ? MarketType.DOUBLE_CHANCE
        : name === 'goals over/under' || name === 'over/under'
          ? MarketType.TOTAL_GOALS
          : name === 'both teams score' || name === 'both teams to score'
            ? MarketType.BOTH_TEAMS_SCORE
            : null;
  if (!type) return [];

  const odds: FootballOdd[] = [];
  for (const raw of value.values) {
    if (!isRecord(raw) || !requiredText(raw.value)) continue;
    const price = decimalOdds(raw.odd);
    if (!price) continue;

    let line: string | null = null;
    let selection: string | null;
    if (type === MarketType.RESULT_1X2) {
      const key = raw.value.trim().toLowerCase();
      selection =
        key === 'home' || key === '1'
          ? 'HOME'
          : key === 'draw' || key === 'x'
            ? 'DRAW'
            : key === 'away' || key === '2'
              ? 'AWAY'
              : null;
    } else if (type === MarketType.DOUBLE_CHANCE) {
      selection = parseDoubleChance(raw.value);
    } else if (type === MarketType.TOTAL_GOALS) {
      const parsed = parseTotalLine(raw.value);
      selection = parsed?.selection ?? null;
      line = parsed?.line ?? null;
    } else {
      const key = raw.value.trim().toLowerCase();
      selection = key === 'yes' ? 'YES' : key === 'no' ? 'NO' : null;
    }

    if (selection) odds.push({ type, line, selection, odds: price });
  }
  return odds;
}

@Injectable()
export class ApiFootballClient {
  private readonly logger = new Logger(ApiFootballClient.name);

  constructor(
    private readonly config: ConfigService,
    private readonly budget: FootballBudgetService,
  ) {}

  async fixturesForDate(date: string): Promise<FootballFixture[]> {
    this.validateDate(date);
    const payload = await this.request('/fixtures', { date, timezone: 'UTC' });
    return payload.map(parseFixture);
  }

  async oddsForDate(
    date: string,
    bookmakerId: number,
  ): Promise<Array<{ fixtureId: number; odds: FootballOdd[] }>> {
    this.validateDate(date);
    if (!Number.isSafeInteger(bookmakerId) || bookmakerId <= 0) {
      throw validationError('El identificador de la casa de apuestas no es válido.');
    }
    const payload = await this.request('/odds', {
      date,
      bookmaker: String(bookmakerId),
      timezone: 'UTC',
    });
    const result: Array<{ fixtureId: number; odds: FootballOdd[] }> = [];
    for (const entry of payload) {
      if (!isRecord(entry) || !isRecord(entry.fixture) || !positiveId(entry.fixture.id)) continue;
      if (!Array.isArray(entry.bookmakers)) continue;
      const bookmaker = entry.bookmakers.find(
        (candidate) =>
          isRecord(candidate) && candidate.id === bookmakerId && Array.isArray(candidate.bets),
      );
      if (!isRecord(bookmaker) || !Array.isArray(bookmaker.bets)) continue;
      const odds = bookmaker.bets.flatMap(parseOdds);
      if (odds.length) result.push({ fixtureId: entry.fixture.id, odds });
    }
    return result;
  }

  private validateDate(date: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw validationError('La fecha de sincronización debe tener el formato AAAA-MM-DD.');
    }
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw validationError('La fecha de sincronización no es válida.');
    }
  }

  private async request(path: string, params: Record<string, string>): Promise<unknown[]> {
    const key = this.config.get<string>('API_FOOTBALL_KEY')?.trim();
    if (!key) throw new Error('Falta API_FOOTBALL_KEY.');
    const baseUrl = this.config.get<string>(
      'API_FOOTBALL_BASE_URL',
      'https://v3.football.api-sports.io',
    );
    let endpoint: URL;
    try {
      endpoint = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    } catch {
      throw new Error('API_FOOTBALL_BASE_URL no es una URL válida.');
    }
    if (endpoint.protocol !== 'https:') {
      throw new Error('API_FOOTBALL_BASE_URL debe usar HTTPS.');
    }
    for (const [name, value] of Object.entries(params)) endpoint.searchParams.set(name, value);

    await this.budget.reserve();
    let response: Response;
    try {
      response = await fetch(endpoint, {
        headers: { 'x-apisports-key': key },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'Error desconocido';
      this.logger.warn(
        `No se pudo consultar API-Football (${reason}); la petición cuenta en el presupuesto.`,
      );
      throw new Error(
        'No se pudo consultar API-Football. Revisa la conectividad e inténtalo en la próxima ejecución.',
        { cause: error },
      );
    }
    if (response.status === 401 || response.status === 403) {
      this.logger.warn(
        `API-Football denegó la petición a ${path} (HTTP ${response.status}); cuenta en el presupuesto.`,
      );
      throw new ApiFootballPermissionError(response.status);
    }
    if (!response.ok) {
      this.logger.warn(
        `API-Football respondió HTTP ${response.status}; la petición cuenta en el presupuesto.`,
      );
      throw new Error(`API-Football respondió HTTP ${response.status}.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error('API-Football devolvió una respuesta JSON inválida.');
    }
    if (!isRecord(payload) || !Array.isArray(payload.response)) {
      throw new Error('API-Football devolvió un formato de respuesta inesperado.');
    }
    return payload.response;
  }
}
