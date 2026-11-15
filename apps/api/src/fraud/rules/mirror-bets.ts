import type { AlertDraft } from './types';

interface BetRef {
  userId: string;
  selectionId: string;
  placedAt: Date;
}

/**
 * MIRROR_BETS: cuentas relacionadas (mismo dispositivo o titular de pago) apuestan la misma
 * selección con pocos minutos de diferencia: posible coordinación entre cuentas de una persona.
 */
export function mirrorBets(input: {
  bet: BetRef;
  /** Apuestas recientes de otras cuentas a la misma selección. */
  others: readonly BetRef[];
  /** Cuentas relacionadas con la del apostador (incluida la suya). */
  related: ReadonlySet<string>;
  windowMinutes: number;
}): AlertDraft | null {
  const windowMs = input.windowMinutes * 60_000;
  const mirrored = input.others.filter(
    (o) =>
      o.userId !== input.bet.userId &&
      input.related.has(o.userId) &&
      o.selectionId === input.bet.selectionId &&
      Math.abs(o.placedAt.getTime() - input.bet.placedAt.getTime()) <= windowMs,
  );
  if (mirrored.length === 0) return null;
  const userIds = [...new Set([input.bet.userId, ...mirrored.map((o) => o.userId)])].sort();
  // El sujeto es la selección y la primera cuenta en apostar: si se suman más cuentas, crece la
  // misma alerta en vez de abrir otra por cada combinación.
  const first = [input.bet, ...mirrored].reduce((a, b) => (b.placedAt < a.placedAt ? b : a));
  return {
    rule: 'MIRROR_BETS',
    severity: 'HIGH',
    subjectKey: `mirror:${input.bet.selectionId}:${first.userId}`,
    userIds,
    evidence: { selectionId: input.bet.selectionId, bets: mirrored.length + 1 },
  };
}
