import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { type BetWithSelections, toBetView, type BetView } from '../betting/bets.dto';
import type { SelectionResult } from '../catalog/match-catalog.port';
import type { MatchEvent, Prisma } from '../generated/prisma/client';
import {
  BetStatus,
  LedgerTransactionType,
  SelectionStatus,
  StakeSource,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { betOutcome } from './bet-outcome';

/** Apuesta cuyo estado cambió, para avisar a su dueño. */
export interface SettledBet {
  userId: string;
  bet: BetView;
  /** Versión de liquidación vigente (0 si sigue abierta). */
  version: number;
}

/** Decide el nuevo estado de una selección a partir del evento; undefined = no la toca. */
type Resolver = (selection: BetWithSelections['selections'][number]) => SelectionStatus | undefined;

/** Las acciones automáticas se auditan como sistema (contracts/http-api.md § Auditoría). */
const SYSTEM_META = { actorId: null, ip: 'system', userAgent: 'worker' } as const;

/**
 * Liquidación de apuestas (FR-013 a FR-016, research R6). Cada apuesta se liquida en su propia
 * transacción con la fila bloqueada; la liquidación es una versión nueva única por apuesta y cada
 * asiento lleva una clave idempotente con esa versión, de modo que reprocesar un evento no paga
 * dos veces.
 */
@Injectable()
export class SettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
  ) {}

  /** MARKET_RESULTED: marca las selecciones del mercado y liquida las apuestas que quedan resueltas. */
  async applyMarketResult(event: MatchEvent): Promise<SettledBet[]> {
    const { marketId, results } = event.payload as {
      marketId: string;
      results: Record<string, SelectionResult>;
    };
    const pending = await this.prisma.betSelection.findMany({
      where: { marketId, status: SelectionStatus.PENDING },
      select: { betId: true },
      distinct: ['betId'],
    });

    const resolve: Resolver = (s) =>
      s.marketId === marketId && s.status === SelectionStatus.PENDING && results[s.selectionId]
        ? (results[s.selectionId] as SelectionStatus)
        : undefined;

    const changed: SettledBet[] = [];
    for (const { betId } of pending) {
      const result = await this.settleBet(betId, event.id, resolve);
      if (result) changed.push(result);
    }
    return changed;
  }

  /**
   * Aplica el evento a una apuesta abierta. Devuelve la apuesta si cambió algo (una selección o su
   * estado), o null si no había nada que hacer.
   */
  private settleBet(
    betId: string,
    matchEventId: string,
    resolve: Resolver,
  ): Promise<SettledBet | null> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Bet" WHERE id = ${betId}::uuid FOR UPDATE`;
        const bet = await tx.bet.findUniqueOrThrow({
          where: { id: betId },
          include: { selections: true },
        });
        if (bet.status !== BetStatus.OPEN) return null;

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

        const outcome = betOutcome({ stake: bet.stake, selections: bet.selections });
        if (outcome.status === BetStatus.OPEN)
          return { userId: bet.userId, bet: toBetView(bet), version: bet.settledVersion };

        const version = bet.settledVersion + 1;
        const ledgerTransactionIds = await this.pay(tx, bet, outcome, version);
        await tx.betSettlement.create({
          data: {
            betId,
            version,
            outcome: outcome.status,
            payout: outcome.payout,
            matchEventId,
            ledgerTransactionIds,
          },
        });
        const settled = await tx.bet.update({
          where: { id: betId },
          data: {
            status: outcome.status,
            payout: outcome.payout,
            settledVersion: version,
            settledAt: new Date(),
          },
          include: { selections: true },
        });
        await this.audit.record(
          {
            ...SYSTEM_META,
            action: 'bet.settled',
            targetType: 'bet',
            targetId: betId,
            metadata: { outcome: outcome.status, payout: outcome.payout, version, matchEventId },
          },
          tx,
        );
        return { userId: bet.userId, bet: toBetView(settled), version };
      },
      { maxWait: 15_000, timeout: 15_000 },
    );
  }

  /** Acredita el premio o el reembolso al mismo saldo del que salió el monto (FR-014). */
  private async pay(
    tx: Prisma.TransactionClient,
    bet: BetWithSelections,
    outcome: { status: string; payout: number },
    version: number,
  ): Promise<string[]> {
    if (outcome.payout <= 0) return [];
    const refund = outcome.status === BetStatus.VOID;
    const id = await this.wallet.credit({
      userId: bet.userId,
      amount: outcome.payout,
      balance: bet.source === StakeSource.BONUS ? 'BONUS' : 'REAL',
      type: refund ? LedgerTransactionType.BET_REFUND : LedgerTransactionType.BET_CREDIT,
      idempotencyKey: `bet:${bet.id}:${refund ? 'refund' : 'payout'}:v${version}`,
      reference: { type: 'bet', id: bet.id },
      tx,
    });
    return [id];
  }
}
