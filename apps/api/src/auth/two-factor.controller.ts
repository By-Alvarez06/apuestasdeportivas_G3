import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IsString, Matches } from 'class-validator';
import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators';
import { Meta, type RequestMeta } from '../common/request-meta';
import { Role } from '../generated/prisma/enums';
import { TwoFactorService } from './two-factor.service';

export class TotpCodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Escribe los 6 dígitos que muestra tu app autenticadora.' })
  code!: string;
}

@UseGuards(ThrottlerGuard)
@Roles(Role.BETTOR, Role.OPERATOR, Role.ADMIN)
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Post('setup')
  setup(@CurrentUser() user: AuthUser) {
    return this.twoFactor.setup(user.id);
  }

  @Post('enable')
  async enable(@CurrentUser() user: AuthUser, @Body() dto: TotpCodeDto, @Meta() meta: RequestMeta) {
    return { recoveryCodes: await this.twoFactor.enable(user.id, dto.code, meta) };
  }
}
