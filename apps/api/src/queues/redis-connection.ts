import type { ConnectionOptions } from 'bullmq';

/**
 * Opciones de conexión de BullMQ a partir de `REDIS_URL` (redis:// o rediss:// con TLS).
 * `maxRetriesPerRequest: null` es obligatorio para los workers de BullMQ.
 */
export function redisConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  const db = parsed.pathname.replace('/', '');
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: db ? Number(db) : undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

/**
 * Id de trabajo de BullMQ para un evento de la fuente. BullMQ no admite ':' en ids propios; se
 * codifica para que dos ids distintos nunca colisionen.
 */
export function jobIdFor(sourceEventId: string): string {
  return sourceEventId.replaceAll('%', '%25').replaceAll(':', '%3A');
}
