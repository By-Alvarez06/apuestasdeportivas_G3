# Contrato HTTP: Cuentas y billetera

Base: `apps/api`. JSON. Montos como string con 2 decimales (`"20.00"`). Autenticación por cookie
`access_token`. Errores: `{ "error": { "code": "...", "message": "..." } }`.

Roles: **P** = público, **B** = apostador, **O** = operador, **A** = administrador. Sin rol listado,
acceso denegado (403).

## Autenticación

| Método | Ruta | Rol | Cuerpo / notas | Respuesta |
|--------|------|-----|----------------|-----------|
| POST | `/auth/register` | P | `email`, `password`, `birthDate`, `captchaToken` | 202 siempre (FR-006) |
| POST | `/auth/verify-email` | P | `token` | 204; 410 si caducó o se usó |
| POST | `/auth/resend-verification` | P | `email` | 202 siempre |
| POST | `/auth/login` | P | `email`, `password`, `captchaToken` | 204 + cookies; 401 genérico; 423 bloqueada |
| POST | `/auth/refresh` | P (cookie refresh) | — | 204 + cookies nuevas; 401 y revocación total si se reusa |
| POST | `/auth/logout` | B O A | — | 204, revoca la familia |
| POST | `/auth/forgot-password` | P | `email` | 202 siempre |
| POST | `/auth/reset-password` | P | `token`, `password` | 204, revoca todas las sesiones |
| GET | `/auth/me` | B O A | — | `{ id, email, role, status, twoFactorEnabled }` |
| POST | `/auth/2fa/setup` | B O A | — | `{ otpauthUrl, qrDataUrl }` |
| POST | `/auth/2fa/enable` | B O A | `code` | `{ recoveryCodes: string[10] }` (se muestran una vez) |

## Billetera

| Método | Ruta | Rol | Notas | Respuesta |
|--------|------|-----|-------|-----------|
| GET | `/wallet` | B | — | `{ real, bonus, held, currency }` |
| GET | `/wallet/movements` | B | `?type=&from=&to=&page=&pageSize=` | lista paginada de asientos del usuario |

## Depósitos

| Método | Ruta | Rol | Notas | Respuesta |
|--------|------|-----|-------|-----------|
| POST | `/deposits` | B (correo verificado) | `amount`; header `Idempotency-Key` | 201 `{ id, status: "PENDING", paymentUrl }` |
| GET | `/deposits/:id` | B (dueño) | — | `{ id, amount, status }` |
| GET | `/payments/payphone/return` | P | `?id=&clientTransactionId=`; confirma servidor a servidor | 302 a `WEB_URL/billetera/depositos/:id` |

## Retiros

| Método | Ruta | Rol | Notas | Respuesta |
|--------|------|-----|-------|-----------|
| POST | `/withdrawals` | B (2FA activa) | `amount`, `destinationDocument`, `destinationPhone`, `totpCode`; `Idempotency-Key` | 201 `{ id, status }`; 403 sin 2FA o titular distinto; 422 saldo insuficiente |
| GET | `/withdrawals` | B | propios | lista |

## Administración

| Método | Ruta | Rol | Notas |
|--------|------|-----|-------|
| GET | `/admin/users` | A | filtros `email`, `role`, `status` |
| PATCH | `/admin/users/:id/role` | A | `role`; no deja el sistema sin administradores |
| PATCH | `/admin/users/:id/status` | A | `ACTIVE` \| `SUSPENDED` |
| GET | `/admin/withdrawals` | A | `?status=PENDING_APPROVAL` |
| POST | `/admin/withdrawals/:id/approve` | A | marca pagado con referencia simulada |
| POST | `/admin/withdrawals/:id/reject` | A | `reason`; libera la retención |
| POST | `/admin/ledger/adjustments` | A | `userId`, `account`, `amount` (con signo), `reason`; `Idempotency-Key` |
| GET | `/admin/audit` | A | `?actorId=&action=&from=&to=&page=` |

Todas las respuestas de error usan los mismos códigos: `VALIDATION_ERROR` (400),
`UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `ACCOUNT_LOCKED` (423),
`INSUFFICIENT_FUNDS` (422), `TWO_FACTOR_REQUIRED` (403), `IDEMPOTENCY_CONFLICT` (409, misma clave
con otro cuerpo).
