import { createHash } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ErrorCode, fromCents, toCents } from '@apuestas/shared';
import { AuditService } from '../audit/audit.service';
import { DomainError, notFound, validationError } from '../common/errors/domain-error';
import type { RequestMeta } from '../common/request-meta';
import { Prisma } from '../generated/prisma/client';
import {
  AlertStatus,
  BonusStatus,
  CouponStatus,
  CouponType,
  DepositStatus,
  FraudSeverity,
  RedemptionStatus,
} from '../generated/prisma/enums';
import { type FraudCheck, queueFraudCheck } from '../fraud/fraud-checks';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES } from '../queues/queue-names';
import {
  type AlreadyUsedBy,
  bonusActive,
  couponAlreadyUsed,
  couponBlocked,
  couponInvalid,
} from './coupon-errors';
import { type CouponView, type CreateCouponDto, toCouponView } from './coupons.dto';

export interface RedemptionView {
  redemptionId: string;
  code: string;
  type: CouponType;
  status: RedemptionStatus;
  freeBet?: { id: string; amount: string; expiresAt: string };
}

/**
 * Cupones (FR-026 a FR-031, research R10). El canje bloquea la fila del cupón (cupo exacto con
 * canjes simultáneos) y la base impide repetirlo por usuario, dispositivo o titular de pago.
 */
@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.FRAUD_CHECKS) private readonly fraudChecks: Queue<FraudCheck>,
  ) {}

  // ── Operador ────────────────────────────────────────────────────────────────

  async create(dto: CreateCouponDto, actorId: string, meta: RequestMeta): Promise<CouponView> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) throw validationError('La fecha de fin debe ser posterior al inicio.');
    const { value, cap } = this.valueOf(dto);

    try {
      const coupon = await this.prisma.$transaction(async (tx) => {
        const created = await tx.coupon.create({
          data: {
            code: dto.code.toUpperCase(),
            type: dto.type,
            value,
            cap,
            startsAt,
            endsAt,
            totalLimit: dto.totalLimit,
            createdById: actorId,
          },
        });
        await this.audit.record(
          {
            actorId,
            action: 'coupon.created',
            targetType: 'coupon',
            targetId: created.id,
            metadata: {
              code: created.code,
              type: created.type,
              value,
              cap,
              totalLimit: dto.totalLimit,
            },
            ...meta,
          },
          tx,
        );
        return created;
      });
      return toCouponView(coupon);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new DomainError(
          ErrorCode.CONFLICT,
          'Ya existe un cupón con ese código.',
          HttpStatus.CONFLICT,
        );
      throw error;
    }
  }

  async list(status?: CouponStatus): Promise<CouponView[]> {
    const coupons = await this.prisma.coupon.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    });
    return coupons.map(toCouponView);
  }

  /** Pausar o reanudar. Un cupón con canjes no se edita: solo se pausa (FR-026). */
  async setStatus(
    id: string,
    status: CouponStatus,
    actorId: string,
    meta: RequestMeta,
  ): Promise<CouponView> {
    const coupon = await this.prisma.$transaction(async (tx) => {
      const found = await tx.coupon.findUnique({ where: { id } });
      if (!found) throw notFound('No encontramos ese cupón.');
      const updated = await tx.coupon.update({ where: { id }, data: { status } });
      await this.audit.record(
        {
          actorId,
          action: status === CouponStatus.PAUSED ? 'coupon.paused' : 'coupon.resumed',
          targetType: 'coupon',
          targetId: id,
          metadata: { code: found.code, previous: found.status, status },
          ...meta,
        },
        tx,
      );
      return updated;
    });
    return toCouponView(coupon);
  }

  /** Traduce los campos del DTO al valor y tope que guarda la base, según el tipo. */
  private valueOf(dto: CreateCouponDto): { value: number; cap: number | null } {
    switch (dto.type) {
      case CouponType.DEPOSIT_BONUS:
        if (!dto.percent || !dto.maxBonus || dto.amount || dto.maxBoost)
          throw validationError('Un bono de depósito necesita percent y maxBonus.');
        return { value: dto.percent, cap: toCents(dto.maxBonus) };
      case CouponType.FREE_BET:
        if (!dto.amount || dto.percent || dto.maxBonus || dto.maxBoost)
          throw validationError('Una apuesta gratis necesita amount.');
        return { value: toCents(dto.amount), cap: null };
      case CouponType.ODDS_BOOST:
        if (!dto.percent || dto.amount || dto.maxBonus)
          throw validationError('Un aumento de cuota necesita percent (y opcionalmente maxBoost).');
        return { value: dto.percent, cap: dto.maxBoost ? toCents(dto.maxBoost) : null };
    }
  }

  // ── Apostador ───────────────────────────────────────────────────────────────

  async redeem(
    userId: string,
    rawCode: string,
    deviceId: string,
    meta: RequestMeta,
  ): Promise<RedemptionView> {
    const code = rawCode.trim().toUpperCase();
    const payerKey = await this.payerKeyOf(userId);
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          // Bloquea el cupón: los canjes simultáneos se serializan y el cupo nunca se supera.
          const locked = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM "Coupon" WHERE code = ${code} FOR UPDATE`;
          if (locked.length === 0) throw couponInvalid('NOT_FOUND');
          const coupon = await tx.coupon.findUniqueOrThrow({ where: { id: locked[0]!.id } });

          const now = new Date();
          if (coupon.status === CouponStatus.PAUSED) throw couponInvalid('PAUSED');
          if (now < coupon.startsAt) throw couponInvalid('NOT_STARTED');
          if (now > coupon.endsAt) throw couponInvalid('EXPIRED');
          if (coupon.redeemed >= coupon.totalLimit) throw couponInvalid('EXHAUSTED');
          if (await this.hasOpenHighAlert(userId, tx)) throw couponBlocked();

          const previous = await tx.couponRedemption.findFirst({
            where: {
              couponId: coupon.id,
              OR: [{ userId }, { deviceId }, ...(payerKey ? [{ payerKey }] : [])],
            },
          });
          if (previous) {
            const by: AlreadyUsedBy =
              previous.userId === userId
                ? 'USER'
                : previous.deviceId === deviceId
                  ? 'DEVICE'
                  : 'PAYER';
            throw couponAlreadyUsed(by);
          }

          if (coupon.type === CouponType.DEPOSIT_BONUS) {
            const busy = await tx.bonus.count({ where: { userId, status: BonusStatus.ACTIVE } });
            const waiting = await tx.couponRedemption.count({
              where: { userId, status: RedemptionStatus.AWAITING_DEPOSIT },
            });
            if (busy + waiting > 0) throw bonusActive();
          }

          const redemption = await tx.couponRedemption.create({
            data: {
              couponId: coupon.id,
              userId,
              deviceId,
              payerKey,
              status:
                coupon.type === CouponType.DEPOSIT_BONUS
                  ? RedemptionStatus.AWAITING_DEPOSIT
                  : RedemptionStatus.AVAILABLE,
            },
          });
          const freeBet =
            coupon.type === CouponType.FREE_BET
              ? await tx.freeBet.create({
                  data: {
                    userId,
                    redemptionId: redemption.id,
                    amount: coupon.value,
                    expiresAt: coupon.endsAt,
                  },
                })
              : null;
          await tx.coupon.update({
            where: { id: coupon.id },
            data: { redeemed: { increment: 1 } },
          });
          await this.audit.record(
            {
              actorId: userId,
              action: 'coupon.redeemed',
              targetType: 'coupon',
              targetId: coupon.id,
              metadata: { code, redemptionId: redemption.id, deviceId, payerKey },
              ...meta,
            },
            tx,
          );

          return {
            redemptionId: redemption.id,
            code,
            type: coupon.type,
            status: redemption.status,
            ...(freeBet && {
              freeBet: {
                id: freeBet.id,
                amount: fromCents(freeBet.amount),
                expiresAt: freeBet.expiresAt.toISOString(),
              },
            }),
          };
        },
        { maxWait: 15_000, timeout: 15_000 },
      );
      // FR-034: cuentas múltiples por dispositivo o titular de pago.
      await queueFraudCheck(
        this.fraudChecks,
        { kind: 'redemption', id: result.redemptionId },
        this.logger,
      );
      return result;
    } catch (error) {
      const rejected =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
          ? couponAlreadyUsed('USER')
          : error;
      if (
        rejected instanceof DomainError &&
        (rejected.code === ErrorCode.COUPON_ALREADY_USED ||
          rejected.code === ErrorCode.COUPON_BLOCKED)
      )
        await this.audit.record({
          actorId: userId,
          action: 'coupon.redeem.rejected',
          targetType: 'coupon',
          metadata: {
            code,
            reason: (rejected.details?.reason as string) ?? rejected.code,
            deviceId,
          },
          ...meta,
        });
      throw rejected;
    }
  }

  /** Huella del titular de pago del último depósito acreditado (spec 2); null sin depósitos. */
  async payerKeyOf(userId: string): Promise<string | null> {
    const deposit = await this.prisma.deposit.findFirst({
      where: {
        userId,
        status: DepositStatus.CREDITED,
        payerDocument: { not: null },
        payerPhone: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
      select: { payerDocument: true, payerPhone: true },
    });
    if (!deposit) return null;
    return createHash('sha256')
      .update(`${deposit.payerDocument}|${deposit.payerPhone}`)
      .digest('hex');
  }

  /** FR-037: con una alerta de fraude alta abierta no se canjean cupones. */
  private async hasOpenHighAlert(userId: string, tx: Prisma.TransactionClient): Promise<boolean> {
    const count = await tx.fraudAlert.count({
      where: { status: AlertStatus.OPEN, severity: FraudSeverity.HIGH, userIds: { has: userId } },
    });
    return count > 0;
  }
}
