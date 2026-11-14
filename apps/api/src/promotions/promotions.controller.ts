import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsEnum, IsOptional } from 'class-validator';
import { fromCents } from '@apuestas/shared';
import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators';
import { DeviceId } from '../common/device-id.middleware';
import { Meta, type RequestMeta } from '../common/request-meta';
import { CouponStatus, CouponType, RedemptionStatus, Role } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { BonusService } from './bonus.service';
import { CreateCouponDto, RedeemCouponDto } from './coupons.dto';
import { CouponsService } from './coupons.service';

export class CouponsQuery {
  @IsOptional()
  @IsEnum(CouponStatus)
  status?: CouponStatus;
}

/** contracts/http-api.md § Cupones y bonos: gestión del operador (FR-026). Sin edición. */
@Roles(Role.OPERATOR, Role.ADMIN)
@Controller('operator/coupons')
export class OperatorCouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCouponDto, @Meta() meta: RequestMeta) {
    return this.coupons.create(dto, user.id, meta);
  }

  @Get()
  list(@Query() query: CouponsQuery) {
    return this.coupons.list(query.status);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.coupons.setStatus(id, CouponStatus.PAUSED, user.id, meta);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.coupons.setStatus(id, CouponStatus.ACTIVE, user.id, meta);
  }
}

/** contracts/http-api.md § Cupones y bonos: canje y estado de promociones del apostador. */
@Roles(Role.BETTOR)
@Controller()
export class PromotionsController {
  constructor(
    private readonly coupons: CouponsService,
    private readonly bonuses: BonusService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('coupons/redeem')
  redeem(
    @CurrentUser() user: AuthUser,
    @Body() dto: RedeemCouponDto,
    @DeviceId() deviceId: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.coupons.redeem(user.id, dto.code, deviceId, meta);
  }

  @Get('promotions')
  async promotions(@CurrentUser() user: AuthUser) {
    const now = new Date();
    const [bonus, freeBets, boosts, redemptions] = await Promise.all([
      this.bonuses.current(user.id),
      this.prisma.freeBet.findMany({
        where: { userId: user.id, usedAt: null, expiresAt: { gt: now } },
        orderBy: { expiresAt: 'asc' },
      }),
      this.prisma.couponRedemption.findMany({
        where: {
          userId: user.id,
          status: RedemptionStatus.AVAILABLE,
          coupon: { type: CouponType.ODDS_BOOST, endsAt: { gt: now } },
        },
        include: { coupon: true },
      }),
      this.prisma.couponRedemption.findMany({
        where: { userId: user.id },
        include: { coupon: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return {
      bonus,
      freeBets: freeBets.map((f) => ({
        id: f.id,
        amount: fromCents(f.amount),
        expiresAt: f.expiresAt.toISOString(),
      })),
      boosts: boosts.map((r) => ({
        redemptionId: r.id,
        code: r.coupon.code,
        percent: r.coupon.value,
        maxBoost: r.coupon.cap ? fromCents(r.coupon.cap) : null,
        expiresAt: r.coupon.endsAt.toISOString(),
      })),
      redemptions: redemptions.map((r) => ({
        id: r.id,
        code: r.coupon.code,
        type: r.coupon.type,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
