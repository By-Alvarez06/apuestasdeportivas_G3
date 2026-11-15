import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ErrorCode, fromCents } from '@apuestas/shared';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors/domain-error';
import type { Prisma } from '../generated/prisma/client';
import { LedgerTransactionType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

export const debtOutstanding = (amount: number) =>
  new DomainError(
    ErrorCode.DEBT_OUTSTANDING,
    `Tienes un saldo pendiente de ${fromCents(amount)} USD por la corrección de un resultado. ` +
      'Se descuenta de tu próximo depósito o premio; hasta entonces no puedes apostar ni retirar.',
    HttpStatus.LOCKED,
    { amount: fromCents(amount) },
  );

const SYSTEM_META = { actorId: null, ip: 'system', userAgent: 'worker' } as const;

/**
 * Saldo adeudado tras una re-liquidación (FR-020, research R7). El libro contable nunca queda en
 * negativo: lo que no se pudo revertir se registra como deuda, que bloquea apostar y retirar y se
 * cobra de los créditos posteriores.
 */
@Injectable()
export class DebtService {
  private readonly logger = new Logger(DebtService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
  ) {}

  /** Deuda pendiente del usuario en centavos (0 si no tiene). */
  async openDebt(userId: string, tx: Prisma.TransactionClient = this.prisma): Promise<number> {
    const debts = await tx.betDebt.findMany({
      where: { userId, closedAt: null },
      select: { amount: true, collected: true },
    });
    return debts.reduce((sum, d) => sum + d.amount - d.collected, 0);
  }

  /** Lanza DEBT_OUTSTANDING si el usuario debe algo. */
  async assertNoOpenDebt(userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const pending = await this.openDebt(userId, tx);
    if (pending > 0) throw debtOutstanding(pending);
  }

  /** Registra una deuda nueva dentro de la transacción de la re-liquidación. */
  async create(
    tx: Prisma.TransactionClient,
    userId: string,
    betId: string,
    amount: number,
  ): Promise<string> {
    const debt = await tx.betDebt.create({ data: { userId, betId, amount } });
    await this.audit.record(
      {
        ...SYSTEM_META,
        action: 'debt.created',
        targetType: 'debt',
        targetId: debt.id,
        metadata: { userId, betId, amount },
      },
      tx,
    );
    return debt.id;
  }

  /** Cada minuto: cobra las deudas abiertas con el saldo real y luego con el de bono. */
  @Cron(CronExpression.EVERY_MINUTE)
  async collect(): Promise<string[]> {
    const debts = await this.prisma.betDebt.findMany({
      where: { closedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const touchedUsers = new Set<string>();
    for (const { id } of debts) {
      try {
        const userId = await this.collectOne(id);
        if (userId) touchedUsers.add(userId);
      } catch (error) {
        this.logger.error(`No se pudo cobrar la deuda ${id}: ${String(error)}`);
      }
    }
    return [...touchedUsers];
  }

  /** Cobra lo que se pueda de una deuda. Devuelve el usuario si se movió dinero. */
  private collectOne(debtId: string): Promise<string | null> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "BetDebt" WHERE id = ${debtId}::uuid FOR UPDATE`;
        const debt = await tx.betDebt.findUniqueOrThrow({ where: { id: debtId } });
        if (debt.closedAt) return null;
        await tx.$queryRaw`SELECT id FROM "Wallet" WHERE "userId" = ${debt.userId}::uuid FOR UPDATE`;
        const available = await this.wallet.getBalances(debt.userId, tx);

        let collected = debt.collected;
        for (const balance of ['REAL', 'BONUS'] as const) {
          const amount = Math.min(
            debt.amount - collected,
            balance === 'REAL' ? available.real : available.bonus,
          );
          if (amount <= 0) continue;
          // La clave incluye lo cobrado hasta ahora: cada cobro parcial es un asiento distinto.
          await this.wallet.debit({
            userId: debt.userId,
            amount,
            balance,
            type: LedgerTransactionType.DEBT_COLLECTION,
            idempotencyKey: `debt:${debt.id}:collect:${collected}`,
            reference: { type: 'debt', id: debt.id },
            tx,
          });
          collected += amount;
        }
        if (collected === debt.collected) return null;

        const closed = collected >= debt.amount;
        await tx.betDebt.update({
          where: { id: debt.id },
          data: { collected, closedAt: closed ? new Date() : null },
        });
        await this.audit.record(
          {
            ...SYSTEM_META,
            action: 'debt.collected',
            targetType: 'debt',
            targetId: debt.id,
            metadata: { amount: collected - debt.collected, collected, closed },
          },
          tx,
        );
        return debt.userId;
      },
      { maxWait: 15_000, timeout: 15_000 },
    );
  }
}
