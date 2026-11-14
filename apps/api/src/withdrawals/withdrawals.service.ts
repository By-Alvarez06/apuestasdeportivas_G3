import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode, fromCents, toCents } from '@apuestas/shared';
import { AuditService } from '../audit/audit.service';
import { twoFactorRequired, TwoFactorService } from '../auth/two-factor.service';
import { DomainError, forbidden, notFound, validationError } from '../common/errors/domain-error';
import type { RequestMeta } from '../common/request-meta';
import type { Withdrawal } from '../generated/prisma/client';
import {
  DepositStatus,
  LedgerAccountType,
  LedgerTransactionType,
  UserStatus,
  WithdrawalStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyConflictError } from '../wallet/wallet.port';
import type { Tx } from '../wallet/ledger.service';
import { WalletService } from '../wallet/wallet.service';

const RECENT_DEPOSIT_MS = 24 * 60 * 60 * 1000;
const TWO_FACTOR_WINDOW_MS = 15 * 60 * 1000;
const MAX_TWO_FACTOR_FAILURES = 5;
const DEFAULT_REVIEW_THRESHOLD_CENTS = 20_000;

export interface WithdrawalRequest {
  amount: string;
  destinationDocument: string;
  destinationPhone: string;
  totpCode: string;
}

export interface WithdrawalView {
  id: string;
  amount: string;
  status: WithdrawalStatus;
  destinationDocument: string;
  destinationPhone: string;
  reviewReason: string | null;
  createdAt: string;
}

export const withdrawalView = (w: Withdrawal): WithdrawalView => ({
  id: w.id,
  amount: fromCents(w.amount),
  status: w.status,
  destinationDocument: w.destinationDocument,
  destinationPhone: w.destinationPhone,
  reviewReason: w.reviewReason,
  createdAt: w.createdAt.toISOString(),
});

/** UUID estable a partir de usuario + Idempotency-Key: reintentar encuentra el mismo retiro. */
function idFor(userId: string, key: string): string {
  const h = createHash('sha256').update(`withdrawal:${userId}:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Retiros de FR-026…FR-030: solo saldo real, con 2FA, al mismo titular de los depósitos. El monto se
 * retiene al pedirlo; se paga (referencia simulada, el sandbox no admite pagos salientes) o se libera.
 */
@Injectable()
export class WithdrawalsService {
  private readonly reviewThreshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly twoFactor: TwoFactorService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.reviewThreshold = Number(
      config.get('WITHDRAWAL_REVIEW_THRESHOLD_CENTS', DEFAULT_REVIEW_THRESHOLD_CENTS),
    );
  }

  async request(
    userId: string,
    req: WithdrawalRequest,
    idempotencyKey: string,
    meta: RequestMeta,
  ): Promise<WithdrawalView> {
    let amount: number;
    try {
      amount = toCents(req.amount);
    } catch {
      throw validationError('Escribe un monto válido, por ejemplo 20.00.');
    }

    const id = idFor(userId, idempotencyKey);
    const existing = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (existing) {
      if (existing.amount !== amount || existing.userId !== userId)
        throw new IdempotencyConflictError();
      return withdrawalView(existing);
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== UserStatus.ACTIVE) throw forbidden('Confirma tu correo para retirar.');
    if (!user.totpEnabledAt)
      throw twoFactorRequired('Activa la verificación en dos pasos para poder retirar.');
    // FR-005 aplicado al 2FA: 5 códigos incorrectos en 15 minutos bloquean los retiros del usuario.
    const recentFailures = await this.prisma.auditLog.count({
      where: {
        actorId: userId,
        action: 'withdrawal.2fa.failed',
        createdAt: { gte: new Date(Date.now() - TWO_FACTOR_WINDOW_MS) },
      },
    });
    if (recentFailures >= MAX_TWO_FACTOR_FAILURES)
      throw new DomainError(
        ErrorCode.ACCOUNT_LOCKED,
        'Demasiados códigos incorrectos. Podrás retirar de nuevo en 15 minutos.',
        HttpStatus.LOCKED,
      );
    if (!(await this.twoFactor.verify(userId, req.totpCode))) {
      await this.audit.record({ actorId: userId, action: 'withdrawal.2fa.failed', ...meta });
      throw twoFactorRequired('El código de verificación no es correcto.');
    }

    // FR-027: el destino debe ser el titular que Payphone informó en un depósito acreditado.
    const holderDeposit = await this.prisma.deposit.findFirst({
      where: {
        userId,
        status: DepositStatus.CREDITED,
        payerDocument: req.destinationDocument,
        payerPhone: req.destinationPhone,
      },
      select: { id: true },
    });
    if (!holderDeposit) {
      await this.audit.record({
        actorId: userId,
        action: 'withdrawal.holder_mismatch',
        metadata: {
          destinationDocument: req.destinationDocument,
          destinationPhone: req.destinationPhone,
        },
        ...meta,
      });
      throw forbidden('Solo puedes retirar a la misma persona y teléfono con los que depositaste.');
    }

    const reviewReason = await this.reviewReason(userId, amount);
    const withdrawal = await this.prisma.$transaction(async (tx) => {
      // hold bloquea la billetera y valida saldo real: dos retiros simultáneos no pueden pasar los dos.
      await this.wallet.hold({
        userId,
        amount,
        idempotencyKey: `withdrawal:${id}:hold`,
        reference: { type: 'withdrawal', id },
        tx,
      });
      const created = await tx.withdrawal.create({
        data: {
          id,
          userId,
          amount,
          destinationDocument: req.destinationDocument,
          destinationPhone: req.destinationPhone,
          status: reviewReason ? WithdrawalStatus.PENDING_APPROVAL : WithdrawalStatus.PROCESSING,
          reviewReason,
        },
      });
      await this.audit.record(
        {
          actorId: userId,
          action: 'withdrawal.requested',
          targetType: 'withdrawal',
          targetId: id,
          metadata: { amount, reviewReason },
          ...meta,
        },
        tx,
      );
      return created;
    });

    if (withdrawal.status === WithdrawalStatus.PROCESSING)
      return withdrawalView(await this.pay(withdrawal.id, null, meta));
    return withdrawalView(withdrawal);
  }

  async listOwn(userId: string): Promise<WithdrawalView[]> {
    const rows = await this.prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(withdrawalView);
  }

  async listForReview(status?: WithdrawalStatus) {
    const rows = await this.prisma.withdrawal.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: { user: { select: { email: true } } },
    });
    return rows.map((w) => ({ ...withdrawalView(w), email: w.user.email }));
  }

  /** Aprobación del administrador: paga desde lo retenido. */
  async approve(id: string, adminId: string, meta: RequestMeta): Promise<WithdrawalView> {
    return withdrawalView(await this.pay(id, adminId, meta));
  }

  /** Rechazo del administrador: libera lo retenido al saldo real. */
  async reject(
    id: string,
    adminId: string,
    reason: string,
    meta: RequestMeta,
  ): Promise<WithdrawalView> {
    const rejected = await this.prisma.$transaction(async (tx) => {
      const w = await this.lockForReview(id, tx);
      await this.wallet.release({
        userId: w.userId,
        amount: w.amount,
        idempotencyKey: `withdrawal:${id}:release`,
        reference: { type: 'withdrawal', id },
        tx,
      });
      const updated = await tx.withdrawal.update({
        where: { id },
        data: { status: WithdrawalStatus.REJECTED, reviewedById: adminId, reviewReason: reason },
      });
      await this.audit.record(
        {
          actorId: adminId,
          action: 'withdrawal.rejected',
          targetType: 'withdrawal',
          targetId: id,
          metadata: { reason },
          ...meta,
        },
        tx,
      );
      return updated;
    });
    return withdrawalView(rejected);
  }

  /**
   * Mueve lo retenido a PAYOUT con referencia simulada (FR-030). Sin `adminId`, solo paga retiros en
   * PROCESSING (los automáticos); con `adminId`, solo los PENDING_APPROVAL.
   */
  private async pay(id: string, adminId: string | null, meta: RequestMeta): Promise<Withdrawal> {
    return this.prisma.$transaction(async (tx) => {
      const w = adminId
        ? await this.lockForReview(id, tx)
        : await this.lock(id, WithdrawalStatus.PROCESSING, tx);
      await this.wallet.transfer({
        userId: w.userId,
        amount: w.amount,
        from: LedgerAccountType.USER_HELD,
        to: LedgerAccountType.PAYOUT,
        type: LedgerTransactionType.WITHDRAWAL_PAYOUT,
        idempotencyKey: `withdrawal:${id}:payout`,
        reference: { type: 'withdrawal', id },
        createdById: adminId ?? undefined,
        tx,
      });
      const paid = await tx.withdrawal.update({
        where: { id },
        data: {
          status: WithdrawalStatus.PAID,
          payoutReference: `SIM-${randomUUID()}`,
          reviewedById: adminId,
        },
      });
      await this.audit.record(
        {
          actorId: adminId ?? w.userId,
          action: adminId ? 'withdrawal.approved' : 'withdrawal.paid',
          targetType: 'withdrawal',
          targetId: id,
          metadata: { amount: w.amount, payoutReference: paid.payoutReference },
          ...meta,
        },
        tx,
      );
      return paid;
    });
  }

  /** FR-029: revisión manual sobre el umbral o tras un depósito reciente sin apuestas. */
  private async reviewReason(userId: string, amount: number): Promise<string | null> {
    if (amount > this.reviewThreshold)
      return `Supera el umbral de revisión de ${fromCents(this.reviewThreshold)} USD`;
    const lastDeposit = await this.prisma.deposit.findFirst({
      where: {
        userId,
        status: DepositStatus.CREDITED,
        updatedAt: { gte: new Date(Date.now() - RECENT_DEPOSIT_MS) },
      },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    if (!lastDeposit) return null;
    const betSince = await this.prisma.ledgerPosting.count({
      where: {
        account: { userId, type: LedgerAccountType.USER_REAL },
        transaction: {
          type: LedgerTransactionType.BET_DEBIT,
          createdAt: { gte: lastDeposit.updatedAt },
        },
      },
    });
    return betSince === 0 ? 'Retiro tras un depósito reciente sin apuestas' : null;
  }

  private lockForReview(id: string, tx: Tx) {
    return this.lock(id, WithdrawalStatus.PENDING_APPROVAL, tx);
  }

  private async lock(id: string, expected: WithdrawalStatus, tx: Tx): Promise<Withdrawal> {
    const [row] = await tx.$queryRaw<{ status: WithdrawalStatus }[]>`
      SELECT status FROM "Withdrawal" WHERE id = ${id}::uuid FOR UPDATE`;
    if (!row) throw notFound('No encontramos ese retiro.');
    if (row.status !== expected)
      throw new DomainError(
        ErrorCode.CONFLICT,
        'Este retiro ya fue procesado. Recarga la lista.',
        HttpStatus.CONFLICT,
      );
    return tx.withdrawal.findUniqueOrThrow({ where: { id } });
  }
}
