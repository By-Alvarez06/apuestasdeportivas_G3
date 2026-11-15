import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { MarketType as PublicMarketType } from '@apuestas/shared';
import { AuditService } from '../audit/audit.service';
import { MarketStatus, MarketType, MatchStatus, OddsSource } from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { MatchEventJob } from '../catalog/match-catalog.port';
import {
  ApiFootballClient,
  ApiFootballPermissionError,
  type FootballFixture,
  type FootballOdd,
} from './api-football.client';
import {
  configuredDailyLimit,
  DailyBudgetExceededError,
  FootballBudgetService,
} from './football-budget';
import { marketOutcomes } from './market-outcomes';
import {
  createMarketResultEvents,
  createMatchStatusEvent,
  MatchEventPublisher,
} from './match-event.publisher';

const QUEUE_NAME = 'api-football-fixtures';
const SCHEDULER_ID = 'daily-fixture-sync';
const DEFAULT_SCHEDULED_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_LIVE_INTERVAL_MS = 60 * 1000;
const MIN_SCHEDULED_INTERVAL_MS = 5 * 60 * 1000;
const MIN_LIVE_INTERVAL_MS = 30 * 1000;
const isLiveEligible = (status: MatchStatus) =>
  status === MatchStatus.SCHEDULED || status === MatchStatus.LIVE;

const statusByProvider: Record<string, MatchStatus | undefined> = {
  TBD: MatchStatus.SCHEDULED,
  NS: MatchStatus.SCHEDULED,
  '1H': MatchStatus.LIVE,
  HT: MatchStatus.LIVE,
  '2H': MatchStatus.LIVE,
  ET: MatchStatus.LIVE,
  BT: MatchStatus.LIVE,
  P: MatchStatus.LIVE,
  LIVE: MatchStatus.LIVE,
  FT: MatchStatus.FINISHED,
  AET: MatchStatus.FINISHED,
  PEN: MatchStatus.FINISHED,
  PST: MatchStatus.POSTPONED,
  CANC: MatchStatus.CANCELLED,
  ABD: MatchStatus.CANCELLED,
  SUSP: MatchStatus.SUSPENDED,
  INT: MatchStatus.SUSPENDED,
};

export interface SyncResult {
  imported: number;
  unchanged: number;
  manualOverrides: number;
  unknownStatuses: number;
  liveMatches: number;
  oddsUpdated: number;
  oddsError: string | null;
  skipped: boolean;
}

export function adaptiveInterval(
  liveMatches: number,
  remaining: number,
  untilResetMs: number,
  liveIntervalMs: number,
  scheduledIntervalMs: number,
): number {
  const desired = liveMatches > 0 ? liveIntervalMs : scheduledIntervalMs;
  if (remaining <= 0) return Math.max(1000, untilResetMs);
  return Math.max(desired, Math.ceil(Math.max(1000, untilResetMs) / remaining));
}

@Injectable()
export class FootballSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FootballSyncService.name);
  private readonly liveIntervalMs: number;
  private readonly scheduledIntervalMs: number;
  private connection: Redis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private lastSync: { at: string; result: SyncResult | null; error: string | null } | null = null;
  private disabledReason: string | null = null;
  private oddsSyncReason: string | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly client: ApiFootballClient,
    private readonly budget: FootballBudgetService,
    private readonly audit: AuditService,
    private readonly matchEvents: MatchEventPublisher,
  ) {
    this.liveIntervalMs = this.readInterval(
      'API_FOOTBALL_LIVE_INTERVAL_MS',
      DEFAULT_LIVE_INTERVAL_MS,
      MIN_LIVE_INTERVAL_MS,
    );
    this.scheduledIntervalMs = this.readInterval(
      'API_FOOTBALL_SCHEDULED_INTERVAL_MS',
      DEFAULT_SCHEDULED_INTERVAL_MS,
      MIN_SCHEDULED_INTERVAL_MS,
    );
  }

  async onModuleInit(): Promise<void> {
    const budget = configuredDailyLimit(this.config);
    const apiKey = this.config.get<string>('API_FOOTBALL_KEY')?.trim();
    if (!budget || !apiKey) {
      this.disabledReason = !apiKey
        ? 'Configura API_FOOTBALL_KEY para habilitar la sincronización.'
        : 'Configura un presupuesto diario positivo en API_FOOTBALL_DAILY_BUDGET; no se enviarán peticiones.';
      this.logger.warn(this.disabledReason);
      return;
    }

    const redisUrl = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
    let connection: Redis;
    try {
      connection = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
      await connection.connect();
    } catch (error) {
      this.disabledReason = 'No se pudo conectar a Redis; la sincronización queda desactivada.';
      this.logger.error(this.disabledReason, error instanceof Error ? error.message : undefined);
      return;
    }

    this.connection = connection;
    this.queue = new Queue(QUEUE_NAME, { connection });
    this.worker = new Worker(QUEUE_NAME, (job) => this.processJob(job), {
      connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) => {
      if (job) this.logger.error(`Falló la sincronización ${job.id}: ${error.message}`);
    });
    this.worker.on('error', (error) => this.logger.error(`Error del worker: ${error.message}`));
    const utcDay = new Date().toISOString().slice(0, 10);
    await this.queue.add(
      'sync-fixtures',
      {},
      {
        jobId: `startup-sync-${utcDay}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
    await this.schedule(this.scheduledIntervalMs);
    this.logger.log(
      'Sincronizador de API-Football habilitado; el presupuesto se reserva antes de cada petición.',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    if (this.connection) await this.connection.quit();
  }

  async status() {
    const budget = await this.budget.status();
    const [liveMatches, scheduledMatches] = await Promise.all([
      this.prisma.match.count({ where: { status: MatchStatus.LIVE } }),
      this.prisma.match.count({ where: { status: MatchStatus.SCHEDULED } }),
    ]);
    const bookmakerId = this.readBookmakerId();
    return {
      enabled: this.worker !== null,
      disabledReason: this.disabledReason,
      budget,
      liveMatches,
      scheduledMatches,
      liveIntervalMs: this.liveIntervalMs,
      scheduledIntervalMs: this.scheduledIntervalMs,
      oddsSyncEnabled: bookmakerId !== null && this.oddsSyncReason === null,
      oddsSyncReason:
        this.oddsSyncReason ??
        (bookmakerId
          ? null
          : 'Configura API_FOOTBALL_BOOKMAKER_ID cuando conozcas la casa; no se publicarán cuotas externas.'),
      lastSync: this.lastSync,
    };
  }

  async syncDate(date: string, now = new Date()): Promise<SyncResult> {
    const fixtures = await this.client.fixturesForDate(date);
    let imported = 0;
    let unchanged = 0;
    let manualOverrides = 0;
    let unknownStatuses = 0;
    let liveMatches = 0;
    let oddsUpdated = 0;
    let oddsError: string | null = null;
    const oddsMatches = new Map<number, string>();
    const bookmakerId = this.readBookmakerId();

    for (const fixture of fixtures) {
      const status = statusByProvider[fixture.status];
      if (!status) {
        unknownStatuses += 1;
        this.logger.warn(
          `Estado API-Football no reconocido para fixture ${fixture.fixtureId}; se conserva el partido existente.`,
        );
        continue;
      }
      if (status === MatchStatus.LIVE) liveMatches += 1;

      const competition = await this.prisma.competition.upsert({
        where: { apiFootballId: fixture.competition.id },
        create: {
          apiFootballId: fixture.competition.id,
          name: fixture.competition.name,
          country: fixture.competition.country,
        },
        update: {
          name: fixture.competition.name,
          country: fixture.competition.country,
        },
      });
      const [homeTeam, awayTeam] = await Promise.all([
        this.upsertTeam(fixture.homeTeam),
        this.upsertTeam(fixture.awayTeam),
      ]);
      const existing = await this.prisma.match.findUnique({
        where: { apiFootballId: fixture.fixtureId },
      });
      if (existing?.statusSource === OddsSource.MANUAL) {
        manualOverrides += 1;
        if (bookmakerId && isLiveEligible(existing.status)) {
          oddsMatches.set(fixture.fixtureId, existing.id);
        }
        continue;
      }

      const data = {
        competitionId: competition.id,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        kickoffAt: fixture.kickoffAt,
        status,
        homeScore: fixture.homeScore,
        awayScore: fixture.awayScore,
        statusSource: OddsSource.API_FOOTBALL,
      };
      const match = await this.prisma.$transaction(async (tx) => {
        const saved = await tx.match.upsert({
          where: { apiFootballId: fixture.fixtureId },
          create: {
            apiFootballId: fixture.fixtureId,
            ...data,
          },
          update: data,
          include: { markets: { select: { id: true, status: true } } },
        });
        if (
          status === MatchStatus.SUSPENDED ||
          status === MatchStatus.POSTPONED ||
          status === MatchStatus.CANCELLED
        ) {
          await tx.market.updateMany({
            where: { matchId: saved.id, status: MarketStatus.OPEN },
            data: { status: MarketStatus.SUSPENDED },
          });
        } else if (status === MatchStatus.FINISHED) {
          await tx.market.updateMany({
            where: { matchId: saved.id, status: { not: MarketStatus.CLOSED } },
            data: { status: MarketStatus.CLOSED },
          });
        }

        const changed =
          !existing ||
          existing.status !== status ||
          existing.homeScore !== fixture.homeScore ||
          existing.awayScore !== fixture.awayScore ||
          existing.kickoffAt.getTime() !== fixture.kickoffAt.getTime();
        if (changed) {
          await this.audit.record(
            {
              actorId: null,
              action: existing ? 'match.sync.updated' : 'match.sync.created',
              targetType: 'match',
              targetId: saved.id,
              metadata: {
                provider: 'api-football',
                fixtureId: fixture.fixtureId,
                from: existing?.status ?? '',
                to: status,
              },
              ip: 'worker',
              userAgent: 'api-football-sync',
            },
            tx,
          );
        }
        const events: MatchEventJob[] = [];
        const scoreChanged =
          existing?.homeScore !== fixture.homeScore || existing?.awayScore !== fixture.awayScore;
        if (
          status === MatchStatus.FINISHED &&
          fixture.homeScore !== null &&
          fixture.awayScore !== null &&
          (existing?.status !== MatchStatus.FINISHED || scoreChanged)
        ) {
          const markets = await tx.market.findMany({
            where: { matchId: saved.id },
            include: { selections: { select: { id: true, key: true } } },
          });
          events.push(
            ...createMarketResultEvents(
              saved.id,
              markets,
              fixture.homeScore,
              fixture.awayScore,
              existing?.status === MatchStatus.FINISHED,
            ),
          );
        }
        if (existing && existing.status !== status) {
          events.push(createMatchStatusEvent(saved.id, status, fixture.kickoffAt));
        }
        if (events.length > 0) await this.matchEvents.stage(tx, events);
        return { saved, changed, hasEvents: events.length > 0 };
      });
      if (match.changed) imported += 1;
      else unchanged += 1;
      if (match.hasEvents) await this.matchEvents.dispatchPending();
      if (bookmakerId && isLiveEligible(status)) oddsMatches.set(fixture.fixtureId, match.saved.id);
    }

    if (bookmakerId && this.oddsSyncReason === null) {
      try {
        const odds = await this.client.oddsForDate(date, bookmakerId);
        for (const entry of odds) {
          const matchId = oddsMatches.get(entry.fixtureId);
          if (matchId) oddsUpdated += await this.saveExternalOdds(matchId, entry.odds);
        }
        this.oddsSyncReason = null;
      } catch (error) {
        oddsError =
          error instanceof ApiFootballPermissionError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'No se pudieron sincronizar las cuotas externas.';
        this.oddsSyncReason = oddsError;
        this.logger.warn(`Sincronización de cuotas externas desactivada: ${oddsError}`);
      }
    }

    const result = {
      imported,
      unchanged,
      manualOverrides,
      unknownStatuses,
      liveMatches,
      oddsUpdated,
      oddsError,
      skipped: false,
    };
    this.lastSync = { at: now.toISOString(), result, error: null };
    return result;
  }

  private async processJob(job: Job): Promise<SyncResult> {
    void job;
    const status = await this.budget.status();
    if (!status.enabled) {
      const result: SyncResult = {
        imported: 0,
        unchanged: 0,
        manualOverrides: 0,
        unknownStatuses: 0,
        liveMatches: await this.prisma.match.count({ where: { status: MatchStatus.LIVE } }),
        oddsUpdated: 0,
        oddsError: null,
        skipped: true,
      };
      this.lastSync = { at: new Date().toISOString(), result, error: status.reason };
      if (status.reason === 'exhausted') {
        await this.schedule(Math.max(1000, new Date(status.resetsAt).getTime() - Date.now()));
      }
      return result;
    }
    const day = new Date().toISOString().slice(0, 10);
    try {
      const result = await this.syncDate(day);
      const current = await this.budget.status();
      const interval = this.adaptiveInterval(
        result.liveMatches,
        Math.floor(current.remaining / (this.readBookmakerId() ? 2 : 1)),
        current.resetsAt,
      );
      await this.schedule(interval);
      this.logger.log(
        `Sincronización ${day}: ${result.imported} cambios, ${result.unchanged} sin cambios, ${result.manualOverrides} protegidos, ${result.liveMatches} en vivo, ${current.remaining}/${current.limit} peticiones disponibles.`,
      );
      return result;
    } catch (error) {
      if (error instanceof DailyBudgetExceededError) {
        await this.schedule(Math.max(1000, error.resetsAt.getTime() - Date.now()));
      } else {
        this.lastSync = {
          at: new Date().toISOString(),
          result: null,
          error: error instanceof Error ? error.message : 'Error desconocido de sincronización.',
        };
        throw error;
      }
      throw error;
    }
  }

  private async upsertTeam(team: FootballFixture['homeTeam']) {
    return this.prisma.team.upsert({
      where: { apiFootballId: team.id },
      create: {
        apiFootballId: team.id,
        name: team.name,
        logoUrl: team.logoUrl,
      },
      update: { name: team.name, logoUrl: team.logoUrl },
    });
  }

  private async saveExternalOdds(matchId: string, odds: FootballOdd[]): Promise<number> {
    let updated = 0;
    for (const odd of odds) {
      const publicType =
        odd.type === MarketType.RESULT_1X2
          ? PublicMarketType.RESULT_1X2
          : odd.type === MarketType.DOUBLE_CHANCE
            ? PublicMarketType.DOUBLE_CHANCE
            : odd.type === MarketType.TOTAL_GOALS
              ? PublicMarketType.TOTAL_GOALS
              : PublicMarketType.BOTH_TEAMS_SCORE;
      const outcome = marketOutcomes(publicType).find(({ key }) => key === odd.selection);
      if (!outcome) continue;

      const changed = await this.prisma.$transaction(async (tx) => {
        const marketLockKey = `${matchId}:${odd.type}:${odd.line ?? 'null'}`;
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${marketLockKey}, 0))::text`;
        const market = await tx.market.findFirst({
          where: {
            matchId,
            type: odd.type,
            line: odd.line === null ? null : new Prisma.Decimal(odd.line),
          },
        });
        const savedMarket =
          market ??
          (await tx.market.create({
            data: {
              matchId,
              type: odd.type,
              line: odd.line === null ? null : new Prisma.Decimal(odd.line),
              status: MarketStatus.OPEN,
            },
          }));
        const existing = await tx.selection.findUnique({
          where: {
            marketId_key_source: {
              marketId: savedMarket.id,
              key: odd.selection,
              source: OddsSource.API_FOOTBALL,
            },
          },
        });
        const oddsValue = new Prisma.Decimal(odd.odds);
        if (existing?.odds.equals(oddsValue)) return false;
        const selection = await tx.selection.upsert({
          where: {
            marketId_key_source: {
              marketId: savedMarket.id,
              key: odd.selection,
              source: OddsSource.API_FOOTBALL,
            },
          },
          create: {
            marketId: savedMarket.id,
            key: odd.selection,
            label: outcome.label,
            source: OddsSource.API_FOOTBALL,
            odds: oddsValue,
            isActive: true,
          },
          update: { odds: oddsValue, isActive: true },
        });
        await tx.oddsHistory.create({
          data: {
            selectionId: selection.id,
            source: OddsSource.API_FOOTBALL,
            previousOdds: existing?.odds ?? null,
            newOdds: oddsValue,
          },
        });
        return true;
      });
      if (changed) updated += 1;
    }
    return updated;
  }

  private adaptiveInterval(liveMatches: number, remaining: number, resetsAt: string): number {
    return adaptiveInterval(
      liveMatches,
      remaining,
      new Date(resetsAt).getTime() - Date.now(),
      this.liveIntervalMs,
      this.scheduledIntervalMs,
    );
  }

  private async schedule(every: number): Promise<void> {
    if (!this.queue) return;
    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every },
      {
        name: 'sync-fixtures',
        data: {},
        opts: { removeOnComplete: 100, removeOnFail: 100 },
      },
    );
  }

  private readInterval(key: string, fallback: number, minimum: number): number {
    const raw = this.config.get<string>(key);
    if (!raw) return fallback;
    if (!/^[1-9]\d*$/.test(raw))
      throw new Error(`${key} debe ser un entero positivo en milisegundos.`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new Error(`${key} debe ser al menos ${minimum} milisegundos.`);
    }
    return value;
  }

  private readBookmakerId(): number | null {
    const raw = this.config.get<string>('API_FOOTBALL_BOOKMAKER_ID');
    if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) ? id : null;
  }
}
