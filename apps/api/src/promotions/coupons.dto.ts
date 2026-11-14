import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { fromCents, type Money } from '@apuestas/shared';
import type { Coupon } from '../generated/prisma/client';
import { CouponType } from '../generated/prisma/enums';

const MONEY = /^(0|[1-9]\d{0,7})\.\d{2}$/;

/**
 * contracts/http-api.md § Cupones. Cada tipo usa sus campos: DEPOSIT_BONUS `percent` + `maxBonus`;
 * FREE_BET `amount`; ODDS_BOOST `percent` y opcionalmente `maxBoost`. El servicio valida la mezcla.
 */
export class CreateCouponDto {
  /** 4 a 20 letras o números; se guarda en mayúsculas. */
  @Matches(/^[A-Za-z0-9]{4,20}$/, { message: 'code: de 4 a 20 letras o números, sin espacios' })
  code!: string;

  @IsEnum(CouponType)
  type!: CouponType;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  percent?: number;

  @IsOptional()
  @Matches(MONEY, { message: 'amount debe tener formato "5.00"' })
  amount?: Money;

  @IsOptional()
  @Matches(MONEY, { message: 'maxBonus debe tener formato "20.00"' })
  maxBonus?: Money;

  /** Aumento máximo de la cuota, "0.50". */
  @IsOptional()
  @Matches(MONEY, { message: 'maxBoost debe tener formato "0.50"' })
  maxBoost?: string;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  totalLimit!: number;
}

export class RedeemCouponDto {
  @IsString()
  code!: string;
}

export interface CouponView {
  id: string;
  code: string;
  type: CouponType;
  percent: number | null;
  amount: Money | null;
  maxBonus: Money | null;
  maxBoost: string | null;
  startsAt: string;
  endsAt: string;
  totalLimit: number;
  perUserLimit: number;
  redeemed: number;
  status: string;
  createdAt: string;
}

export function toCouponView(c: Coupon): CouponView {
  const percentType = c.type !== CouponType.FREE_BET;
  return {
    id: c.id,
    code: c.code,
    type: c.type,
    percent: percentType ? c.value : null,
    amount: c.type === CouponType.FREE_BET ? fromCents(c.value) : null,
    maxBonus: c.type === CouponType.DEPOSIT_BONUS && c.cap ? fromCents(c.cap) : null,
    maxBoost: c.type === CouponType.ODDS_BOOST && c.cap ? fromCents(c.cap) : null,
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
    totalLimit: c.totalLimit,
    perUserLimit: c.perUserLimit,
    redeemed: c.redeemed,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
  };
}
