import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

/** Trabajo de la cola fraud-checks: qué revisar tras una acción del usuario. */
export type FraudCheck =
  | { kind: 'bet'; id: string }
  | { kind: 'redemption'; id: string }
  | { kind: 'debt'; betId: string };

/**
 * Encola una revisión de fraude. Apuestas, cupones y liquidación la usan con la cola inyectada
 * (sin depender del módulo de fraude). Nunca hace fallar la acción del usuario que la originó.
 */
export async function queueFraudCheck(
  queue: Queue<FraudCheck>,
  check: FraudCheck,
  logger: Logger,
): Promise<void> {
  try {
    await queue.add(check.kind, check);
  } catch (error) {
    logger.error(`No se pudo encolar la revisión de fraude ${check.kind}: ${String(error)}`);
  }
}
