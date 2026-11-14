import { type ApiErrorBody, ErrorCode } from '@apuestas/shared';

/** Error de la API con el código estable de contracts/http-api.md. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  /** Para operaciones de dinero (FR-017). */
  idempotencyKey?: string;
}

/** Rutas de /auth sin sesión: un 401 ahí es la respuesta, no una sesión vencida. */
const PUBLIC_AUTH = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/verify-email',
  '/auth/resend-verification',
  '/auth/forgot-password',
  '/auth/reset-password',
];

let refreshing: Promise<boolean> | null = null;

const doRefresh = () =>
  fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }).then((res) => res.ok);

/**
 * Renueva la sesión una sola vez aunque varias peticiones reciban 401 a la vez. Entre pestañas se
 * serializa con un Web Lock: la segunda envía el refresh nuevo que dejó la primera en la cookie, en vez
 * de reusar el viejo (que el servidor trataría como robo y cerraría todas las sesiones).
 */
function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    const run: Promise<boolean> = navigator.locks
      ? // request() resuelve la promesa del callback; el tipo de la lib DOM no lo refleja.
        (navigator.locks.request('auth-refresh', doRefresh) as unknown as Promise<boolean>)
      : doRefresh();
    refreshing = run
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  return fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'include',
  });
}

/**
 * Llama a la API por el proxy /api. Si la sesión de acceso venció, renueva y reintenta una vez.
 * Lanza ApiError con el mensaje que la API pensó para el usuario.
 */
export async function api<T = void>(path: string, options: RequestOptions = {}): Promise<T> {
  let res = await send(path, options);
  if (
    res.status === 401 &&
    !PUBLIC_AUTH.some((p) => path.startsWith(p)) &&
    (await refreshSession())
  ) {
    res = await send(path, options);
  }
  if (res.status === 204 || res.status === 202) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (data as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      error?.code ?? ErrorCode.INTERNAL_ERROR,
      error?.message ??
        'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
    );
  }
  return data as T;
}

/** Mensaje para mostrar de cualquier error capturado. */
export function messageOf(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
}

/** Clave nueva por intención del usuario: reintentar la misma acción reutiliza la misma clave. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
