import { InjectQueue } from '@nestjs/bullmq';
import {
  Body,
  type CanActivate,
  Controller,
  HttpCode,
  Injectable,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';
import { parseOdds } from '@apuestas/shared';
import { Roles } from '../../common/auth/decorators';
import { notFound, validationError } from '../../common/errors/domain-error';
import { Role } from '../../generated/prisma/enums';
import { QUEUES } from '../../queues/queue-names';
import { jobIdFor } from '../../queues/redis-connection';
import type {
  MarketStatus,
  MatchEventJob,
  MatchStatus,
  SelectionResult,
} from '../match-catalog.port';
import { SimulatedCatalog } from './simulated-catalog';

const MATCH_STATUSES: MatchStatus[] = [
  'SCHEDULED',
  'LIVE',
  'FINISHED',
  'SUSPENDED',
  'POSTPONED',
  'CANCELLED',
];
const MARKET_STATUSES: MarketStatus[] = ['OPEN', 'SUSPENDED', 'CLOSED', 'RESULTED', 'VOID'];
const RESULTS: SelectionResult[] = ['WON', 'LOST', 'VOID'];
const EVENT_TYPES = ['MARKET_RESULTED', 'RESULT_CORRECTED', 'MATCH_STATUS_CHANGED'] as const;

/** Los controles del simulador no existen en producción: responden 404. */
@Injectable()
export class DevOnlyGuard implements CanActivate {
  canActivate(): boolean {
    if (process.env.NODE_ENV === 'production') throw notFound();
    return true;
  }
}

export class SetOddsDto {
  @IsString()
  @Length(1, 100)
  selectionId!: string;

  /** "2.10" */
  @IsString()
  odds!: string;
}

export class SetMarketStatusDto {
  @IsIn(MARKET_STATUSES)
  status!: MarketStatus;
}

export class PublishEventDto {
  @IsIn(EVENT_TYPES)
  type!: (typeof EVENT_TYPES)[number];

  @IsString()
  @Length(1, 200)
  sourceEventId!: string;

  @IsString()
  @Length(1, 100)
  matchId!: string;

  @ValidateIf((e: PublishEventDto) => e.type !== 'MATCH_STATUS_CHANGED')
  @IsString()
  @Length(1, 100)
  marketId?: string;

  @ValidateIf((e: PublishEventDto) => e.type !== 'MATCH_STATUS_CHANGED')
  @IsObject()
  results?: Record<string, SelectionResult>;

  @ValidateIf((e: PublishEventDto) => e.type === 'MATCH_STATUS_CHANGED')
  @IsIn(MATCH_STATUSES)
  status?: MatchStatus;

  @ValidateIf((e: PublishEventDto) => e.type === 'MATCH_STATUS_CHANGED')
  @IsISO8601()
  scheduledStart?: string;

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}

/**
 * Controles del catálogo simulado para desarrollo y pruebas (contracts/match-catalog.md § 3).
 * Hacen lo que hará la spec 3: cambiar cuotas y estados y publicar eventos en `match-events`.
 */
@Roles(Role.OPERATOR, Role.ADMIN)
@UseGuards(DevOnlyGuard)
@Controller('dev/catalog')
export class DevCatalogController {
  constructor(
    private readonly catalog: SimulatedCatalog,
    @InjectQueue(QUEUES.MATCH_EVENTS) private readonly events: Queue<MatchEventJob>,
  ) {}

  @Post('odds')
  @HttpCode(204)
  setOdds(@Body() dto: SetOddsDto): void {
    let odds: number;
    try {
      odds = parseOdds(dto.odds);
    } catch {
      throw validationError('La cuota debe tener formato "2.10" y ser al menos 1.01.');
    }
    this.run(() => this.catalog.setOdds(dto.selectionId, odds));
  }

  @Post('markets/:marketId/status')
  @HttpCode(204)
  setMarketStatus(@Param('marketId') marketId: string, @Body() dto: SetMarketStatusDto): void {
    this.run(() => this.catalog.setMarketStatus(marketId, dto.status));
  }

  /** Publica un evento como lo haría la spec 3 y lo refleja en el catálogo simulado. */
  @Post('events')
  @HttpCode(202)
  async publish(@Body() dto: PublishEventDto): Promise<{ jobId: string }> {
    const event = this.toEvent(dto);
    const jobId = jobIdFor(event.sourceEventId);
    await this.events.add(event.type, event, { jobId });
    this.catalog.applyEvent(event);
    return { jobId };
  }

  @Post('reset')
  @HttpCode(204)
  reset(): void {
    this.catalog.reset();
  }

  private toEvent(dto: PublishEventDto): MatchEventJob {
    const occurredAt = dto.occurredAt ?? new Date().toISOString();
    const base = { sourceEventId: dto.sourceEventId, matchId: dto.matchId, occurredAt };
    if (dto.type === 'MATCH_STATUS_CHANGED')
      return {
        ...base,
        type: dto.type,
        status: dto.status as MatchStatus,
        scheduledStart: dto.scheduledStart as string,
      };
    const results = dto.results ?? {};
    if (
      Object.keys(results).length === 0 ||
      Object.values(results).some((r) => !RESULTS.includes(r))
    )
      throw validationError('results debe asignar WON, LOST o VOID a cada selección del mercado.');
    return { ...base, type: dto.type, marketId: dto.marketId as string, results };
  }

  /** Traduce "desconocido" del simulador a 404. */
  private run(action: () => void): void {
    try {
      action();
    } catch (error) {
      if (error instanceof Error && /desconocid/.test(error.message)) throw notFound(error.message);
      throw error;
    }
  }
}
