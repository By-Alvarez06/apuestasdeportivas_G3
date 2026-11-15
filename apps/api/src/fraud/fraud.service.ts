import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuditService } from '../audit/audit.service';
import { BettingSettingsService } from '../betting/settings.service';
import { MATCH_CATALOG, type MatchCatalogPort } from '../catalog/match-catalog.port';
import type { Prisma } from '../generated/prisma/client';
import { AlertStatus, DepositStatus, Role, StakeSource } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { FraudCheck } from './fraud-checks';
import { anomalousStake } from './rules/anomalous-stake';
import { mirrorBets } from './rules/mirror-bets';
import { multiAccount, type SharedSignal } from './rules/multi-account';
import { oddsDropPattern } from './rules/odds-drop-pattern';
import { resettlementDebt } from './rules/resettlement-debt';
import type { AlertDraft } from './rules/types';
import { withdrawalNoActivity } from './rules/withdrawal-no-activity';

const DAY_MS = 24 * 3_600_000;
const SYSTEM_META = { actorId: null, ip: 'system', userAgent: 'worker' } as const;

const payerKey = (document: string, phone: string) =>
  createHash('sha256').update(`${document}|${phone}`).digest('hex');

/**
 * Detección de fraude (FR-034 a FR-038, research R11). Las reglas son funciones puras; este
 * servicio junta los datos, registra las alertas (una abierta por regla y sujeto) y las audita.
 * Revisa al instante tras apostar, canjear o crear una deuda (cola fraud-checks) y cada 5 minutos
 * lo que depende del tiempo (retiros, caídas de cuota, cuentas por IP o titular de pago).
 */
@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: BettingSettingsService,
    @Inject(MATCH_CATALOG) private readonly catalog: MatchCatalogPort,
  ) {}

  async run(check: FraudCheck): Promise<void> {
    switch (check.kind) {
      case 'bet':
        return this.checkBet(check.id);
      case 'redemption':
        return this.checkRedemption(check.id);
      case 'debt':
        return this.checkDebt(check.betId);
    }
  }

  // ── Revisiones inmediatas ────────────────────────────────────────────────────

  private async checkBet(betId: string): Promise<void> {
    const bet = await this.prisma.bet.findUnique({
      where: { id: betId },
      include: { selections: true },
    });
    if (!bet) return;
    const s = await this.settings.getAll();

    if (bet.source !== StakeSource.FREE_BET) {
      const history = await this.prisma.bet.findMany({
        where: {
          userId: bet.userId,
          id: { not: bet.id },
          acceptedAt: { lt: bet.acceptedAt },
          source: { not: StakeSource.FREE_BET },
        },
        orderBy: { acceptedAt: 'desc' },
        take: 20,
        select: { stake: true },
      });
      await this.raise(
        anomalousStake({
          userId: bet.userId,
          betId: bet.id,
          stake: bet.stake,
          history: history.map((h) => h.stake),
          factor: s['fraud.anomalousStakeFactor'],
          minStake: s['fraud.anomalousStakeMin'],
        }),
      );
    }

    if (bet.deviceId)
      await this.raiseAll(
        multiAccount(await this.deviceSignals([bet.deviceId]), s['fraud.multiAccountMin']),
      );

    const related = await this.relatedUsers(bet.userId);
    if (related.size > 1) {
      const windowMs = s['fraud.mirrorWindowMin'] * 60_000;
      for (const selection of bet.selections) {
        const others = await this.prisma.betSelection.findMany({
          where: {
            selectionId: selection.selectionId,
            bet: {
              userId: { in: [...related].filter((id) => id !== bet.userId) },
              acceptedAt: {
                gte: new Date(bet.acceptedAt.getTime() - windowMs),
                lte: new Date(bet.acceptedAt.getTime() + windowMs),
              },
            },
          },
          select: { selectionId: true, bet: { select: { userId: true, acceptedAt: true } } },
        });
        await this.raise(
          mirrorBets({
            bet: {
              userId: bet.userId,
              selectionId: selection.selectionId,
              placedAt: bet.acceptedAt,
            },
            others: others.map((o) => ({
              userId: o.bet.userId,
              selectionId: o.selectionId,
              placedAt: o.bet.acceptedAt,
            })),
            related,
            windowMinutes: s['fraud.mirrorWindowMin'],
          }),
        );
      }
    }
  }

  private async checkRedemption(redemptionId: string): Promise<void> {
    const redemption = await this.prisma.couponRedemption.findUnique({
      where: { id: redemptionId },
    });
    if (!redemption) return;
    const min = await this.settings.get('fraud.multiAccountMin');
    await this.raiseAll(multiAccount(await this.deviceSignals([redemption.deviceId]), min));
    await this.raiseAll(multiAccount(await this.payerSignals(), min));
  }

  private async checkDebt(betId: string): Promise<void> {
    const debts = await this.prisma.betDebt.findMany({ where: { betId } });
    for (const debt of debts)
      await this.raise(
        resettlementDebt({ userId: debt.userId, debtId: debt.id, betId, amount: debt.amount }),
      );
  }

  // ── Revisión periódica ───────────────────────────────────────────────────────

  /** Cada 5 minutos: cuentas múltiples, retiros sin actividad y caídas de cuota tras apostar. */
  @Cron('*/5 * * * *')
  async sweep(now: Date = new Date()): Promise<void> {
    try {
      const s = await this.settings.getAll();
      await this.raiseAll(multiAccount(await this.deviceSignals(), s['fraud.multiAccountMin']));
      await this.raiseAll(multiAccount(await this.payerSignals(), s['fraud.multiAccountMin']));
      await this.raiseAll(multiAccount(await this.ipSignals(now), s['fraud.multiAccountIpMin']));
      await this.sweepWithdrawals(now);
      await this.sweepOddsDrops(now, s);
    } catch (error) {
      this.logger.error(`Falló la revisión periódica de fraude: ${String(error)}`);
    }
  }

  private async sweepWithdrawals(now: Date): Promise<void> {
    const withdrawals = await this.prisma.withdrawal.findMany({
      where: { createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
    });
    for (const w of withdrawals) {
      const deposit = await this.prisma.deposit.findFirst({
        where: {
          userId: w.userId,
          status: DepositStatus.CREDITED,
          updatedAt: { lte: w.createdAt },
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (!deposit) continue;
      const betsBetween = await this.prisma.bet.count({
        where: { userId: w.userId, acceptedAt: { gte: deposit.updatedAt, lte: w.createdAt } },
      });
      await this.raise(
        withdrawalNoActivity({
          userId: w.userId,
          withdrawalId: w.id,
          depositId: deposit.id,
          betsBetween,
        }),
      );
    }
  }

  private async sweepOddsDrops(
    now: Date,
    s: Awaited<ReturnType<BettingSettingsService['getAll']>>,
  ) {
    const bets = await this.prisma.bet.findMany({
      where: { acceptedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } },
      include: { selections: true },
    });
    const windowMs = s['fraud.oddsDropWindowMin'] * 60_000;
    const byUser = new Map<string, Parameters<typeof oddsDropPattern>[0]['bets'][number][]>();
    for (const bet of bets)
      for (const sel of bet.selections) {
        const history = await this.catalog.oddsHistory(
          sel.selectionId,
          bet.acceptedAt,
          new Date(bet.acceptedAt.getTime() + windowMs),
        );
        if (history.length === 0) continue;
        const list = byUser.get(bet.userId) ?? [];
        list.push({
          betId: bet.id,
          selectionId: sel.selectionId,
          odds: sel.odds,
          placedAt: bet.acceptedAt,
          history,
        });
        byUser.set(bet.userId, list);
      }
    for (const [userId, userBets] of byUser)
      await this.raise(
        oddsDropPattern({
          userId,
          bets: userBets,
          dropPct: s['fraud.oddsDropPct'],
          windowMinutes: s['fraud.oddsDropWindowMin'],
          minBets: s['fraud.oddsDropMinBets'],
        }),
      );
  }

  // ── Señales de identidad ─────────────────────────────────────────────────────

  /** Cuentas por dispositivo (apuestas y canjes de los últimos 30 días). */
  private async deviceSignals(deviceIds?: string[]): Promise<SharedSignal[]> {
    const since = new Date(Date.now() - 30 * DAY_MS);
    const [bets, redemptions] = await Promise.all([
      this.prisma.bet.findMany({
        where: {
          acceptedAt: { gte: since },
          deviceId: deviceIds ? { in: deviceIds } : { not: null },
        },
        select: { deviceId: true, userId: true },
        distinct: ['deviceId', 'userId'],
      }),
      this.prisma.couponRedemption.findMany({
        where: { createdAt: { gte: since }, deviceId: deviceIds ? { in: deviceIds } : undefined },
        select: { deviceId: true, userId: true },
        distinct: ['deviceId', 'userId'],
      }),
    ]);
    return group(
      'device',
      [...bets, ...redemptions].map((r) => [r.deviceId!, r.userId]),
    );
  }

  /** Cuentas por titular de pago (depósitos acreditados). */
  private async payerSignals(): Promise<SharedSignal[]> {
    const deposits = await this.prisma.deposit.findMany({
      where: {
        status: DepositStatus.CREDITED,
        payerDocument: { not: null },
        payerPhone: { not: null },
      },
      select: { payerDocument: true, payerPhone: true, userId: true },
    });
    return group(
      'payer',
      deposits.map((d) => [payerKey(d.payerDocument!, d.payerPhone!), d.userId]),
    );
  }

  /** Apostadores por IP de sesión en los últimos 7 días. */
  private async ipSignals(now: Date): Promise<SharedSignal[]> {
    const sessions = await this.prisma.refreshToken.findMany({
      where: {
        createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) },
        user: { role: Role.BETTOR },
      },
      select: { ip: true, userId: true },
      distinct: ['ip', 'userId'],
    });
    return group(
      'ip',
      sessions.map((s) => [s.ip, s.userId]),
    );
  }

  /** Cuentas relacionadas por señales fuertes (dispositivo o titular), incluida la propia. */
  private async relatedUsers(userId: string): Promise<Set<string>> {
    const [bets, redemptions, deposits] = await Promise.all([
      this.prisma.bet.findMany({
        where: { userId, deviceId: { not: null } },
        select: { deviceId: true },
        distinct: ['deviceId'],
      }),
      this.prisma.couponRedemption.findMany({
        where: { userId },
        select: { deviceId: true },
        distinct: ['deviceId'],
      }),
      this.prisma.deposit.findMany({
        where: { userId, status: DepositStatus.CREDITED, payerDocument: { not: null } },
        select: { payerDocument: true, payerPhone: true },
      }),
    ]);
    const devices = [...new Set([...bets, ...redemptions].map((r) => r.deviceId!))];
    const related = new Set<string>([userId]);
    for (const s of await this.deviceSignals(devices)) s.userIds.forEach((id) => related.add(id));
    if (deposits.length > 0) {
      const keys = new Set(deposits.map((d) => payerKey(d.payerDocument!, d.payerPhone!)));
      for (const s of await this.payerSignals())
        if (keys.has(s.key)) s.userIds.forEach((id) => related.add(id));
    }
    return related;
  }

  // ── Registro de alertas ──────────────────────────────────────────────────────

  private async raiseAll(drafts: AlertDraft[]): Promise<void> {
    for (const d of drafts) await this.raise(d);
  }

  /**
   * Registra la alerta si no hay una abierta para la misma regla y sujeto. Si la hay y aparecieron
   * cuentas nuevas (p. ej. una cuarta cuenta en el mismo dispositivo), las agrega.
   */
  private async raise(draft: AlertDraft | null): Promise<void> {
    if (!draft) return;
    const open = await this.prisma.fraudAlert.findFirst({
      where: { rule: draft.rule, subjectKey: draft.subjectKey, status: AlertStatus.OPEN },
    });
    if (open) {
      const userIds = [...new Set([...open.userIds, ...draft.userIds])].sort();
      if (userIds.length > open.userIds.length)
        await this.prisma.fraudAlert.update({
          where: { id: open.id },
          data: { userIds, evidence: draft.evidence as Prisma.InputJsonObject },
        });
      return;
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        const alert = await tx.fraudAlert.create({
          data: {
            rule: draft.rule,
            severity: draft.severity,
            subjectKey: draft.subjectKey,
            userIds: draft.userIds,
            evidence: draft.evidence as Prisma.InputJsonObject,
          },
        });
        await this.audit.record(
          {
            ...SYSTEM_META,
            action: 'fraud.alert.created',
            targetType: 'fraud_alert',
            targetId: alert.id,
            metadata: { rule: draft.rule, severity: draft.severity, userIds: draft.userIds },
          },
          tx,
        );
      });
    } catch (error) {
      // Otra revisión simultánea la creó primero (índice único de alertas abiertas).
      if ((error as { code?: string }).code !== 'P2002') throw error;
    }
  }
}

function group(kind: SharedSignal['kind'], pairs: [string, string][]): SharedSignal[] {
  const byKey = new Map<string, Set<string>>();
  for (const [key, userId] of pairs) {
    const set = byKey.get(key) ?? new Set<string>();
    set.add(userId);
    byKey.set(key, set);
  }
  return [...byKey].map(([key, users]) => ({ kind, key, userIds: [...users] }));
}
