# Data Model: Cuentas y billetera

Montos en centavos (`Int`), moneda `USD`. Fechas en UTC. IDs `uuid`.
Las tablas marcadas **inmutable** tienen triggers que rechazan `UPDATE` y `DELETE`.

## Identidad

### User
| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid | PK |
| email | string | único, normalizado en minúsculas |
| passwordHash | string | Argon2id |
| birthDate | date | edad ≥ 18 al registrarse (FR-001) |
| role | enum `BETTOR` \| `OPERATOR` \| `ADMIN` | por defecto `BETTOR` |
| status | enum `UNVERIFIED` \| `ACTIVE` \| `SUSPENDED` | |
| lockedUntil | datetime? | bloqueo temporal (FR-005) |
| totpSecretEnc | string? | cifrado AES-256-GCM |
| totpEnabledAt | datetime? | 2FA activa si no es null |
| createdAt | datetime | |

Transiciones de `status`: `UNVERIFIED → ACTIVE` (verifica correo); `ACTIVE ↔ SUSPENDED` (solo
administrador). El bloqueo por intentos no cambia `status`, usa `lockedUntil`.

### EmailToken
| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid | PK |
| userId | uuid | FK User |
| purpose | enum `VERIFY_EMAIL` \| `RESET_PASSWORD` | |
| tokenHash | string | único, SHA-256 |
| expiresAt | datetime | 24 h verificación, 1 h recuperación |
| usedAt | datetime? | un solo uso |

### RefreshToken
| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid | PK |
| userId | uuid | FK User |
| familyId | uuid | sesión de origen |
| tokenHash | string | único, SHA-256 |
| expiresAt | datetime | 7 días |
| usedAt | datetime? | rotado |
| revokedAt | datetime? | logout o reuso detectado |
| ip, userAgent | string | |

Reusar un token con `usedAt` no nulo revoca todos los `RefreshToken` del usuario (FR-004).

### RecoveryCode
`id`, `userId`, `codeHash` (Argon2), `usedAt?`. 10 por usuario al activar 2FA (FR-007).

### LoginAttempt
`id`, `email`, `userId?`, `ip`, `success`, `createdAt`. Índice `(email, createdAt)` para contar fallos
en 15 min.

### AuditLog — **inmutable**
| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid | PK |
| actorId | uuid? | null para acciones anónimas (login fallido) |
| action | string | p. ej. `auth.login.failed`, `wallet.adjustment`, `withdrawal.approved` |
| targetType, targetId | string? | objeto afectado |
| metadata | json | datos sin secretos |
| ip, userAgent | string | |
| createdAt | datetime | |

## Libro contable

### LedgerAccount
| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid | PK |
| type | enum `USER_REAL` \| `USER_BONUS` \| `USER_HELD` \| `HOUSE` \| `GATEWAY` \| `PAYOUT` | |
| userId | uuid? | obligatorio en `USER_*`, null en cuentas del sistema |
| currency | `USD` | |

Único `(userId, type)`. Las tres cuentas `USER_*` se crean al registrar al usuario; las del sistema,
en el seed.

### Wallet
`id`, `userId` (único). Es la fila que se bloquea con `FOR UPDATE` en cada operación de dinero del
usuario; no guarda saldos.

### LedgerTransaction — **inmutable**
| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid | PK |
| type | enum `DEPOSIT` \| `WITHDRAWAL_HOLD` \| `WITHDRAWAL_RELEASE` \| `WITHDRAWAL_PAYOUT` \| `ADJUSTMENT` \| `BET_DEBIT` \| `BET_CREDIT` \| `BONUS_CREDIT` | los `BET_*` y `BONUS_*` los usa la spec 4 |
| idempotencyKey | string | **único** (FR-017) |
| referenceType, referenceId | string | origen (depósito, retiro, apuesta…) |
| reason | string? | obligatorio en `ADJUSTMENT` (FR-015) |
| createdById | uuid? | |
| createdAt | datetime | |

### LedgerPosting — **inmutable**
`id`, `transactionId`, `accountId`, `amount` (con signo, ≠ 0).
Regla: `SUM(amount)` por `transactionId` = 0, validada en el servicio y con un trigger diferido.
Saldo de una cuenta = `SUM(amount)` de sus postings.

## Pagos

### Deposit
| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid | PK |
| userId | uuid | FK |
| amount | int | 100 – 100 000 centavos (FR-021) |
| currency | `USD` | |
| reference | string | único, enviado como `clientTransactionId` |
| providerTxId | string? | `id` de Payphone |
| payerDocument, payerPhone | string? | titular devuelto por Payphone (FR-027) |
| status | enum `PENDING` \| `CREDITED` \| `FAILED` \| `EXPIRED` \| `IN_REVIEW` | |
| ledgerTransactionId | uuid? | asiento de acreditación |
| createdAt, updatedAt | datetime | |

Transiciones: `PENDING → CREDITED | FAILED | EXPIRED | IN_REVIEW`. Estados finales no cambian.

### Withdrawal
| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid | PK |
| userId | uuid | FK |
| amount | int | ≤ saldo real disponible |
| destinationDocument, destinationPhone | string | deben coincidir con un depósito acreditado |
| status | enum `PROCESSING` \| `PENDING_APPROVAL` \| `APPROVED` \| `PAID` \| `REJECTED` | |
| reviewReason | string? | motivo de revisión (umbral, depósito reciente) |
| reviewedById | uuid? | administrador |
| payoutReference | string? | `SIM-<uuid>` |

Transiciones: `PROCESSING → PAID` (bajo umbral); `PENDING_APPROVAL → APPROVED → PAID`;
`PENDING_APPROVAL → REJECTED` (libera la retención).

## Asientos por operación

| Operación | Débito (−) | Crédito (+) |
|-----------|-----------|-------------|
| Depósito acreditado | `GATEWAY` | `USER_REAL` |
| Solicitud de retiro | `USER_REAL` | `USER_HELD` |
| Retiro rechazado | `USER_HELD` | `USER_REAL` |
| Retiro pagado | `USER_HELD` | `PAYOUT` |
| Corrección | según motivo | contrapartida en `HOUSE` |
