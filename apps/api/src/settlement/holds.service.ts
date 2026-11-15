import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BettingSettingsService } from '../betting/settings.service';
import type { MatchStatus } from '../catalog/match-catalog.port';
import type { MatchEvent } from '../generated/prisma/client';
import { HoldResolution, HoldStatus, MatchEventType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { NotifierService } from '../realtime/notifier.service';
import { type SettledBet, SettlementService } from './settlement.service';

/** Partidos anulados de forma definitiva: no se reabren ni se vuelven a suspender. */
const FINAL: ReadonlySet<HoldResolution> = new Set([
  HoldResolution.VOIDED,
  HoldResolution.CANCELLED,
]);

/**
 * Partidos suspendidos, aplazados y cancelados (FR-021 a FR-025, research R8). Mientras un partido
 * está en espera sus apuestas siguen abiertas; si no se reanuda antes del plazo (inicio programado +
 * `suspension.windowMs`) o se cancela, sus selecciones pendientes se anulan.
 */
@Injectable()
export class HoldsService {
  private readonly logger = new Logger(HoldsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: SettlementService,
    private readonly settings: BettingSettingsService,
    private readonly notifier: NotifierService,
  ) {}

  /** MATCH_STATUS_CHANGED. Devuelve las apuestas que cambiaron (solo al cancelar). */
  async handleStatusChange(event: MatchEvent): Promise<SettledBet[]> {
    const { status, scheduledStart } = event.payload as {
      status: MatchStatus;
      scheduledStart: string;
    };
    const { matchId } = event;
    const hold = await this.prisma.matchHold.findUnique({ where: { matchId } });
    if (hold?.resolution && FINAL.has(hold.resolution)) return [];

    switch (status) {
      case 'SUSPENDED':
      case 'POSTPONED': {
        if (hold && !hold.resolvedAt) {
          await this.prisma.matchHold.update({ where: { matchId }, data: { status } });
          return [];
        }
        const window = await this.settings.get('suspension.windowMs');
        const deadline = new Date(Date.parse(scheduledStart) + window);
        await this.prisma.matchHold.upsert({
          where: { matchId },
          create: { matchId, status, deadline },
          update: { status, deadline, resolvedAt: null, resolution: null },
        });
        return [];
      }
      case 'CANCELLED': {
        await this.prisma.matchHold.upsert({
          where: { matchId },
          create: {
            matchId,
            status: HoldStatus.POSTPONED,
            deadline: new Date(),
            resolvedAt: new Date(),
            resolution: HoldResolution.CANCELLED,
          },
          update: { resolvedAt: new Date(), resolution: HoldResolution.CANCELLED },
        });
        return this.settlement.voidMatch(matchId, event.id);
      }
      default:
        // Reanudado (o terminado) antes del plazo: las apuestas siguen vigentes.
        if (hold && !hold.resolvedAt)
          await this.prisma.matchHold.update({
            where: { matchId },
            data: { resolvedAt: new Date(), resolution: HoldResolution.RESUMED },
          });
        return [];
    }
  }

  /** Cada minuto: anula los partidos en espera cuyo plazo venció y avisa a los apostadores. */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireHolds(now: Date = new Date()): Promise<SettledBet[]> {
    const expired = await this.prisma.matchHold.findMany({
      where: { resolvedAt: null, deadline: { lte: now } },
    });
    const changed: SettledBet[] = [];
    for (const hold of expired) {
      try {
        // Un evento propio por vencimiento: liga la liquidación a su causa y evita duplicados.
        const sourceEventId = `hold-expired:${hold.matchId}:${hold.deadline.toISOString()}`;
        const event = await this.prisma.matchEvent.upsert({
          where: { sourceEventId },
          create: {
            sourceEventId,
            type: MatchEventType.MATCH_STATUS_CHANGED,
            matchId: hold.matchId,
            payload: { reason: 'HOLD_EXPIRED', deadline: hold.deadline.toISOString() },
          },
          update: {},
        });
        changed.push(...(await this.settlement.voidMatch(hold.matchId, event.id)));
        await this.prisma.matchHold.update({
          where: { matchId: hold.matchId },
          data: { resolvedAt: new Date(), resolution: HoldResolution.VOIDED },
        });
        await this.prisma.matchEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date() },
        });
      } catch (error) {
        // Se reintenta en el próximo minuto; la anulación es idempotente.
        this.logger.error(`No se pudo anular el partido ${hold.matchId}: ${String(error)}`);
      }
    }
    await this.notifier.betsChanged(changed);
    return changed;
  }
}
