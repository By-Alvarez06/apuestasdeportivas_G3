import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { fromCents } from '@apuestas/shared';
import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators';
import { DeviceId } from '../common/device-id.middleware';
import { IdempotencyKey } from '../common/idempotency-key.decorator';
import { Meta, type RequestMeta } from '../common/request-meta';
import { Role } from '../generated/prisma/enums';
import { DebtService } from '../settlement/debt.service';
import { BetsQuery, type BetView, PlaceBetDto } from './bets.dto';
import { BetsService } from './bets.service';
import { BettingSettingsService } from './settings.service';

/** contracts/http-api.md § Apuestas. No existe ninguna ruta que edite o borre apuestas (FR-010). */
@Controller()
export class BetsController {
  constructor(
    private readonly bets: BetsService,
    private readonly settings: BettingSettingsService,
    private readonly debts: DebtService,
  ) {}

  /** 201 si se creó; 200 si la misma Idempotency-Key ya había creado esta apuesta. */
  @Roles(Role.BETTOR)
  @Post('bets')
  async place(
    @CurrentUser() user: AuthUser,
    @Body() dto: PlaceBetDto,
    @IdempotencyKey() key: string,
    @Meta() meta: RequestMeta,
    @DeviceId() deviceId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BetView> {
    const { bet, created } = await this.bets.place(user.id, dto, key, { ...meta, deviceId });
    res.status(created ? 201 : 200);
    return bet;
  }

  @Roles(Role.BETTOR)
  @Get('bets')
  list(@CurrentUser() user: AuthUser, @Query() query: BetsQuery) {
    return this.bets.list(user.id, query);
  }

  @Roles(Role.BETTOR)
  @Get('bets/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<BetView> {
    return this.bets.get(user.id, id);
  }

  @Roles(Role.BETTOR, Role.OPERATOR, Role.ADMIN)
  @Get('betting/limits')
  async limits(@CurrentUser() user: AuthUser) {
    const s = await this.settings.getAll();
    const bettor = user.role === Role.BETTOR;
    const used = bettor ? await this.bets.dailyStakeUsed(user.id) : 0;
    const debt = bettor ? await this.debts.openDebt(user.id) : 0;
    return {
      minStake: fromCents(s['limits.minStake']),
      maxStake: fromCents(s['limits.maxStake']),
      maxPayout: fromCents(s['limits.maxPayout']),
      dailyStakePerUser: fromCents(s['limits.dailyStakePerUser']),
      dailyStakeUsed: fromCents(used),
      comboMaxSelections: s['combo.maxSelections'],
      /** Saldo adeudado por re-liquidaciones; mientras sea mayor que 0 no se puede apostar. */
      openDebt: fromCents(debt),
    };
  }
}
