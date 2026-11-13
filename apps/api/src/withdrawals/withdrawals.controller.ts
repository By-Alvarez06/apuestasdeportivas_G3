import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators';
import { IdempotencyKey } from '../common/idempotency-key.decorator';
import { Meta, type RequestMeta } from '../common/request-meta';
import { Role, WithdrawalStatus } from '../generated/prisma/enums';
import { WithdrawalsService } from './withdrawals.service';

export class CreateWithdrawalDto {
  @IsString()
  @MaxLength(20)
  amount!: string;

  @Matches(/^\d{10,13}$/, { message: 'El documento debe tener entre 10 y 13 dígitos.' })
  destinationDocument!: string;

  @Matches(/^\d{9,15}$/, { message: 'Escribe el teléfono solo con dígitos, con código de país.' })
  destinationPhone!: string;

  @IsString()
  @IsNotEmpty({ message: 'Falta el código de verificación en dos pasos.' })
  @MaxLength(32)
  totpCode!: string;
}

export class ReviewQuery {
  @IsOptional()
  @IsEnum(WithdrawalStatus)
  status?: WithdrawalStatus;
}

export class RejectDto {
  @IsString()
  @IsNotEmpty({ message: 'Escribe el motivo del rechazo.' })
  @MaxLength(500)
  reason!: string;
}

@Controller()
export class WithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  // Límite por IP además del límite de fallos de 2FA por usuario del servicio.
  @UseGuards(ThrottlerGuard)
  @Roles(Role.BETTOR)
  @Post('withdrawals')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWithdrawalDto,
    @IdempotencyKey() key: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.withdrawals.request(user.id, dto, key, meta);
  }

  @Roles(Role.BETTOR)
  @Get('withdrawals')
  async listOwn(@CurrentUser() user: AuthUser) {
    return { items: await this.withdrawals.listOwn(user.id) };
  }

  @Roles(Role.ADMIN)
  @Get('admin/withdrawals')
  async listForReview(@Query() query: ReviewQuery) {
    return { items: await this.withdrawals.listForReview(query.status) };
  }

  @Roles(Role.ADMIN)
  @Post('admin/withdrawals/:id/approve')
  approve(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.withdrawals.approve(id, admin.id, meta);
  }

  @Roles(Role.ADMIN)
  @Post('admin/withdrawals/:id/reject')
  reject(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.withdrawals.reject(id, admin.id, dto.reason, meta);
  }
}
