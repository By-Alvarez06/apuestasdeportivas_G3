import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MarketStatus, MarketType, MatchStatus } from '@apuestas/shared';

export class MatchFiltersDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  competitionId?: string;

  @IsOptional()
  @IsEnum(MatchStatus)
  status?: MatchStatus;

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

export class CreateCompetitionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  logoUrl?: string;
}

export class UpdateCompetitionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  logoUrl?: string;
}

export class CreateMatchDto {
  @IsOptional()
  @IsUUID()
  competitionId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  homeTeamName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  awayTeamName!: string;

  @IsDateString()
  kickoffAt!: string;
}

export class UpdateMatchDto {
  @IsOptional()
  @IsUUID()
  competitionId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  homeTeamName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  awayTeamName?: string;

  @IsOptional()
  @IsDateString()
  kickoffAt?: string;
}

export class MatchStatusDto {
  @IsEnum(MatchStatus)
  status!: MatchStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  homeScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  awayScore?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason?: string;
}

export class MarketSelectionDto {
  @IsString()
  @Matches(/^[A-Z_]{1,32}$/)
  key!: string;

  @IsString()
  @Matches(/^\d{1,5}(?:\.\d{1,3})?$/)
  odds!: string;
}

export class CreateMarketDto {
  @IsEnum(MarketType)
  type!: MarketType;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,3}(?:\.\d{1,2})?$/)
  line?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => MarketSelectionDto)
  selections!: MarketSelectionDto[];
}

export class MarketStatusDto {
  @IsEnum(MarketStatus)
  status!: MarketStatus;
}

export class SetOddsDto {
  @IsString()
  @Matches(/^[A-Z_]{1,32}$/)
  key!: string;

  @IsString()
  @Matches(/^\d{1,5}(?:\.\d{1,3})?$/)
  odds!: string;
}
