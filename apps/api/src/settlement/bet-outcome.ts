import { potentialPayout, VOID_ODDS } from '../betting/odds';

export type SelectionState = 'PENDING' | 'WON' | 'LOST' | 'VOID';

export interface OutcomeInput {
  /** Centavos apostados. */
  stake: number;
  /** Selecciones con su cuota congelada (centésimas) y su estado actual. */
  selections: readonly { odds: number; status: SelectionState }[];
}

export interface Outcome {
  status: 'OPEN' | 'WON' | 'LOST' | 'VOID';
  /** Centavos a acreditar: premio bruto si gana, el monto si se anula, 0 si pierde o sigue abierta. */
  payout: number;
}

/**
 * Resultado de una apuesta a partir del estado de sus selecciones (FR-013, FR-014, FR-018, FR-023).
 * - Una selección perdida pierde la apuesta, aunque queden otras pendientes.
 * - Mientras haya pendientes, sigue abierta.
 * - Las selecciones anuladas cuentan con cuota 1.00; si todas se anulan, se reembolsa el monto.
 */
export function betOutcome({ stake, selections }: OutcomeInput): Outcome {
  if (selections.length === 0) throw new Error('Una apuesta necesita al menos una selección');

  if (selections.some((s) => s.status === 'LOST')) return { status: 'LOST', payout: 0 };
  if (selections.some((s) => s.status === 'PENDING')) return { status: 'OPEN', payout: 0 };
  if (selections.every((s) => s.status === 'VOID')) return { status: 'VOID', payout: stake };

  const odds = selections.map((s) => (s.status === 'VOID' ? VOID_ODDS : s.odds));
  return { status: 'WON', payout: potentialPayout(stake, odds) };
}
