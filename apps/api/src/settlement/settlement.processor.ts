import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import type { MatchEventJob } from '../catalog/match-catalog.port';
import { Prisma, type MatchEvent } from '../generated/prisma/client';
import { MatchEventType } from '../generated/prisma/enums';
import { type FraudCheck, queueFraudCheck } from '../fraud/fraud-checks';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES } from '../queues/queue-names';
import { NotifierService } from '../realtime/notifier.service';
import { HoldsService } from './holds.service';
import { type SettledBet, SettlementService } from './settlement.service';

/**
 * Worker de la cola `match-events` (research R6). Registra cada evento una sola vez en MatchEvent,
 * lo aplica y lo marca como procesado; si falla, BullMQ lo reintenta con espera exponencial y el
 * reproceso es idempotente. Concurrencia 1: los eventos de un partido se aplican en orden.
 */
@Processor(QUEUES.MATCH_EVENTS, { concurrency: 1 })
export class SettlementProcessor extends WorkerHost {
  private readonly logger = new Logger(SettlementProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: SettlementService,
    private readonly holds: HoldsService,
    private readonly notifier: NotifierService,
    @InjectQueue(QUEUES.FRAUD_CHECKS) private readonly fraudChecks: Queue<FraudCheck>,
  ) {
    super();
  }

  async process(job: Job<MatchEventJob>): Promise<void> {
    const event = await this.record(job.data);
    if (event.processedAt) return;

    let changed: SettledBet[] = [];
    switch (event.type) {
      case MatchEventType.MARKET_RESULTED:
        changed = await this.settlement.applyMarketResult(event);
        break;
      case MatchEventType.RESULT_CORRECTED:
        changed = await this.settlement.applyCorrection(event);
        break;
      case MatchEventType.MATCH_STATUS_CHANGED:
        changed = await this.holds.handleStatusChange(event);
        break;
    }

    await this.prisma.matchEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date() },
    });
    await this.notifier.betsChanged(changed);
    // FR-034: una re-liquidación que dejó deuda genera una alerta.
    for (const c of changed)
      if (c.debt && c.debt > 0)
        await queueFraudCheck(this.fraudChecks, { kind: 'debt', betId: c.bet.id }, this.logger);

    const latencyMs = Date.now() - Date.parse(job.data.occurredAt);
    if (changed.length > 0 && Number.isFinite(latencyMs))
      this.logger.log(
        `settlement.latency_ms=${latencyMs} event=${event.sourceEventId} bets=${changed.length}`,
      );
  }

  /** Inserta el evento o devuelve el ya registrado con el mismo sourceEventId. */
  private async record(job: MatchEventJob): Promise<MatchEvent> {
    try {
      return await this.prisma.matchEvent.create({
        data: {
          sourceEventId: job.sourceEventId,
          type: job.type,
          matchId: job.matchId,
          marketId: 'marketId' in job ? job.marketId : null,
          payload: job as unknown as Prisma.InputJsonObject,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        return this.prisma.matchEvent.findUniqueOrThrow({
          where: { sourceEventId: job.sourceEventId },
        });
      throw error;
    }
  }
}
