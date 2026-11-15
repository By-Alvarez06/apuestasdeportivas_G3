import { MatchStatus } from '@apuestas/shared';
import { Role } from '../generated/prisma/enums';

const transitions: Record<MatchStatus, readonly MatchStatus[]> = {
  [MatchStatus.SCHEDULED]: [
    MatchStatus.LIVE,
    MatchStatus.SUSPENDED,
    MatchStatus.POSTPONED,
    MatchStatus.CANCELLED,
  ],
  [MatchStatus.LIVE]: [
    MatchStatus.SUSPENDED,
    MatchStatus.POSTPONED,
    MatchStatus.FINISHED,
    MatchStatus.CANCELLED,
  ],
  [MatchStatus.FINISHED]: [],
  [MatchStatus.SUSPENDED]: [
    MatchStatus.LIVE,
    MatchStatus.POSTPONED,
    MatchStatus.FINISHED,
    MatchStatus.CANCELLED,
  ],
  [MatchStatus.POSTPONED]: [MatchStatus.SCHEDULED, MatchStatus.CANCELLED],
  [MatchStatus.CANCELLED]: [],
};

const terminalStatuses = new Set([MatchStatus.FINISHED, MatchStatus.CANCELLED]);

export class MatchRuleError extends Error {}

export function assertMatchTransition(
  current: MatchStatus,
  next: MatchStatus,
  role: Role,
  reason?: string,
): void {
  if (current === next) throw new MatchRuleError('El partido ya tiene ese estado.');

  if (terminalStatuses.has(current)) {
    if (role !== Role.ADMIN || !reason?.trim()) {
      throw new MatchRuleError(
        'Cambiar o corregir un estado terminal requiere administrador y un motivo.',
      );
    }
    return;
  }

  if (!transitions[current].includes(next)) {
    throw new MatchRuleError('La transición de estado del partido no está permitida.');
  }
  if (terminalStatuses.has(next) && (role !== Role.ADMIN || !reason?.trim())) {
    throw new MatchRuleError('Cambiar a un estado terminal requiere administrador y un motivo.');
  }
}

export function assertValidScore(homeScore: number, awayScore: number): void {
  if (
    !Number.isSafeInteger(homeScore) ||
    homeScore < 0 ||
    !Number.isSafeInteger(awayScore) ||
    awayScore < 0
  ) {
    throw new MatchRuleError('El marcador debe contener goles enteros no negativos.');
  }
}
