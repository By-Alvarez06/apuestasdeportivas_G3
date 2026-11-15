import type { AlertDraft } from './types';

/**
 * RESETTLEMENT_DEBT: la corrección de un resultado dejó al usuario debiendo dinero (research R7).
 * Alta: alguien cobró un premio que no le correspondía y lo gastó o retiró.
 */
export function resettlementDebt(input: {
  userId: string;
  debtId: string;
  betId: string;
  amount: number;
}): AlertDraft {
  return {
    rule: 'RESETTLEMENT_DEBT',
    severity: 'HIGH',
    subjectKey: `debt:${input.debtId}`,
    userIds: [input.userId],
    evidence: { amount: input.amount, betId: input.betId },
  };
}
