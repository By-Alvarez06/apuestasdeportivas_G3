import type { AlertDraft } from './types';

/** Apuestas previas necesarias para tener un promedio con sentido. */
const MIN_HISTORY = 3;

/**
 * ANOMALOUS_STAKE: el monto supera `factor` veces el promedio de las apuestas previas del usuario
 * y además `minStake` (para no señalar montos pequeños).
 */
export function anomalousStake(input: {
  userId: string;
  betId: string;
  stake: number;
  /** Montos de las apuestas anteriores (centavos), las más recientes. */
  history: readonly number[];
  factor: number;
  minStake: number;
}): AlertDraft | null {
  const { history, stake } = input;
  if (history.length < MIN_HISTORY || stake <= input.minStake) return null;
  const average = Math.round(history.reduce((sum, s) => sum + s, 0) / history.length);
  if (stake <= average * input.factor) return null;
  return {
    rule: 'ANOMALOUS_STAKE',
    severity: 'MEDIUM',
    subjectKey: `user:${input.userId}`,
    userIds: [input.userId],
    evidence: { betId: input.betId, stake, average, factor: input.factor },
  };
}
