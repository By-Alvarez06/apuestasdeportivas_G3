import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { PORTS } from '@apuestas/shared';
import { type AuthUser, CurrentUser, Public, Roles } from '../common/auth/decorators';
import { IdempotencyKey } from '../common/idempotency-key.decorator';
import { Meta, type RequestMeta } from '../common/request-meta';
import { Role } from '../generated/prisma/enums';
import { DepositsService } from './deposits.service';

export class CreateDepositDto {
  /** "20.00": string para no perder precisión en el camino. */
  @IsString({ message: 'El monto debe enviarse como texto, por ejemplo "20.00".' })
  @MaxLength(20)
  amount!: string;
}

@Controller()
export class DepositsController {
  private readonly webUrl: string;

  constructor(
    private readonly deposits: DepositsService,
    config: ConfigService,
  ) {
    this.webUrl = config.get<string>('WEB_URL', `http://localhost:${PORTS.WEB}`);
  }

  @Roles(Role.BETTOR)
  @Post('deposits')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDepositDto,
    @IdempotencyKey() key: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.deposits.create(user.id, dto.amount, key, meta);
  }

  @Roles(Role.BETTOR)
  @Get('deposits/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.deposits.get(id, user.id);
  }

  /**
   * Payphone redirige aquí al navegador. Los parámetros se leen a mano porque Payphone puede añadir
   * otros; la URL nunca acredita por sí sola (FR-023).
   */
  @Public()
  @Get('payments/payphone/return')
  async payphoneReturn(
    @Query('id') id: unknown,
    @Query('clientTransactionId') reference: unknown,
    @Meta() meta: RequestMeta,
    @Res() res: Response,
  ): Promise<void> {
    const valid =
      typeof id === 'string' &&
      /^\d{1,15}$/.test(id) &&
      typeof reference === 'string' &&
      /^DEP-[0-9a-f]{20}$/.test(reference);
    const deposit = valid ? await this.deposits.handleReturn(Number(id), reference, meta) : null;
    res.redirect(
      302,
      deposit ? `${this.webUrl}/billetera/depositos/${deposit.id}` : `${this.webUrl}/billetera`,
    );
  }
}
