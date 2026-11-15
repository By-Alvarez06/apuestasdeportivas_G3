import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { fromCents, type Money, type Odds, oddsToString } from '@apuestas/shared';
import type { Bet, BetSelection } from '../generated/prisma/client';
import { BetStatus, StakeSource } from '../generated/prisma/enums';
import { displayTotalOdds } from './odds';

const MONEY = /^(0|[1-9]\d{0,7})\.\d{2}$/;
const ODDS = /^[1-9]\d{0,3}\.\d{2}$/;

export class BetSelectionDto {
  @IsString()
  @Length(1, 100)
  selectionId!: string;

  /** Cuota que el apostador vio, "2.10". El servidor la compara con la vigente. */
  @Matches(ODDS, { message: 'odds debe tener formato "2.10"' })
  odds!: Odds;
}

/** contracts/http-api.md § Apuestas. El tipo (simple o combinada) se deduce de las selecciones. */
export class PlaceBetDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BetSelectionDto)
  selections!: BetSelectionDto[];

  /** Monto con 2 decimales, "10.00". */
  @Matches(MONEY, { message: 'stake debe tener formato "10.00"' })
  stake!: Money;

  @IsEnum(StakeSource)
  source!: StakeSource;

  /** Con `source: FREE_BET`: la apuesta gratis a usar (de GET /promotions). */
  @IsOptional()
  @IsUUID()
  freeBetId?: string;

  /** Aumento de cuota canjeado a aplicar (solo apuestas simples). */
  @IsOptional()
  @IsUUID()
  boostRedemptionId?: string;
}

export class BetsQuery {
  @IsOptional()
  @IsIn(['OPEN', 'SETTLED'])
  status?: 'OPEN' | 'SETTLED';

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export interface BetSelectionView {
  id: string;
  selectionId: string;
  matchLabel: string;
  marketLabel: string;
  selectionLabel: string;
  odds: Odds;
  status: string;
  startsAt: string;
  /** Partido suspendido o aplazado: la selección espera hasta `deadline` (FR-021). */
  hold: SelectionHold | null;
}

export interface SelectionHold {
  status: 'SUSPENDED' | 'POSTPONED';
  deadline: string;
}

export interface BetView {
  id: string;
  type: string;
  status: BetStatus;
  stake: Money;
  source: StakeSource;
  /** Cuota total para mostrar (truncada a 2 decimales); el pago usa el producto exacto. */
  totalOdds: Odds;
  potentialPayout: Money;
  payout: Money;
  live: boolean;
  acceptedAt: string;
  settledAt: string | null;
  selections: BetSelectionView[];
}

export type BetWithSelections = Bet & { selections: BetSelection[] };

/** `holds`: partidos en espera por matchId; solo aplica a selecciones pendientes. */
export function toBetView(
  bet: BetWithSelections,
  holds: ReadonlyMap<string, SelectionHold> = new Map(),
): BetView {
  const selections = [...bet.selections].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
  return {
    id: bet.id,
    type: bet.type,
    status: bet.status,
    stake: fromCents(bet.stake),
    source: bet.source,
    totalOdds: oddsToString(displayTotalOdds(selections.map((s) => s.odds))),
    potentialPayout: fromCents(bet.potentialPayout),
    payout: fromCents(bet.payout),
    live: bet.live,
    acceptedAt: bet.acceptedAt.toISOString(),
    settledAt: bet.settledAt?.toISOString() ?? null,
    selections: selections.map((s) => ({
      id: s.id,
      selectionId: s.selectionId,
      matchLabel: s.matchLabel,
      marketLabel: s.marketLabel,
      selectionLabel: s.selectionLabel,
      odds: oddsToString(s.odds),
      status: s.status,
      startsAt: s.startsAt.toISOString(),
      hold: s.status === 'PENDING' ? (holds.get(s.matchId) ?? null) : null,
    })),
  };
}
