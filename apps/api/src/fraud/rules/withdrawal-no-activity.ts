import type { AlertDraft } from './types';

/**
 * WITHDRAWAL_NO_ACTIVITY: retiro solicitado tras un depósito sin ninguna apuesta en medio (posible
 * lavado). Complementa la revisión manual de retiros de la spec 2 (FR-029).
 */
export function withdrawalNoActivity(input: {
  userId: string;
  withdrawalId: string;
  depositId: string;
  betsBetween: number;
}): AlertDraft | null {
  if (input.betsBetween > 0) return null;
  return {
    rule: 'WITHDRAWAL_NO_ACTIVITY',
    severity: 'MEDIUM',
    subjectKey: `withdrawal:${input.withdrawalId}`,
    userIds: [input.userId],
    evidence: { withdrawalId: input.withdrawalId, depositId: input.depositId },
  };
}
