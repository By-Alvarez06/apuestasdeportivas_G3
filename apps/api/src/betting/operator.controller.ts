import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { IsDefined, IsOptional, IsString, Length } from 'class-validator';
import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators';
import { Meta, type RequestMeta } from '../common/request-meta';
import { Role } from '../generated/prisma/enums';
import { BetsQuery } from './bets.dto';
import { BetsService } from './bets.service';
import { BettingSettingsService, SETTING_RULES, type SettingKey } from './settings.service';

export class UpdateSettingDto {
  /** Entero; el servicio valida el rango de cada clave. */
  @IsDefined()
  value!: unknown;
}

export class OperatorBetsQuery extends BetsQuery {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  matchId?: string;
}

/** contracts/http-api.md § Operación: ajustes (FR-039) y partidos en espera (FR-025). */
@Roles(Role.OPERATOR, Role.ADMIN)
@Controller('operator')
export class OperatorBettingController {
  constructor(
    private readonly settings: BettingSettingsService,
    private readonly bets: BetsService,
  ) {}

  @Get('settings')
  async list() {
    const values = await this.settings.getAll();
    return (Object.keys(SETTING_RULES) as SettingKey[]).map((key) => ({
      key,
      value: values[key],
      default: SETTING_RULES[key].default,
      min: SETTING_RULES[key].min,
      max: SETTING_RULES[key].max,
      description: SETTING_RULES[key].description,
    }));
  }

  @Put('settings/:key')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @Meta() meta: RequestMeta,
  ) {
    await this.settings.set(key, dto.value, user.id, meta);
    return { key, value: dto.value };
  }

  /** Partidos suspendidos o aplazados, con su plazo y cuántas apuestas esperan. */
  @Get('holds')
  holds() {
    return this.bets.listHolds();
  }

  /** Apuestas por partido y estado. Sin datos personales: solo el id del apostador. */
  @Get('bets')
  listBets(@Query() query: OperatorBetsQuery) {
    return this.bets.listForOperator(query);
  }
}
