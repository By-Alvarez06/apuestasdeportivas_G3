import type { AlertDraft } from './types';

export interface BetWithOddsHistory {
  betId: string;
  selectionId: string;
  /** Cuota congelada (centésimas). */
  odds: number;
  placedAt: Date;
  /** Cambios de cuota de la selección después de apostar. */
  history: readonly { at: Date; odds: number }[];
}

/**
 * ODDS_DROP_PATTERN: varias apuestas del usuario fueron seguidas, dentro de `windowMinutes`, de una
 * caída de la cuota de al menos `dropPct` %: señal de apostar con información anticipada.
 */
export function oddsDropPattern(input: {
  userId: string;
  bets: readonly BetWithOddsHistory[];
  dropPct: number;
  windowMinutes: number;
  minBets: number;
}): AlertDraft | null {
  const windowMs = input.windowMinutes * 60_000;
  const flagged = input.bets.filter((bet) => {
    const limit = (bet.odds * (100 - input.dropPct)) / 100;
    return bet.history.some(
      (p) =>
        p.at > bet.placedAt &&
        p.at.getTime() - bet.placedAt.getTime() <= windowMs &&
        p.odds <= limit,
    );
  });
  if (flagged.length < input.minBets) return null;
  return {
    rule: 'ODDS_DROP_PATTERN',
    severity: 'MEDIUM',
    subjectKey: `user:${input.userId}`,
    userIds: [input.userId],
    evidence: { bets: flagged.length, betIds: flagged.map((b) => b.betId), dropPct: input.dropPct },
  };
}
