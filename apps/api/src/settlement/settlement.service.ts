import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { type BetWithSelections, toBetView, type BetView } from '../betting/bets.dto';
import type { SelectionResult } from '../catalog/match-catalog.port';
import type { MatchEvent, Prisma } from '../generated/prisma/client';
import {
  BetStatus,
  HoldResolution,
  LedgerTransactionType,
  SelectionStatus,
  StakeSource,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { betOutcome, type Outcome } from './bet-outcome';
import { BonusService } from '../promotions/bonus.service';
import { DebtService } from './debt.service';

/** Apuesta cuyo estado cambió, para avisar a su dueño. */
export interface SettledBet {
  userId: string;
  bet: BetView;
  /** Versión de liquidación vigente (0 si nunca se liquidó). */
  version: number;
  /** Deuda creada por esta re-liquidación (centavos), para la regla de fraude. */
  debt?: number;
}

type Selection = BetWithSelections['selections'][number];

/** Decide el nuevo estado de una selección a partir del evento; undefined = no la toca. */
type Resolver = (selection: Selection) => SelectionStatus | undefined;

/** Las acciones automáticas se auditan como sistema (contracts/http-api.md § Auditoría). */
const SYSTEM_META = { actorId: null, ip: 'system', userAgent: 'worker' } as const;

/** Partidos anulados de forma definitiva: sus resultados y correcciones ya no se aplican. */
const FINAL_VOID: ReadonlySet<HoldResolution> = new Set([
  HoldResolution.VOIDED,
  HoldResolution.CANCELLED,
]);

/** Saldo al que vuelve el dinero: la apuesta gratis paga al bono (FR-028). */
const balanceOf = (source: StakeSource) => (source === StakeSource.REAL ? 'REAL' : 'BONUS');

/**
 * Lo que se acredita por un resultado. La apuesta gratis paga solo la ganancia neta y, si se anula,
 * no reembolsa dinero (se devuelve la apuesta gratis).
 */
export function creditFor(bet: { source: StakeSource; stake: number }, outcome: Outcome): number {
  if (outcome.status === BetStatus.OPEN) return 0;
  if (bet.source !== StakeSource.FREE_BET) return outcome.payout;
  return outcome.status === BetStatus.WON ? outcome.payout - bet.stake : 0;
}

/**
 * Liquidación de apuestas (FR-013 a FR-024, research R6–R8). Cada apuesta se procesa en su propia
 * transacción con la fila bloqueada. Cada liquidación es una versión nueva única por apuesta y
 * cada asiento lleva una clave idempotente con esa versión: reprocesar un evento no paga dos veces.
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
    private readonly debts: DebtService,
    private readonly bonuses: BonusService,
  ) {}

  /** MARKET_RESULTED: marca las selecciones del mercado y liquida las apuestas que quedan resueltas. */
  async applyMarketResult(event: MatchEvent): Promise<SettledBet[]> {
    const { marketId, results } = this.marketPayload(event);
    const resolve: Resolver = (s) =>
      s.marketId === marketId && s.status === SelectionStatus.PENDING
        ? (results[s.selectionId] as SelectionStatus | undefined)
        : undefined;
    return this.forBets({ marketId, status: SelectionStatus.PENDING }, (betId) =>
      this.settleBet(betId, event.id, resolve, false),
    );
  }

  /**
   * RESULT_CORRECTED (FR-019): aplica el resultado nuevo a todas las selecciones del mercado y
   * re-liquida las apuestas ya liquidadas cuyo resultado cambia.
   */
  async applyCorrection(event: MatchEvent): Promise<SettledBet[]> {
    const { marketId, results } = this.marketPayload(event);
    const hold = await this.prisma.matchHold.findUnique({ where: { matchId: event.matchId } });
    if (hold?.resolution && FINAL_VOID.has(hold.resolution)) {
      this.logger.warn(`Corrección ${event.sourceEventId} ignorada: el partido fue anulado`);
      return [];
    }
    const resolve: Resolver = (s) =>
      s.marketId === marketId ? (results[s.selectionId] as SelectionStatus | undefined) : undefined;
    return this.forBets({ marketId }, (betId) => this.settleBet(betId, event.id, resolve, true));
  }

  /**
   * Anula las selecciones pendientes de un partido (FR-022 a FR-024): las simples se reembolsan y
   * en las combinadas la selección cuenta con cuota 1.00. Los mercados ya resueltos no cambian.
   */
  voidMatch(matchId: string, matchEventId: string): Promise<SettledBet[]> {
    const resolve: Resolver = (s) =>
      s.matchId === matchId && s.status === SelectionStatus.PENDING
        ? SelectionStatus.VOID
        : undefined;
    return this.forBets({ matchId, status: SelectionStatus.PENDING }, (betId) =>
      this.settleBet(betId, matchEventId, resolve, false),
    );
  }

  // ── Núcleo ──────────────────────────────────────────────────────────────────

  private marketPayload(event: MatchEvent) {
    return event.payload as { marketId: string; results: Record<string, SelectionResult> };
  }

  /** Procesa una a una las apuestas con alguna selección que cumpla `where`. */
  private async forBets(
    where: Prisma.BetSelectionWhereInput,
    apply: (betId: string) => Promise<SettledBet | null>,
  ): Promise<SettledBet[]> {
    const rows = await this.prisma.betSelection.findMany({
      where,
      select: { betId: true },
      distinct: ['betId'],
    });
    const changed: SettledBet[] = [];
    for (const { betId } of rows) {
      const result = await apply(betId);
      if (result) changed.push(result);
    }
    return changed;
  }

  /**
   * Aplica el evento a las selecciones de una apuesta. Si estaba abierta y queda resuelta, la
   * liquida. Si ya estaba liquidada, solo registra los resultados, salvo que sea una corrección
   * (`resettle`) que cambie el resultado: entonces revierte y vuelve a liquidar.
   */
  private settleBet(
    betId: string,
    matchEventId: string,
    resolve: Resolver,
    resettle: boolean,
  ): Promise<SettledBet | null> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Bet" WHERE id = ${betId}::uuid FOR UPDATE`;
        const bet = await tx.bet.findUniqueOrThrow({
          where: { id: betId },
          include: { selections: true },
        });

        let touched = false;
        for (const s of bet.selections) {
          const next = resolve(s);
          if (!next || next === s.status) continue;
          await tx.betSelection.update({
            where: { id: s.id },
            data: { status: next, resultVersion: { increment: 1 } },
          });
          s.status = next;
          touched = true;
        }
        if (!touched) return null;

        const unchanged = { userId: bet.userId, bet: toBetView(bet), version: bet.settledVersion };
        const outcome = betOutcome({ stake: bet.stake, selections: bet.selections });

        if (bet.status === BetStatus.OPEN) {
          if (outcome.status === BetStatus.OPEN) return unchanged;
          return this.settle(tx, bet, outcome, matchEventId);
        }
        // Ya liquidada: un resultado posterior (p. ej. de otra selección de una combinada perdida)
        // solo se registra. Una corrección re-liquida si cambia el resultado o el pago.
        if (!resettle) return unchanged;
        if (outcome.status === bet.status && creditFor(bet, outcome) === bet.payout)
          return unchanged;
        return this.resettle(tx, bet, outcome, matchEventId);
      },
      { maxWait: 15_000, timeout: 15_000 },
    );
  }

  /** Primera liquidación de una apuesta abierta. */
  private async settle(
    tx: Prisma.TransactionClient,
    bet: BetWithSelections,
    outcome: Outcome,
    matchEventId: string,
  ): Promise<SettledBet> {
    const version = bet.settledVersion + 1;
    const credited = creditFor(bet, outcome);
    const ledgerTransactionIds = await this.pay(tx, bet, outcome, version);
    await tx.betSettlement.create({
      data: {
        betId: bet.id,
        version,
        outcome: outcome.status,
        payout: credited,
        matchEventId,
        ledgerTransactionIds,
      },
    });
    const settled = await tx.bet.update({
      where: { id: bet.id },
      data: {
        status: outcome.status,
        payout: credited,
        settledVersion: version,
        settledAt: new Date(),
      },
      include: { selections: true },
    });
    await this.applyPromotions(tx, bet, outcome, credited);
    await this.audit.record(
      {
        ...SYSTEM_META,
        action: outcome.status === BetStatus.VOID ? 'bet.voided' : 'bet.settled',
        targetType: 'bet',
        targetId: bet.id,
        metadata: { outcome: outcome.status, payout: credited, version, matchEventId },
      },
      tx,
    );
    return { userId: bet.userId, bet: toBetView(settled), version };
  }

  /**
   * Re-liquidación por corrección (FR-019, FR-020, research R7): revierte el pago anterior con un
   * asiento compensatorio hasta el saldo disponible, registra el resto como deuda y liquida con el
   * resultado nuevo como una versión nueva.
   */
  private async resettle(
    tx: Prisma.TransactionClient,
    bet: BetWithSelections,
    outcome: Outcome,
    matchEventId: string,
  ): Promise<SettledBet> {
    const version = bet.settledVersion + 1;
    const reversed = bet.payout;
    const ledgerTransactionIds: string[] = [];
    let debt = 0;

    if (reversed > 0) {
      await tx.$queryRaw`SELECT id FROM "Wallet" WHERE "userId" = ${bet.userId}::uuid FOR UPDATE`;
      const balances = await this.wallet.getBalances(bet.userId, tx);
      const balance = balanceOf(bet.source);
      const available = balance === 'BONUS' ? balances.bonus : balances.real;
      const take = Math.min(available, reversed);
      if (take > 0)
        ledgerTransactionIds.push(
          await this.wallet.debit({
            userId: bet.userId,
            amount: take,
            balance,
            type: LedgerTransactionType.BET_REVERSAL,
            idempotencyKey: `bet:${bet.id}:reversal:v${version}`,
            reference: { type: 'bet', id: bet.id },
            tx,
          }),
        );
      debt = reversed - take;
      if (debt > 0) await this.debts.create(tx, bet.userId, bet.id, debt);
    }

    const credited = creditFor(bet, outcome);
    ledgerTransactionIds.push(...(await this.pay(tx, bet, outcome, version)));
    await tx.betSettlement.create({
      data: {
        betId: bet.id,
        version,
        outcome: outcome.status,
        payout: credited,
        reversedAmount: reversed,
        matchEventId,
        ledgerTransactionIds,
      },
    });
    const reopened = outcome.status === BetStatus.OPEN;
    const updated = await tx.bet.update({
      where: { id: bet.id },
      data: {
        status: outcome.status,
        payout: credited,
        settledVersion: version,
        settledAt: reopened ? null : new Date(),
      },
      include: { selections: true },
    });
    await this.audit.record(
      {
        ...SYSTEM_META,
        action: 'bet.resettled',
        targetType: 'bet',
        targetId: bet.id,
        metadata: {
          previousOutcome: bet.status,
          previousPayout: bet.payout,
          outcome: outcome.status,
          payout: credited,
          version,
          reversed,
          debt,
          matchEventId,
        },
      },
      tx,
    );
    return { userId: bet.userId, bet: toBetView(updated), version, debt };
  }

  /**
   * Efectos de promociones de la primera liquidación (FR-028, FR-032): la ganancia de una apuesta
   * gratis abre o amplía un bono con rollover; una apuesta gratis anulada vuelve a estar disponible
   * si su cupón sigue vigente; una apuesta con bono suma al rollover.
   */
  private async applyPromotions(
    tx: Prisma.TransactionClient,
    bet: BetWithSelections,
    outcome: Outcome,
    credited: number,
  ): Promise<void> {
    if (bet.source === StakeSource.FREE_BET) {
      if (outcome.status === BetStatus.WON && credited > 0)
        await this.bonuses.grantFromFreeBet(tx, bet.userId, credited, bet.id);
      if (outcome.status === BetStatus.VOID && bet.freeBetId)
        await tx.freeBet.updateMany({
          where: { id: bet.freeBetId, expiresAt: { gt: new Date() } },
          data: { usedAt: null },
        });
      return;
    }
    if (outcome.status === BetStatus.WON || outcome.status === BetStatus.LOST)
      await this.bonuses.recordWager(tx, bet);
  }

  /** Acredita el premio o el reembolso al mismo saldo del que salió el monto (FR-014). */
  private async pay(
    tx: Prisma.TransactionClient,
    bet: BetWithSelections,
    outcome: Outcome,
    version: number,
  ): Promise<string[]> {
    const amount = creditFor(bet, outcome);
    if (amount <= 0) return [];
    const refund = outcome.status === BetStatus.VOID;
    const id = await this.wallet.credit({
      userId: bet.userId,
      amount,
      balance: balanceOf(bet.source),
      type: refund ? LedgerTransactionType.BET_REFUND : LedgerTransactionType.BET_CREDIT,
      idempotencyKey: `bet:${bet.id}:${refund ? 'refund' : 'payout'}:v${version}`,
      reference: { type: 'bet', id: bet.id },
      tx,
    });
    return [id];
  }
}
