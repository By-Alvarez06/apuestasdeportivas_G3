import { getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { BettingSettingsService, type SettingKey } from '../src/betting/settings.service';
import type { MatchEventJob } from '../src/catalog/match-catalog.port';
import { SimulatedCatalog } from '../src/catalog/simulated/simulated-catalog';
import type { PrismaClient } from '../src/generated/prisma/client';
import { LedgerAccountType, LedgerTransactionType } from '../src/generated/prisma/enums';
import { QUEUES } from '../src/queues/queue-names';
import { jobIdFor } from '../src/queues/redis-connection';
import { WalletService } from '../src/wallet/wallet.service';
import { WEB_ORIGIN } from './setup';

export interface BetBody {
  selections: { selectionId: string; odds: string }[];
  stake: string;
  source?: 'REAL' | 'BONUS' | 'FREE_BET';
}

export interface BetView {
  id: string;
  type: 'SINGLE' | 'COMBO';
  status: string;
  stake: string;
  source: string;
  totalOdds: string;
  potentialPayout: string;
  payout: string;
  live: boolean;
  acceptedAt: string;
  settledAt: string | null;
  selections: {
    id: string;
    selectionId: string;
    matchLabel: string;
    marketLabel: string;
    selectionLabel: string;
    odds: string;
    status: string;
    startsAt: string;
  }[];
}

let seq = 0;

/** Carga saldo real o de bono a un usuario como si viniera de un depósito o un bono. */
export async function fund(
  app: NestExpressApplication,
  userId: string,
  cents: number,
  balance: 'REAL' | 'BONUS' = 'REAL',
): Promise<void> {
  const key = `test-fund:${++seq}:${crypto.randomUUID()}`;
  await app.get(WalletService).transfer({
    userId,
    amount: cents,
    from: LedgerAccountType.GATEWAY,
    to: balance === 'REAL' ? LedgerAccountType.USER_REAL : LedgerAccountType.USER_BONUS,
    type: balance === 'REAL' ? LedgerTransactionType.DEPOSIT : LedgerTransactionType.BONUS_CREDIT,
    idempotencyKey: key,
    reference: { type: 'test', id: key },
  });
}

export const balances = (app: NestExpressApplication, userId: string) =>
  app.get(WalletService).getBalances(userId);

/** POST /bets con su Idempotency-Key (una nueva salvo que se indique). */
export function placeBet(
  app: NestExpressApplication,
  cookie: string,
  body: BetBody,
  key = `bet-${crypto.randomUUID()}`,
) {
  return request(app.getHttpServer())
    .post('/bets')
    .set('Cookie', cookie)
    .set('Origin', WEB_ORIGIN)
    .set('Idempotency-Key', key)
    .send({ source: 'REAL', ...body });
}

/** Apuesta simple a una selección del catálogo simulado. */
export const single = (selectionId: string, odds: string, stake: string): BetBody => ({
  selections: [{ selectionId, odds }],
  stake,
});

export async function setSetting(
  app: NestExpressApplication,
  key: SettingKey,
  value: number,
): Promise<void> {
  await app.get(BettingSettingsService).set(key, value, crypto.randomUUID(), {
    ip: '127.0.0.1',
    userAgent: 'jest',
  });
}

export const catalogOf = (app: NestExpressApplication) => app.get(SimulatedCatalog);

// ── Eventos de resultado (spec 3 simulada) ──────────────────────────────────

/** Encola un evento en match-events como lo haría la spec 3 (jobId estable por sourceEventId). */
export async function publish(
  app: NestExpressApplication,
  event: Omit<MatchEventJob, 'occurredAt'> & { occurredAt?: string },
): Promise<void> {
  const job = { occurredAt: new Date().toISOString(), ...event } as MatchEventJob;
  await app
    .get<Queue<MatchEventJob>>(getQueueToken(QUEUES.MATCH_EVENTS))
    .add(job.type, job, { jobId: jobIdFor(job.sourceEventId) });
}

/** Resultado de un mercado 1X2 del catálogo simulado: gana `winner`, pierden las otras. */
export function result1x2(
  matchId: string,
  winner: 'home' | 'draw' | 'away',
  sourceEventId = `res-${matchId}-${crypto.randomUUID()}`,
): MatchEventJob {
  const market = `${matchId}-1x2`;
  const results = Object.fromEntries(
    (['home', 'draw', 'away'] as const).map((s) => [
      `${market}-${s}`,
      s === winner ? 'WON' : 'LOST',
    ]),
  ) as Record<string, 'WON' | 'LOST'>;
  return {
    type: 'MARKET_RESULTED',
    sourceEventId,
    matchId,
    marketId: market,
    results,
    occurredAt: new Date().toISOString(),
  };
}

/** Espera hasta que `check` devuelva un valor verdadero (o falla al vencer el plazo). */
export async function waitFor<T>(
  check: () => Promise<T | null | undefined | false>,
  { timeoutMs = 10_000, intervalMs = 50 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('waitFor: se agotó el tiempo de espera');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Espera a que el worker termine de procesar el evento. */
export const processed = (prisma: PrismaClient, sourceEventId: string) =>
  waitFor(() =>
    prisma.matchEvent.findFirst({ where: { sourceEventId, processedAt: { not: null } } }),
  );

/** Cambio de estado de un partido del catálogo simulado (suspendido, aplazado, cancelado…). */
export async function statusEvent(
  app: NestExpressApplication,
  matchId: string,
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'SUSPENDED' | 'POSTPONED' | 'CANCELLED',
  sourceEventId = `st-${matchId}-${status}-${crypto.randomUUID()}`,
): Promise<MatchEventJob> {
  const [quote] = await catalogOf(app).getQuotes([`${matchId}-1x2-home`]);
  return {
    type: 'MATCH_STATUS_CHANGED',
    sourceEventId,
    matchId,
    status,
    scheduledStart: quote!.startsAt.toISOString(),
    occurredAt: new Date().toISOString(),
  };
}

/** Corrección de un mercado 1X2: el resultado completo nuevo. */
export function correction1x2(
  matchId: string,
  winner: 'home' | 'draw' | 'away',
  sourceEventId = `cor-${matchId}-${crypto.randomUUID()}`,
): MatchEventJob {
  return { ...result1x2(matchId, winner, sourceEventId), type: 'RESULT_CORRECTED' };
}
