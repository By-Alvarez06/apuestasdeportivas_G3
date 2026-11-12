import { createHash } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { ErrorCode, fromCents, PORTS, toCents } from '@apuestas/shared';
import { AuditService } from '../audit/audit.service';
import { DomainError, forbidden, notFound, validationError } from '../common/errors/domain-error';
import type { RequestMeta } from '../common/request-meta';
import { type Deposit, Prisma } from '../generated/prisma/client';
import {
  DepositStatus,
  LedgerAccountType,
  LedgerTransactionType,
  UserStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyConflictError } from '../wallet/wallet.port';
import { WalletService } from '../wallet/wallet.service';
import {
  PayphoneClient,
  type PayphoneConfirmation,
  PayphoneUnavailableError,
} from './payphone.client';

export const MIN_DEPOSIT_CENTS = 100;
export const MAX_DEPOSIT_CENTS = 100_000;
const EXPIRE_AFTER_MS = 24 * 60 * 60 * 1000;
// Payphone revierte el cobro si no se confirma en 5 minutos: la reconciliación corre cada minuto.
const RECONCILE_EVERY_MS = 60 * 1000;

const SYSTEM = { ip: 'system', userAgent: 'reconciliation' };

export interface DepositView {
  id: string;
  amount: string;
  status: DepositStatus;
  createdAt: string;
}

const view = (d: Deposit): DepositView => ({
  id: d.id,
  amount: fromCents(d.amount),
  status: d.status,
  createdAt: d.createdAt.toISOString(),
});

/**
 * Depósitos de FR-021…FR-025. El saldo solo sube cuando Payphone confirma servidor a servidor y monto,
 * moneda y referencia coinciden con la intención registrada.
 */
@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);
  private readonly webUrl: string;
  private readonly responseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly payphone: PayphoneClient,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.webUrl = config.get<string>('WEB_URL', `http://localhost:${PORTS.WEB}`);
    this.responseUrl = config.get<string>(
      'PAYPHONE_RESPONSE_URL',
      `${this.webUrl}${config.get<string>('PUBLIC_API_PREFIX', '')}/payments/payphone/return`,
    );
  }

  async create(
    userId: string,
    amountText: string,
    idempotencyKey: string,
    meta: RequestMeta,
  ): Promise<DepositView & { paymentUrl: string | null }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== UserStatus.ACTIVE) throw forbidden('Confirma tu correo para depositar.');

    let amount: number;
    try {
      amount = toCents(amountText);
    } catch {
      throw validationError('Escribe un monto válido, por ejemplo 20.00.');
    }
    if (amount < MIN_DEPOSIT_CENTS || amount > MAX_DEPOSIT_CENTS)
      throw validationError(
        `Puedes depositar entre ${fromCents(MIN_DEPOSIT_CENTS)} y ${fromCents(MAX_DEPOSIT_CENTS)} USD.`,
      );

    // La referencia sale de usuario + clave: reintentar la misma petición encuentra el mismo depósito.
    const reference = `DEP-${createHash('sha256').update(`${userId}:${idempotencyKey}`).digest('hex').slice(0, 20)}`;
    const existing = await this.prisma.deposit.findUnique({ where: { reference } });
    if (existing) {
      if (existing.amount !== amount || existing.userId !== userId)
        throw new IdempotencyConflictError();
      return { ...view(existing), paymentUrl: null };
    }

    const deposit = await this.prisma.deposit.create({ data: { userId, amount, reference } });
    await this.audit.record({
      actorId: userId,
      action: 'deposit.created',
      targetType: 'deposit',
      targetId: deposit.id,
      metadata: { amount },
      ...meta,
    });

    try {
      const { paymentUrl } = await this.payphone.prepare({
        amount,
        clientTransactionId: reference,
        responseUrl: this.responseUrl,
        cancellationUrl: `${this.webUrl}/billetera/depositos/${deposit.id}`,
        reference: 'Depósito Apuestas Deportivas',
      });
      return { ...view(deposit), paymentUrl };
    } catch (error) {
      if (!(error instanceof PayphoneUnavailableError)) throw error;
      await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: DepositStatus.FAILED },
      });
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        'No pudimos conectar con Payphone. Inténtalo de nuevo en unos minutos.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  async get(id: string, userId: string): Promise<DepositView> {
    const deposit = await this.prisma.deposit.findFirst({ where: { id, userId } });
    if (!deposit) throw notFound('No encontramos ese depósito.');
    return view(deposit);
  }

  /**
   * El navegador volvió de Payphone. Esto no acredita nada por sí mismo: dispara la confirmación
   * servidor a servidor. Devuelve el depósito (o null si la referencia no existe).
   */
  async handleReturn(
    providerTxId: number,
    reference: string,
    meta: RequestMeta,
  ): Promise<Deposit | null> {
    const deposit = await this.prisma.deposit.findUnique({ where: { reference } });
    if (!deposit) return null;
    if (deposit.status !== DepositStatus.PENDING) return deposit;

    if (deposit.providerTxId && deposit.providerTxId !== String(providerTxId)) {
      await this.audit.record({
        actorId: null,
        action: 'deposit.return.mismatch',
        targetType: 'deposit',
        targetId: deposit.id,
        metadata: { providerTxId },
        ...meta,
      });
      return deposit;
    }
    if (!deposit.providerTxId) {
      try {
        await this.prisma.deposit.updateMany({
          where: { id: deposit.id, providerTxId: null },
          data: { providerTxId: String(providerTxId) },
        });
      } catch (error) {
        // Ese id de Payphone ya pertenece a otro depósito: nunca se reutiliza un pago.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          await this.markInReview(deposit, { reason: 'providerTxId repetido', providerTxId }, meta);
          return deposit;
        }
        throw error;
      }
    }
    return this.confirm(deposit.id, providerTxId, meta);
  }

  /** Cada minuto: reintenta confirmaciones pendientes y expira intenciones abandonadas (24 h). */
  @Interval(RECONCILE_EVERY_MS)
  async reconcile(): Promise<void> {
    const since = new Date(Date.now() - EXPIRE_AFTER_MS);
    const pending = await this.prisma.deposit.findMany({
      where: {
        status: DepositStatus.PENDING,
        providerTxId: { not: null },
        createdAt: { gte: since },
      },
    });
    for (const d of pending) {
      try {
        await this.confirm(d.id, Number(d.providerTxId), SYSTEM);
      } catch (error) {
        this.logger.error(`No se pudo reconciliar el depósito ${d.id}: ${String(error)}`);
      }
    }
    const { count } = await this.prisma.deposit.updateMany({
      where: { status: DepositStatus.PENDING, createdAt: { lt: since } },
      data: { status: DepositStatus.EXPIRED },
    });
    if (count > 0) this.logger.log(`${count} depósitos expirados`);
  }

  private async confirm(
    depositId: string,
    providerTxId: number,
    meta: RequestMeta,
  ): Promise<Deposit> {
    const deposit = await this.prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });
    let confirmation: PayphoneConfirmation;
    try {
      confirmation = await this.payphone.confirm(providerTxId, deposit.reference);
    } catch (error) {
      if (error instanceof PayphoneUnavailableError) return deposit; // sigue pendiente; lo reintenta reconcile
      throw error;
    }

    if (!confirmation.approved) {
      await this.prisma.deposit.updateMany({
        where: { id: deposit.id, status: DepositStatus.PENDING },
        data: { status: DepositStatus.FAILED },
      });
      await this.audit.record({
        actorId: deposit.userId,
        action: 'deposit.failed',
        targetType: 'deposit',
        targetId: deposit.id,
        ...meta,
      });
      return this.prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    }

    const matches =
      confirmation.amount === deposit.amount &&
      confirmation.currency === deposit.currency &&
      confirmation.clientTransactionId === deposit.reference;
    if (!matches) {
      await this.markInReview(
        deposit,
        {
          reason: 'confirmación no coincide con la intención',
          amount: confirmation.amount,
          currency: confirmation.currency,
          clientTransactionId: confirmation.clientTransactionId,
        },
        meta,
      );
      return this.prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    }

    return this.prisma.$transaction(async (tx) => {
      // Bloquea el depósito: dos confirmaciones simultáneas no pueden acreditar las dos.
      const [locked] = await tx.$queryRaw<{ status: DepositStatus }[]>`
        SELECT status FROM "Deposit" WHERE id = ${deposit.id}::uuid FOR UPDATE`;
      if (locked?.status !== DepositStatus.PENDING)
        return tx.deposit.findUniqueOrThrow({ where: { id: deposit.id } });

      const ledgerTransactionId = await this.wallet.transfer({
        userId: deposit.userId,
        amount: deposit.amount,
        from: LedgerAccountType.GATEWAY,
        to: LedgerAccountType.USER_REAL,
        type: LedgerTransactionType.DEPOSIT,
        idempotencyKey: `deposit:${deposit.id}`,
        reference: { type: 'deposit', id: deposit.id },
        tx,
      });
      const credited = await tx.deposit.update({
        where: { id: deposit.id },
        data: {
          status: DepositStatus.CREDITED,
          ledgerTransactionId,
          payerDocument: confirmation.payerDocument,
          payerPhone: confirmation.payerPhone,
        },
      });
      await this.audit.record(
        {
          actorId: deposit.userId,
          action: 'deposit.credited',
          targetType: 'deposit',
          targetId: deposit.id,
          metadata: { amount: deposit.amount, providerTxId },
          ...meta,
        },
        tx,
      );
      return credited;
    });
  }

  private async markInReview(
    deposit: Deposit,
    metadata: Prisma.InputJsonObject,
    meta: RequestMeta,
  ): Promise<void> {
    await this.prisma.deposit.updateMany({
      where: { id: deposit.id, status: DepositStatus.PENDING },
      data: { status: DepositStatus.IN_REVIEW },
    });
    await this.audit.record({
      actorId: deposit.userId,
      action: 'deposit.mismatch',
      targetType: 'deposit',
      targetId: deposit.id,
      metadata,
      ...meta,
    });
  }
}
