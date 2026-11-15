import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { displayTotalOdds, fromCents } from '@apuestas/shared';
import { AuditService } from '../audit/audit.service';
import { BettingSettingsService } from '../betting/settings.service';
import type { Bet, BetSelection, Bonus, Prisma } from '../generated/prisma/client';
import {
  BetStatus,
  BonusStatus,
  CouponType,
  DepositStatus,
  LedgerAccountType,
  LedgerTransactionType,
  RedemptionStatus,
  StakeSource,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { NotifierService } from '../realtime/notifier.service';
import { WalletService } from '../wallet/wallet.service';

const DAY_MS = 24 * 3_600_000;
const SYSTEM_META = { actorId: null, ip: 'system', userAgent: 'worker' } as const;

export interface BonusView {
  id: string;
  amount: string;
  wagerRequired: string;
  wagerProgress: string;
  expiresAt: string;
  status: BonusStatus;
}

export const toBonusView = (b: Bonus): BonusView => ({
  id: b.id,
  amount: fromCents(b.amount),
  wagerRequired: fromCents(b.wagerRequired),
  wagerProgress: fromCents(Math.min(b.wagerProgress, b.wagerRequired)),
  expiresAt: b.expiresAt.toISOString(),
  status: b.status,
});

/**
 * Bonos y rollover (FR-027, FR-028, FR-032, FR-033, research R10). El saldo de bono solo pasa a
 * saldo real tras apostar `bonus.rolloverMultiplier` veces el bono, en apuestas pagadas con bono,
 * liquidadas y con cuota total ≥ `bonus.minOdds`. Un solo bono activo por usuario.
 */
@Injectable()
export class BonusService {
  private readonly logger = new Logger(BonusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
    private readonly settings: BettingSettingsService,
    private readonly notifier: NotifierService,
  ) {}

  /**
   * Cada minuto: concede los bonos de depósito canjeados cuyo depósito ya se acreditó. Así no se
   * toca la confirmación de depósitos de la spec 2.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async grantDepositBonuses(): Promise<void> {
    const waiting = await this.prisma.couponRedemption.findMany({
      where: {
        status: RedemptionStatus.AWAITING_DEPOSIT,
        coupon: { type: CouponType.DEPOSIT_BONUS },
      },
      include: { coupon: true },
    });
    for (const redemption of waiting) {
      try {
        const deposit = await this.prisma.deposit.findFirst({
          where: {
            userId: redemption.userId,
            status: DepositStatus.CREDITED,
            updatedAt: { gte: redemption.createdAt },
          },
          orderBy: { updatedAt: 'asc' },
        });
        if (!deposit) {
          if (new Date() > redemption.coupon.endsAt)
            await this.prisma.couponRedemption.update({
              where: { id: redemption.id },
              data: { status: RedemptionStatus.EXPIRED },
            });
          continue;
        }
        const amount = Math.min(
          Math.floor((deposit.amount * redemption.coupon.value) / 100),
          redemption.coupon.cap ?? Number.MAX_SAFE_INTEGER,
        );
        const granted = await this.grant(redemption.id, redemption.userId, amount, deposit.id);
        if (granted) await this.notify(redemption.userId, granted);
      } catch (error) {
        this.logger.error(`No se pudo conceder el bono ${redemption.id}: ${String(error)}`);
      }
    }
  }

  /** Concede un bono de depósito. Idempotente por canje. */
  private grant(
    redemptionId: string,
    userId: string,
    amount: number,
    depositId: string,
  ): Promise<Bonus | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CouponRedemption" WHERE id = ${redemptionId}::uuid FOR UPDATE`;
      const redemption = await tx.couponRedemption.findUniqueOrThrow({
        where: { id: redemptionId },
      });
      if (redemption.status !== RedemptionStatus.AWAITING_DEPOSIT) return null;
      const active = await tx.bonus.count({ where: { userId, status: BonusStatus.ACTIVE } });
      if (active > 0 || amount <= 0) return null; // se reintenta cuando se cierre el bono vigente

      const bonus = await tx.bonus.create({
        data: {
          userId,
          redemptionId,
          amount,
          wagerRequired: amount * (await this.settings.get('bonus.rolloverMultiplier')),
          expiresAt: new Date(Date.now() + (await this.settings.get('bonus.validDays')) * DAY_MS),
        },
      });
      await this.wallet.credit({
        userId,
        amount,
        balance: 'BONUS',
        type: LedgerTransactionType.BONUS_CREDIT,
        idempotencyKey: `bonus:${redemptionId}:grant`,
        reference: { type: 'bonus', id: bonus.id },
        tx,
      });
      await tx.couponRedemption.update({
        where: { id: redemptionId },
        data: { status: RedemptionStatus.GRANTED },
      });
      await this.audit.record(
        {
          ...SYSTEM_META,
          action: 'bonus.granted',
          targetType: 'bonus',
          targetId: bonus.id,
          metadata: { userId, amount, redemptionId, depositId, wagerRequired: bonus.wagerRequired },
        },
        tx,
      );
      return bonus;
    });
  }

  /**
   * La ganancia neta de una apuesta gratis va al saldo de bono y queda sujeta al rollover: suma al
   * bono activo o abre uno nuevo. Se llama dentro de la transacción de la liquidación.
   */
  async grantFromFreeBet(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    betId: string,
  ): Promise<void> {
    const multiplier = await this.settings.get('bonus.rolloverMultiplier');
    const active = await tx.bonus.findFirst({ where: { userId, status: BonusStatus.ACTIVE } });
    const bonus = active
      ? await tx.bonus.update({
          where: { id: active.id },
          data: {
            amount: { increment: amount },
            wagerRequired: { increment: amount * multiplier },
          },
        })
      : await tx.bonus.create({
          data: {
            userId,
            amount,
            wagerRequired: amount * multiplier,
            expiresAt: new Date(Date.now() + (await this.settings.get('bonus.validDays')) * DAY_MS),
          },
        });
    await this.audit.record(
      {
        ...SYSTEM_META,
        action: 'bonus.granted',
        targetType: 'bonus',
        targetId: bonus.id,
        metadata: { userId, amount, betId, source: 'FREE_BET' },
      },
      tx,
    );
  }

  /** Suma una apuesta de bono liquidada al avance del rollover si cumple la cuota mínima. */
  async recordWager(
    tx: Prisma.TransactionClient,
    bet: Bet & { selections: BetSelection[] },
  ): Promise<void> {
    if (bet.source !== StakeSource.BONUS) return;
    const minOdds = await this.settings.get('bonus.minOdds');
    if (displayTotalOdds(bet.selections.map((s) => s.odds)) < minOdds) return;
    await tx.bonus.updateMany({
      where: { userId: bet.userId, status: BonusStatus.ACTIVE },
      data: { wagerProgress: { increment: bet.stake } },
    });
  }

  /**
   * Cada minuto: convierte a saldo real los bonos con el rollover cumplido y caduca los vencidos,
   * siempre que el usuario no tenga apuestas de bono abiertas (su resultado aún mueve el bono).
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async closeBonuses(now: Date = new Date()): Promise<void> {
    const candidates = await this.prisma.bonus.findMany({ where: { status: BonusStatus.ACTIVE } });
    for (const bonus of candidates) {
      const completed = bonus.wagerProgress >= bonus.wagerRequired;
      if (!completed && bonus.expiresAt > now) continue;
      try {
        const open = await this.prisma.bet.count({
          where: { userId: bonus.userId, status: BetStatus.OPEN, source: StakeSource.BONUS },
        });
        if (open > 0) continue;
        const closed = await this.close(bonus.id, completed);
        if (closed) await this.notify(bonus.userId, closed);
      } catch (error) {
        this.logger.error(`No se pudo cerrar el bono ${bonus.id}: ${String(error)}`);
      }
    }
  }

  private close(bonusId: string, converted: boolean): Promise<Bonus | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Bonus" WHERE id = ${bonusId}::uuid FOR UPDATE`;
      const bonus = await tx.bonus.findUniqueOrThrow({ where: { id: bonusId } });
      if (bonus.status !== BonusStatus.ACTIVE) return null;
      await tx.$queryRaw`SELECT id FROM "Wallet" WHERE "userId" = ${bonus.userId}::uuid FOR UPDATE`;
      const { bonus: balance } = await this.wallet.getBalances(bonus.userId, tx);

      if (balance > 0)
        await this.wallet.transfer({
          userId: bonus.userId,
          amount: balance,
          from: LedgerAccountType.USER_BONUS,
          to: converted ? LedgerAccountType.USER_REAL : LedgerAccountType.HOUSE,
          type: converted
            ? LedgerTransactionType.BONUS_CONVERSION
            : LedgerTransactionType.BONUS_EXPIRY,
          idempotencyKey: `bonus:${bonus.id}:${converted ? 'convert' : 'expire'}`,
          reference: { type: 'bonus', id: bonus.id },
          tx,
        });
      const updated = await tx.bonus.update({
        where: { id: bonus.id },
        data: {
          status: converted ? BonusStatus.CONVERTED : BonusStatus.EXPIRED,
          closedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          ...SYSTEM_META,
          action: converted ? 'bonus.converted' : 'bonus.expired',
          targetType: 'bonus',
          targetId: bonus.id,
          metadata: { userId: bonus.userId, amount: balance, wagerProgress: bonus.wagerProgress },
        },
        tx,
      );
      return updated;
    });
  }

  /** Bono vigente (o el último) para la pantalla de promociones. */
  async current(userId: string): Promise<BonusView | null> {
    const bonus =
      (await this.prisma.bonus.findFirst({ where: { userId, status: BonusStatus.ACTIVE } })) ??
      (await this.prisma.bonus.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }));
    return bonus ? toBonusView(bonus) : null;
  }

  private async notify(userId: string, bonus: Bonus): Promise<void> {
    this.notifier.bonusChanged(userId, toBonusView(bonus));
    await this.notifier.walletChanged(userId);
  }
}
