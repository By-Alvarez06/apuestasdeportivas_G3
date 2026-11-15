/** Alerta propuesta por una regla pura (research R11). FraudService la registra y deduplica. */
export interface AlertDraft {
  rule:
    | 'MULTI_ACCOUNT'
    | 'ANOMALOUS_STAKE'
    | 'ODDS_DROP_PATTERN'
    | 'MIRROR_BETS'
    | 'WITHDRAWAL_NO_ACTIVITY'
    | 'RESETTLEMENT_DEBT';
  severity: 'MEDIUM' | 'HIGH';
  /** Qué se está señalando; una sola alerta abierta por (rule, subjectKey). */
  subjectKey: string;
  userIds: string[];
  /** Datos que el administrador necesita para decidir. Sin secretos. */
  evidence: Record<string, unknown>;
}
