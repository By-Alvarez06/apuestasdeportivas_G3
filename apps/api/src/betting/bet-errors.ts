import { HttpStatus } from '@nestjs/common';
import { ErrorCode, fromCents, oddsToString } from '@apuestas/shared';
import { DomainError } from '../common/errors/domain-error';

/** Errores de aceptación de apuestas (contracts/http-api.md § Códigos de error nuevos). */

export const oddsChanged = (quotes: { selectionId: string; odds: number }[]) =>
  new DomainError(
    ErrorCode.ODDS_CHANGED,
    'La cuota cambió desde que la viste. Revisa la cuota nueva y confirma de nuevo.',
    HttpStatus.CONFLICT,
    { quotes: quotes.map((q) => ({ selectionId: q.selectionId, odds: oddsToString(q.odds) })) },
  );

export const marketClosed = () =>
  new DomainError(
    ErrorCode.MARKET_CLOSED,
    'Este mercado no acepta apuestas en este momento.',
    HttpStatus.CONFLICT,
  );

export const matchStarted = () =>
  new DomainError(
    ErrorCode.MATCH_STARTED,
    'El partido ya empezó: no se aceptan apuestas previas al partido.',
    HttpStatus.CONFLICT,
  );

export const stakeOutOfLimits = (min: number, max: number) =>
  new DomainError(
    ErrorCode.STAKE_OUT_OF_LIMITS,
    `El monto debe estar entre ${fromCents(min)} y ${fromCents(max)} USD.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
    { min: fromCents(min), max: fromCents(max) },
  );

export const payoutLimit = (maxStake: number) =>
  new DomainError(
    ErrorCode.PAYOUT_LIMIT,
    `La ganancia supera el máximo permitido. A esta cuota puedes apostar hasta ${fromCents(maxStake)} USD.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
    { maxStake: fromCents(maxStake) },
  );

export const dailyLimit = (remaining: number) =>
  new DomainError(
    ErrorCode.DAILY_LIMIT,
    `Alcanzaste tu límite diario de apuestas. Hoy puedes apostar ${fromCents(remaining)} USD más.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
    { remaining: fromCents(remaining) },
  );

/** Rechazos que se auditan como `bet.rejected` (intentos que podrían ser abuso). */
export const AUDITED_REJECTIONS: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.ODDS_CHANGED,
  ErrorCode.MARKET_CLOSED,
  ErrorCode.MATCH_STARTED,
  ErrorCode.STAKE_OUT_OF_LIMITS,
  ErrorCode.PAYOUT_LIMIT,
  ErrorCode.DAILY_LIMIT,
  ErrorCode.DEBT_OUTSTANDING,
]);
