import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export class DailyBudgetUnavailableError extends Error {}

export class DailyBudgetExceededError extends Error {
  constructor(readonly resetsAt: Date) {
    super('Se agotó el presupuesto diario de API-Football.');
  }
}

export interface FootballBudgetStatus {
  enabled: boolean;
  reason: 'missing_key' | 'missing_budget' | 'invalid_budget' | 'exhausted' | null;
  limit: number;
  consumed: number;
  remaining: number;
  resetsAt: string;
}

function nextUtcReset(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export function configuredDailyLimit(config: ConfigService): number | null {
  const raw = config.get<string>('API_FOOTBALL_DAILY_BUDGET');
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const limit = Number(raw);
  return Number.isSafeInteger(limit) ? limit : null;
}

@Injectable()
export class FootballBudgetService {
  private readonly logger = new Logger(FootballBudgetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async status(now = new Date()): Promise<FootballBudgetStatus> {
    const key = this.config.get<string>('API_FOOTBALL_KEY')?.trim();
    const rawLimit = this.config.get<string>('API_FOOTBALL_DAILY_BUDGET');
    const limit = configuredDailyLimit(this.config);
    const day = this.utcDay(now);
    const rows = await this.prisma.$queryRaw<{ consumed: number; limit: number }[]>`
      SELECT "consumed", "limit"
      FROM "ApiRequestBudget"
      WHERE "day" = ${day}::date`;
    const saved = rows[0];
    const effectiveLimit =
      saved && limit ? Math.min(saved.limit, limit) : (saved?.limit ?? limit ?? 0);
    const consumed = saved?.consumed ?? 0;
    const remaining = Math.max(0, effectiveLimit - consumed);
    const reason = !key
      ? 'missing_key'
      : !rawLimit
        ? 'missing_budget'
        : !limit
          ? 'invalid_budget'
          : remaining === 0
            ? 'exhausted'
            : null;
    return {
      enabled: reason === null,
      reason,
      limit: effectiveLimit,
      consumed,
      remaining,
      resetsAt: nextUtcReset(now).toISOString(),
    };
  }

  async reserve(now = new Date()): Promise<void> {
    const key = this.config.get<string>('API_FOOTBALL_KEY')?.trim();
    const rawLimit = this.config.get<string>('API_FOOTBALL_DAILY_BUDGET');
    const limit = configuredDailyLimit(this.config);
    if (!key) throw new DailyBudgetUnavailableError('Falta API_FOOTBALL_KEY.');
    if (!rawLimit) throw new DailyBudgetUnavailableError('Falta API_FOOTBALL_DAILY_BUDGET.');
    if (!limit)
      throw new DailyBudgetUnavailableError(
        'API_FOOTBALL_DAILY_BUDGET debe ser un entero positivo.',
      );

    const day = this.utcDay(now);
    const reserved = await this.prisma.$queryRaw<{ consumed: number }[]>`
      INSERT INTO "ApiRequestBudget" ("day", "limit", "consumed", "updatedAt")
      VALUES (${day}::date, ${limit}, 1, NOW())
      ON CONFLICT ("day") DO UPDATE
        SET "limit" = LEAST("ApiRequestBudget"."limit", EXCLUDED."limit"),
            "consumed" = "ApiRequestBudget"."consumed" + 1,
            "updatedAt" = NOW()
        WHERE "ApiRequestBudget"."consumed" <
          LEAST("ApiRequestBudget"."limit", EXCLUDED."limit")
      RETURNING "consumed"`;
    if (!reserved[0]) {
      const resetsAt = nextUtcReset(now);
      this.logger.warn(
        `Se agotó el presupuesto diario de API-Football; se reanudará en ${resetsAt.toISOString()}.`,
      );
      throw new DailyBudgetExceededError(resetsAt);
    }
  }

  private utcDay(now: Date): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
}
