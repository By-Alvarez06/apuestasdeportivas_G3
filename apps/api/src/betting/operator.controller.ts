import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { IsDefined } from 'class-validator';
import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators';
import { Meta, type RequestMeta } from '../common/request-meta';
import { Role } from '../generated/prisma/enums';
import { BettingSettingsService, SETTING_RULES, type SettingKey } from './settings.service';

export class UpdateSettingDto {
  /** Entero; el servicio valida el rango de cada clave. */
  @IsDefined()
  value!: unknown;
}

/** contracts/http-api.md § Operación: ajustes de límites, retardos y plazos (FR-039). */
@Roles(Role.OPERATOR, Role.ADMIN)
@Controller('operator')
export class OperatorBettingController {
  constructor(private readonly settings: BettingSettingsService) {}

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
}
