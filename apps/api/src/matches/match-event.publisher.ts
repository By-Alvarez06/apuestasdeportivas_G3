import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { MarketType as PublicMarketType } from '@apuestas/shared';
import type {
  MatchEventJob,
  MatchStatus as CatalogMatchStatus,
  SelectionResult,
} from '../catalog/match-catalog.port';
import { Prisma } from '../generated/prisma/client';
import { MarketType, MatchStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES } from '../queues/queue-names';
import { resolveMarketOutcomes } from './market-outcomes';

const MATCH_STATUSES: ReadonlySet<string> = new Set(Object.values(MatchStatus));
const SELECTION_RESULTS: ReadonlySet<string> = new Set(['WON', 'LOST', 'VOID']);
const marketTypeToPublic: Record<MarketType, PublicMarketType> = {
  [MarketType.RESULT_1X2]: PublicMarketType.RESULT_1X2,
  [MarketType.DOUBLE_CHANCE]: PublicMarketType.DOUBLE_CHANCE,
  [MarketType.TOTAL_GOALS]: PublicMarketType.TOTAL_GOALS,
  [MarketType.BOTH_TEAMS_SCORE]: PublicMarketType.BOTH_TEAMS_SCORE,
};

type MarketForResult = {
  id: string;
  type: MarketType;
  line: Prisma.Decimal | null;
  selections: { id: string; key: string }[];
};

export function createMarketResultEvents(
  matchId: string,
  markets: MarketForResult[],
  homeScore: number,
  awayScore: number,
  corrected: boolean,
  occurredAt = new Date().toISOString(),
): MatchEventJob[] {
  const events: MatchEventJob[] = [];
  for (const market of markets) {
    if (market.selections.length === 0) continue;
    const results = resolveMarketOutcomes(
      marketTypeToPublic[market.type],
      market.line === null ? null : Number(market.line.toString()),
      homeScore,
      awayScore,
      market.selections.map(({ id, key }) => ({ id, key })),
    );
    if (corrected)
      events.push({
        type: 'RESULT_CORRECTED',
        sourceEventId: randomUUID(),
        matchId,
        marketId: market.id,
        results,
        occurredAt,
      });
    else
      events.push({
        type: 'MARKET_RESULTED',
        sourceEventId: randomUUID(),
        matchId,
        marketId: market.id,
        results,
        occurredAt,
      });
  }
  return events;
}

export function createMatchStatusEvent(
  matchId: string,
  status: MatchStatus,
  scheduledStart: Date,
  occurredAt = new Date().toISOString(),
): MatchEventJob {
  return {
    type: 'MATCH_STATUS_CHANGED',
    sourceEventId: randomUUID(),
    matchId,
    status: catalogStatus(status),
    scheduledStart: scheduledStart.toISOString(),
    occurredAt,
  };
}

function catalogStatus(status: MatchStatus): CatalogMatchStatus {
  switch (status) {
    case MatchStatus.SCHEDULED:
      return 'SCHEDULED';
    case MatchStatus.LIVE:
      return 'LIVE';
    case MatchStatus.FINISHED:
      return 'FINISHED';
    case MatchStatus.SUSPENDED:
      return 'SUSPENDED';
    case MatchStatus.POSTPONED:
      return 'POSTPONED';
    case MatchStatus.CANCELLED:
      return 'CANCELLED';
  }
  throw new Error(`Estado de partido sin equivalencia en el catálogo: ${status}`);
}

@Injectable()
export class MatchEventPublisher implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.MATCH_EVENTS) private readonly queue: Queue<MatchEventJob>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.dispatchPending();
  }

  async stage(tx: Prisma.TransactionClient, events: readonly MatchEventJob[]): Promise<void> {
    const firstAt = Date.now();
    for (const [index, event] of events.entries()) {
      await tx.matchEvent.create({
        data: {
          sourceEventId: event.sourceEventId,
          type: event.type,
          matchId: event.matchId,
          marketId: 'marketId' in event ? event.marketId : null,
          payload: event as unknown as Prisma.InputJsonObject,
          receivedAt: new Date(firstAt + index),
        },
      });
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchPending(): Promise<void> {
    const pending = await this.prisma.matchEvent.findMany({
      where: { processedAt: null },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { sourceEventId: true, payload: true },
    });
    for (const row of pending) {
      const event = parseEvent(row.payload);
      if (event.sourceEventId !== row.sourceEventId)
        throw new Error(`El evento ${row.sourceEventId} no coincide con su carga guardada.`);
      await this.queue.add(event.type, event, { jobId: event.sourceEventId });
    }
  }
}

function parseEvent(payload: Prisma.JsonValue): MatchEventJob {
  if (!isJsonObject(payload)) throw new Error('La carga de un evento de partido no es válida.');
  const sourceEventId = stringValue(payload.sourceEventId);
  const matchId = stringValue(payload.matchId);
  const occurredAt = stringValue(payload.occurredAt);
  if (!sourceEventId || !matchId || !occurredAt)
    throw new Error('El evento de partido no contiene sus identificadores y fecha.');

  if (payload.type === 'MATCH_STATUS_CHANGED') {
    const status = stringValue(payload.status);
    const scheduledStart = stringValue(payload.scheduledStart);
    if (!status || !MATCH_STATUSES.has(status) || !scheduledStart)
      throw new Error(`El evento ${sourceEventId} tiene un cambio de estado inválido.`);
    return {
      type: 'MATCH_STATUS_CHANGED',
      sourceEventId,
      matchId,
      status: status as CatalogMatchStatus,
      scheduledStart,
      occurredAt,
    };
  }

  if (payload.type === 'MARKET_RESULTED' || payload.type === 'RESULT_CORRECTED') {
    const marketId = stringValue(payload.marketId);
    const results = parseResults(payload.results);
    if (!marketId || !results)
      throw new Error(`El evento ${sourceEventId} tiene un resultado inválido.`);
    return {
      type: payload.type,
      sourceEventId,
      matchId,
      marketId,
      results,
      occurredAt,
    };
  }

  throw new Error(`El evento ${sourceEventId} tiene un tipo desconocido.`);
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function parseResults(value: Prisma.JsonValue | undefined): Record<string, SelectionResult> | null {
  if (value === undefined || !isJsonObject(value)) return null;
  const results: Record<string, SelectionResult> = {};
  for (const [selectionId, result] of Object.entries(value)) {
    if (typeof result !== 'string' || !SELECTION_RESULTS.has(result)) return null;
    results[selectionId] = result as SelectionResult;
  }
  return results;
}
