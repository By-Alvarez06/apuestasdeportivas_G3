import { MIN_ODDS } from '@apuestas/shared';

/**
 * Cálculo exacto de cuotas y pagos (research R3). Las cuotas son enteros en centésimas (2.10 → 210)
 * y los montos, centavos. Todo producto se hace con BigInt; los pagos se redondean hacia abajo, de
 * modo que la casa nunca paga de más por redondeo.
 */

/** Cuota de una selección anulada dentro de una combinada (constitución V). */
export const VOID_ODDS = 100;

const HUNDRED = 100n;

function assertOdds(odds: readonly number[]): void {
  if (odds.length === 0) throw new RangeError('Se necesita al menos una cuota');
  for (const o of odds)
    if (!Number.isSafeInteger(o) || (o < MIN_ODDS && o !== VOID_ODDS))
      throw new RangeError(`Cuota inválida: ${o}`);
}

/** Producto exacto de las cuotas en centésimas^n; se guarda como texto en `Bet.totalOddsX`. */
export function totalOddsX(odds: readonly number[]): bigint {
  assertOdds(odds);
  return odds.reduce((acc, o) => acc * BigInt(o), 1n);
}

/** Cuota total para mostrar, en centésimas truncadas (1.33 × 1.33 = 1.7689 → 176). */
export function displayTotalOdds(odds: readonly number[]): number {
  return Number(totalOddsX(odds) / HUNDRED ** BigInt(odds.length - 1));
}

/** Pago bruto en centavos: floor(stake × Π cuotas). Incluye el monto apostado. */
export function potentialPayout(stake: number, odds: readonly number[]): number {
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new RangeError(`Monto inválido: ${stake}`);
  const payout = (BigInt(stake) * totalOddsX(odds)) / HUNDRED ** BigInt(odds.length);
  if (payout > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Pago fuera de rango');
  return Number(payout);
}

/**
 * Cuota aumentada por un cupón: odds + floor(odds × pct / 100), con el aumento limitado a
 * `capHundredths` si se indica.
 */
export function applyBoost(odds: number, pct: number, capHundredths?: number): number {
  assertOdds([odds]);
  if (!Number.isSafeInteger(pct) || pct <= 0 || pct > 100)
    throw new RangeError(`Porcentaje de aumento inválido: ${pct}`);
  const increase = Math.floor((odds * pct) / 100);
  return odds + (capHundredths === undefined ? increase : Math.min(increase, capHundredths));
}
