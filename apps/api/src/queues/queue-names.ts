/** Colas BullMQ de la spec 4 (research R6 y R11). */
export const QUEUES = {
  /** Resultados y cambios de estado de partidos; la spec 3 produce, la liquidación consume. */
  MATCH_EVENTS: 'match-events',
  /** Evaluación asíncrona de reglas de fraude. */
  FRAUD_CHECKS: 'fraud-checks',
} as const;

export const ALL_QUEUES: readonly string[] = Object.values(QUEUES);
