import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { MatchStatus } from '@apuestas/shared';

export class ReportFiltersDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsUUID()
  competitionId?: string;

  @IsOptional()
  @IsEnum(MatchStatus)
  status?: MatchStatus;
}

export enum ReportExportFormat {
  CSV = 'csv',
  PDF = 'pdf',
}

export class ReportExportDto extends ReportFiltersDto {
  @IsEnum(ReportExportFormat)
  format!: ReportExportFormat;
}
