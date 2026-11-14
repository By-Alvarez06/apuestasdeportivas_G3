import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { parseOdds, toCents } from '@apuestas/shared';
import { AuditService } from '../audit/audit.service';
import { DomainError, notFound, validationError } from '../common/errors/domain-error';
import type { RequestMeta } from '../common/request-meta';
import {
  MATCH_CATALOG,
  type MatchCatalogPort,
  type MatchStatus,
  type SelectionQuote,
} from '../catalog/match-catalog.port';
import { Prisma } from '../generated/prisma/client';
import { BetStatus, BetType, StakeSource } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { DebtService } from '../settlement/debt.service';
import { IdempotencyConflictError, WalletNotFoundError } from '../wallet/wallet.port';
import { WalletService } from '../wallet/wallet.service';
import {
  AUDITED_REJECTIONS,
  dailyLimit,
  marketClosed,
  matchStarted,
  oddsChanged,
  payoutLimit,
  stakeOutOfLimits,
} from './bet-errors';
import {
  type BetView,
  type BetWithSelections,
  type PlaceBetDto,
  type SelectionHold,
  toBetView,
} from './bets.dto';
import { potentialPayout, totalOddsX } from './odds';
import { BettingSettingsService } from './settings.service';

/** Contexto de la petición: auditoría y señales para las reglas de fraude. */
export interface PlaceContext extends RequestMeta {
  deviceId?: string;
}

interface Requested {
  selectionId: string;
  odds: number;
}

/** Estados de partido en los que su mercado puede aceptar apuestas. */
const BETTABLE_MATCH: ReadonlySet<MatchStatus> = new Set(['SCHEDULED', 'LIVE']);

/** Ecuador (UTC-5, sin horario de verano): el límite diario se reinicia a medianoche local. */
const BUSINESS_UTC_OFFSET_MS = -5 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

export function businessDayStart(now: Date): Date {
  const local = now.getTime() + BUSINESS_UTC_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - BUSINESS_UTC_OFFSET_MS);
}

/** Filtro de estado y fechas del historial. */
function filters(query: { status?: 'OPEN' | 'SETTLED'; from?: string; to?: string }) {
  return {
    status:
      query.status === 'OPEN'
        ? BetStatus.OPEN
        : query.status === 'SETTLED'
          ? { not: BetStatus.OPEN }
          : undefined,
    acceptedAt: {
      gte: query.from ? new Date(query.from) : undefined,
      lte: query.to ? new Date(query.to) : undefined,
    },
  } satisfies Prisma.BetWhereInput;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Aceptación de apuestas (FR-001 a FR-012, research R4 y R5). El servidor relee cuotas, estados y
 * horas del catálogo, recalcula el pago y, en una sola transacción con la billetera bloqueada,
 * valida el límite diario, registra la apuesta y descuenta el monto.
 */
@Injectable()
export class BetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
    private readonly settings: BettingSettingsService,
    private readonly debts: DebtService,
    @Inject(MATCH_CATALOG) private readonly catalog: MatchCatalogPort,
  ) {}

  /** Devuelve la apuesta y si se creó ahora (false = la clave ya existía con los mismos datos). */
  async place(
    userId: string,
    dto: PlaceBetDto,
    requestKey: string,
    ctx: PlaceContext,
  ): Promise<{ bet: BetView; created: boolean }> {
    const stake = toCents(dto.stake);
    const requested: Requested[] = dto.selections.map((s) => ({
      selectionId: s.selectionId,
      odds: parseOdds(s.odds),
    }));

    const previous = await this.findByKey(userId, requestKey);
    if (previous)
      return { bet: this.replay(previous, stake, dto.source, requested), created: false };

    try {
      if (dto.source === StakeSource.FREE_BET)
        throw validationError('Las apuestas gratis se usan desde Promociones.');
      const quotes = await this.validate(stake, requested);

      if (quotes.some((q) => this.isLive(q))) {
        await sleep(await this.settings.get('live.delayMs'));
        await this.validate(stake, requested);
      }

      const bet = await this.accept(userId, requestKey, stake, dto.source, requested, quotes, ctx);
      return { bet: toBetView(bet), created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Otra petición con la misma clave ganó la carrera: se devuelve la suya.
        const winner = await this.findByKey(userId, requestKey);
        if (winner)
          return { bet: this.replay(winner, stake, dto.source, requested), created: false };
      }
      if (error instanceof DomainError && AUDITED_REJECTIONS.has(error.code))
        await this.audit.record({
          actorId: userId,
          action: 'bet.rejected',
          metadata: {
            reason: error.code,
            selections: requested.map((r) => r.selectionId),
            stake,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      throw error;
    }
  }

  async list(
    userId: string,
    query: {
      status?: 'OPEN' | 'SETTLED';
      from?: string;
      to?: string;
      page: number;
      pageSize: number;
    },
  ) {
    const { items, total } = await this.page({ userId, ...filters(query) }, query);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async get(userId: string, betId: string): Promise<BetView> {
    const bet = await this.prisma.bet.findFirst({
      where: { id: betId, userId },
      include: { selections: true },
    });
    if (!bet) throw notFound('No encontramos esa apuesta.');
    return toBetView(bet, await this.holdsFor([bet]));
  }

  /** Apuestas de un partido para el operador (FR-025); incluye el id del apostador. */
  async listForOperator(query: {
    matchId?: string;
    status?: 'OPEN' | 'SETTLED';
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.BetWhereInput = {
      ...filters(query),
      selections: query.matchId ? { some: { matchId: query.matchId } } : undefined,
    };
    const { rows, items, total } = await this.page(where, query);
    return {
      items: items.map((view, i) => ({ ...view, userId: rows[i]!.userId })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Partidos en espera y los resueltos en la última semana, con sus apuestas en espera. */
  async listHolds() {
    const holds = await this.prisma.matchHold.findMany({
      where: {
        OR: [{ resolvedAt: null }, { resolvedAt: { gte: new Date(Date.now() - 7 * DAY_MS) } }],
      },
      orderBy: [{ resolvedAt: { sort: 'desc', nulls: 'first' } }, { deadline: 'asc' }],
    });
    return Promise.all(
      holds.map(async (h) => {
        const [label, openBets] = await Promise.all([
          this.prisma.betSelection.findFirst({
            where: { matchId: h.matchId },
            select: { matchLabel: true },
          }),
          this.prisma.bet.count({
            where: {
              status: BetStatus.OPEN,
              selections: { some: { matchId: h.matchId, status: 'PENDING' } },
            },
          }),
        ]);
        return {
          matchId: h.matchId,
          matchLabel: label?.matchLabel ?? h.matchId,
          status: h.status,
          deadline: h.deadline.toISOString(),
          resolution: h.resolution,
          resolvedAt: h.resolvedAt?.toISOString() ?? null,
          openBets,
        };
      }),
    );
  }

  private async page(
    where: Prisma.BetWhereInput,
    query: { page: number; pageSize: number },
  ): Promise<{ rows: BetWithSelections[]; items: BetView[]; total: number }> {
    const [total, rows] = await Promise.all([
      this.prisma.bet.count({ where }),
      this.prisma.bet.findMany({
        where,
        include: { selections: true },
        orderBy: [{ acceptedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const holds = await this.holdsFor(rows);
    return { rows, items: rows.map((bet) => toBetView(bet, holds)), total };
  }

  /** Partidos en espera (sin resolver) de las selecciones pendientes de estas apuestas. */
  private async holdsFor(bets: BetWithSelections[]): Promise<Map<string, SelectionHold>> {
    const matchIds = [
      ...new Set(
        bets.flatMap((b) =>
          b.selections.filter((s) => s.status === 'PENDING').map((s) => s.matchId),
        ),
      ),
    ];
    if (matchIds.length === 0) return new Map();
    const holds = await this.prisma.matchHold.findMany({
      where: { matchId: { in: matchIds }, resolvedAt: null },
    });
    return new Map(
      holds.map((h) => [h.matchId, { status: h.status, deadline: h.deadline.toISOString() }]),
    );
  }

  /** Monto apostado hoy (día local de Ecuador) con saldo real o de bono. */
  async dailyStakeUsed(
    userId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const { _sum } = await tx.bet.aggregate({
      where: {
        userId,
        source: { in: [StakeSource.REAL, StakeSource.BONUS] },
        acceptedAt: { gte: businessDayStart(new Date()) },
      },
      _sum: { stake: true },
    });
    return _sum.stake ?? 0;
  }

  // ── Validación ──────────────────────────────────────────────────────────────

  /** Valida límites, mercados, horas y cuotas con datos del servidor. Devuelve las cotizaciones. */
  private async validate(stake: number, requested: Requested[]): Promise<SelectionQuote[]> {
    const limits = await this.settings.getAll();
    const ids = requested.map((r) => r.selectionId);
    if (new Set(ids).size !== ids.length)
      throw validationError('No puedes repetir una selección en el mismo boleto.');
    if (requested.length > limits['combo.maxSelections'])
      throw validationError(
        `Una combinada admite como máximo ${limits['combo.maxSelections']} selecciones.`,
      );
    if (stake < limits['limits.minStake'] || stake > limits['limits.maxStake'])
      throw stakeOutOfLimits(limits['limits.minStake'], limits['limits.maxStake']);

    const found = await this.catalog.getQuotes(ids);
    const quotes = ids.map((id) => {
      const quote = found.find((q) => q.selectionId === id);
      if (!quote) throw notFound('Una de las selecciones ya no existe.');
      return quote;
    });
    if (new Set(quotes.map((q) => q.matchId)).size !== quotes.length)
      throw validationError('Las selecciones de una combinada deben ser de partidos distintos.');

    const now = new Date();
    for (const q of quotes) {
      if (q.marketStatus !== 'OPEN' || !BETTABLE_MATCH.has(q.matchStatus)) throw marketClosed();
      if (now >= q.startsAt && !this.isLive(q)) throw matchStarted();
    }

    const changed = quotes.filter((q, i) => q.odds !== requested[i]!.odds);
    if (changed.length > 0) throw oddsChanged(changed);

    const odds = quotes.map((q) => q.odds);
    if (potentialPayout(stake, odds) > limits['limits.maxPayout']) {
      const product = totalOddsX(odds);
      const maxStake = (BigInt(limits['limits.maxPayout']) * 100n ** BigInt(odds.length)) / product;
      throw payoutLimit(Number(maxStake));
    }
    return quotes;
  }

  /** Apuesta en vivo: el partido está en juego y el operador habilitó el mercado para ello. */
  private isLive(q: SelectionQuote): boolean {
    return q.matchStatus === 'LIVE' && q.liveBettingEnabled;
  }

  // ── Aceptación atómica ──────────────────────────────────────────────────────

  private accept(
    userId: string,
    requestKey: string,
    stake: number,
    source: StakeSource,
    requested: Requested[],
    quotes: SelectionQuote[],
    ctx: PlaceContext,
  ): Promise<BetWithSelections> {
    const odds = quotes.map((q) => q.odds);
    return this.prisma.$transaction(
      async (tx) => {
        // Bloquea la billetera: apuestas simultáneas del mismo usuario se serializan aquí.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Wallet" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
        if (locked.length === 0) throw new WalletNotFoundError();

        // FR-020: con saldo adeudado por una re-liquidación no se puede apostar.
        await this.debts.assertNoOpenDebt(userId, tx);

        const limit = await this.settings.get('limits.dailyStakePerUser');
        const used = await this.dailyStakeUsed(userId, tx);
        if (used + stake > limit) throw dailyLimit(Math.max(0, limit - used));

        const betId = randomUUID();
        const bet = await tx.bet.create({
          data: {
            id: betId,
            userId,
            requestKey,
            type: requested.length === 1 ? BetType.SINGLE : BetType.COMBO,
            stake,
            source,
            totalOddsX: totalOddsX(odds).toString(),
            potentialPayout: potentialPayout(stake, odds),
            live: quotes.some((q) => this.isLive(q)),
            deviceId: ctx.deviceId,
            ip: ctx.ip,
            selections: {
              create: quotes.map((q) => ({
                selectionId: q.selectionId,
                marketId: q.marketId,
                matchId: q.matchId,
                odds: q.odds,
                matchLabel: q.labels.match,
                marketLabel: q.labels.market,
                selectionLabel: q.labels.selection,
                startsAt: q.startsAt,
              })),
            },
          },
          include: { selections: true },
        });

        await this.wallet.debit({
          userId,
          amount: stake,
          balance: source === StakeSource.BONUS ? 'BONUS' : 'REAL',
          idempotencyKey: `bet:${betId}:stake`,
          reference: { type: 'bet', id: betId },
          tx,
        });

        await this.audit.record(
          {
            actorId: userId,
            action: 'bet.placed',
            targetType: 'bet',
            targetId: betId,
            metadata: {
              type: bet.type,
              stake,
              source,
              odds,
              potentialPayout: bet.potentialPayout,
              live: bet.live,
              deviceId: ctx.deviceId ?? null,
            },
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          },
          tx,
        );
        return bet;
      },
      // Muchas apuestas simultáneas del mismo usuario esperan el bloqueo de la billetera.
      { maxWait: 15_000, timeout: 15_000 },
    );
  }

  // ── Idempotencia ────────────────────────────────────────────────────────────

  private findByKey(userId: string, requestKey: string): Promise<BetWithSelections | null> {
    return this.prisma.bet.findUnique({
      where: { userId_requestKey: { userId, requestKey } },
      include: { selections: true },
    });
  }

  /** Repetición de una solicitud: debe pedir lo mismo que la original. */
  private replay(
    bet: BetWithSelections,
    stake: number,
    source: StakeSource,
    requested: Requested[],
  ): BetView {
    const sameSelections =
      bet.selections.length === requested.length &&
      requested.every((r) => bet.selections.some((s) => s.selectionId === r.selectionId));
    if (bet.stake !== stake || bet.source !== source || !sameSelections)
      throw new IdempotencyConflictError();
    return toBetView(bet);
  }
}
