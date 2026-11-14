import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@apuestas/shared';
import { DomainError } from '../common/errors/domain-error';

/** Por qué un cupón, una apuesta gratis o un aumento no se puede usar. */
export type CouponInvalidReason =
  'NOT_FOUND' | 'PAUSED' | 'NOT_STARTED' | 'EXPIRED' | 'EXHAUSTED' | 'USED';

const MESSAGES: Record<CouponInvalidReason, string> = {
  NOT_FOUND: 'No encontramos ese código. Revisa que esté bien escrito.',
  PAUSED: 'Esta promoción está pausada por ahora.',
  NOT_STARTED: 'Esta promoción todavía no empieza.',
  EXPIRED: 'Esta promoción ya terminó.',
  EXHAUSTED: 'Esta promoción ya alcanzó su cupo de canjes.',
  USED: 'Ya usaste esta promoción.',
};

export const couponInvalid = (reason: CouponInvalidReason) =>
  new DomainError(ErrorCode.COUPON_INVALID, MESSAGES[reason], HttpStatus.UNPROCESSABLE_ENTITY, {
    reason,
  });

/** Con qué se detectó el canje repetido (se audita; al usuario no se le da el detalle). */
export type AlreadyUsedBy = 'USER' | 'DEVICE' | 'PAYER';

export const couponAlreadyUsed = (by: AlreadyUsedBy) =>
  new DomainError(
    ErrorCode.COUPON_ALREADY_USED,
    'Esta promoción ya se canjeó desde tu cuenta, este dispositivo o tu método de pago.',
    HttpStatus.CONFLICT,
    { reason: by },
  );

export const couponBlocked = () =>
  new DomainError(
    ErrorCode.COUPON_BLOCKED,
    'No puedes canjear promociones mientras revisamos actividad inusual en tu cuenta.',
    HttpStatus.LOCKED,
  );

export const bonusActive = () =>
  new DomainError(
    ErrorCode.BONUS_ACTIVE,
    'Ya tienes un bono activo o pendiente. Termina su rollover antes de canjear otro.',
    HttpStatus.CONFLICT,
  );
