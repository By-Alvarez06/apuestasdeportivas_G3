# Research: Cuentas y billetera

Decisiones técnicas para la spec 2. Las decisiones base vienen de [`PLAN.md`](../../PLAN.md) §2;
aquí se concretan y se resuelven los puntos abiertos.

## 1. Persistencia y transacciones

- **Decision**: Prisma sobre PostgreSQL 16. Las operaciones de billetera usan
  `prisma.$transaction` interactiva con `SELECT … FOR UPDATE` (vía `$queryRaw`) sobre la fila de la
  billetera antes de calcular el saldo.
- **Rationale**: Prisma ya está decidido en PLAN.md; el bloqueo de fila explícito es lo que exige la
  constitución (II) y serializa las operaciones sobre una misma billetera sin bloquear las demás.
- **Alternatives considered**: aislamiento `SERIALIZABLE` con reintentos (más difícil de razonar y
  probar); TypeORM (otro ORM sin ventaja clara).

## 2. Representación del dinero

- **Decision**: enteros en centavos (`Int`) en base de datos y en el código; conversión a
  "12.34" solo en los bordes (DTO de entrada/salida). Moneda única `USD`.
- **Rationale**: evita errores de coma flotante (FR-020); `packages/shared` ya expresa los límites
  de apuesta en centavos. `Int` alcanza para 21 millones de USD por asiento, de sobra para el sandbox.
- **Alternatives considered**: `Decimal` de Prisma (correcto pero obliga a usar una librería decimal
  en todo el código).

## 3. Modelo del libro contable

- **Decision**: doble entrada con tres tablas: `LedgerAccount`, `LedgerTransaction` (cabecera con
  tipo, referencia y clave de idempotencia única) y `LedgerPosting` (líneas con monto con signo; la
  suma de las líneas de una transacción es 0). Saldo de una cuenta = `SUM(amount)` de sus líneas.
  Cuentas por usuario: `USER_REAL`, `USER_BONUS`, `USER_HELD`. Cuentas del sistema: `HOUSE`,
  `GATEWAY` (Payphone), `PAYOUT` (retiros pagados).
- **Rationale**: el saldo nunca se guarda ni se edita (FR-014); la retención de retiros es solo un
  movimiento `USER_REAL → USER_HELD` (FR-028), sin estados especiales en el saldo.
- **Alternatives considered**: columna `balance` cacheada actualizada en la misma transacción (más
  rápida, pero es justo lo que la constitución prohíbe); event sourcing completo (excesivo).

## 4. Inmutabilidad

- **Decision**: triggers de PostgreSQL que lanzan error en `UPDATE`/`DELETE` sobre
  `LedgerTransaction`, `LedgerPosting` y `AuditLog`, creados en una migración SQL de Prisma.
- **Rationale**: la garantía queda en la base de datos, no depende de que nadie olvide una regla en
  el código (FR-012, FR-014).
- **Alternatives considered**: solo convención en el código (no verificable); revocar permisos al
  usuario de la app (Prisma usa un solo usuario, complica las migraciones).

## 5. Idempotencia

- **Decision**: toda operación de dinero recibe `idempotencyKey`; `LedgerTransaction.idempotencyKey`
  es `UNIQUE`. Si la clave ya existe, se devuelve la transacción existente sin crear otra. Los
  endpoints HTTP que mueven dinero exigen el header `Idempotency-Key`.
- **Rationale**: FR-017; la restricción única cubre también la carrera entre dos peticiones iguales.

## 6. Hash de contraseñas

- **Decision**: Argon2id con el paquete `argon2` (parámetros por defecto de OWASP: m=19 MiB, t=2,
  p=1). Comprobación contra contraseñas filtradas con la API k-anonymity de Have I Been Pwned
  (solo se envían 5 caracteres del SHA-1); si la API no responde, se acepta la contraseña.
- **Rationale**: Argon2 está decidido en PLAN.md; HIBP con k-anonymity no expone la contraseña.

## 7. Sesiones

- **Decision**: JWT de acceso de 15 minutos firmado con `JWT_SECRET` (`@nestjs/jwt`) en cookie
  `httpOnly`, `Secure`, `SameSite=Lax`. Refresh token opaco aleatorio de 7 días en otra cookie
  `httpOnly` limitada a `/auth/refresh`; en base de datos solo se guarda su hash SHA-256. Cada
  refresh marca el token como usado y emite uno nuevo de la misma familia; reutilizar un token usado
  revoca todas las sesiones del usuario (FR-004).
- **Rationale**: cookies `httpOnly` evitan robo por XSS; el refresh rotativo detecta tokens robados.
- **CSRF**: `SameSite=Lax` más verificación del header `Origin` contra `WEB_URL` en peticiones que
  cambian estado.
- **Alternatives considered**: sesiones en Redis (otra pieza más sin ventaja aquí); Passport (capa
  extra; un guard propio con `@nestjs/jwt` es suficiente).

## 8. 2FA

- **Decision**: TOTP (RFC 6238) con `otplib`, secreto cifrado en base de datos con AES-256-GCM
  (`TOTP_ENC_KEY`), QR con `qrcode`. 10 códigos de recuperación guardados con hash Argon2, cada uno
  de un solo uso.
- **Rationale**: TOTP está decidido en PLAN.md y funciona con cualquier app autenticadora.

## 9. Rate limiting y anti-bots

- **Decision**: `@nestjs/throttler` con almacenamiento en Redis para límite por IP; bloqueo de
  cuenta (5 fallos / 15 min) calculado desde `LoginAttempt` en base de datos. CAPTCHA con Cloudflare
  Turnstile (gratis, con claves de prueba para desarrollo y CI), verificado en el servidor.
- **Rationale**: Redis ya está en la infraestructura; Turnstile no exige resolver retos visuales,
  lo que ayuda a WCAG AA.
- **Alternatives considered**: reCAPTCHA (peor accesibilidad y privacidad).

## 10. Correo

- **Decision**: `nodemailer` por SMTP. En desarrollo y CI, Mailpit en `docker/docker-compose.yml`
  (bandeja web en `localhost:8025`). Los tokens de verificación y recuperación son aleatorios, se
  guardan con hash y caducan (24 h y 1 h).
- **Rationale**: SMTP es estándar y Mailpit permite probar los flujos de correo sin servicios
  externos.

## 11. Payphone (sandbox)

- **Decision**: flujo "Botón de pago" de Payphone:
  1. `POST /api/button/Prepare` desde el backend con `amount` en centavos, `clientTransactionId` =
     referencia de la intención, `responseUrl` y `cancellationUrl`. Devuelve la URL de pago.
  2. Payphone redirige al `responseUrl` con `id` y `clientTransactionId`. Ese endpoint **no
     acredita**: llama a `POST /api/button/V2/Confirm` servidor a servidor con el token del comercio.
  3. Se acredita solo si `transactionStatus = Approved`, `amount`, `currency` y
     `clientTransactionId` coinciden con la intención; si no, queda `IN_REVIEW`.
  4. Un job cada 5 minutos reintenta la confirmación de intenciones `PENDING` y marca `EXPIRED` las de
     más de 24 h.
- **Rationale**: el redirect solo dispara la confirmación; la verdad viene de la API de Payphone
  (FR-023, FR-024). El job cubre usuarios que cierran el navegador antes de volver.
- **Pendiente de verificar en el sandbox**: nombres exactos de campos y códigos de estado de la
  respuesta de `Confirm`; se fijan en un test de contrato con una respuesta grabada.
- **Alternatives considered**: depender de la notificación externa de Payphone (no está garantizada
  en sandbox; puede añadirse luego como disparador adicional de la misma confirmación).

## 12. Retiros

- **Decision**: Payphone no ofrece pagos salientes en el sandbox del botón de pago, así que se usa el
  camino de la spec (FR-030): el retiro aprobado mueve `USER_HELD → PAYOUT` con una referencia
  simulada `SIM-<uuid>`. "Mismo titular" = el documento/teléfono del pagador que devolvió Payphone en
  los depósitos acreditados del usuario.
- **Rationale**: es la alternativa prevista en `promtp.md` §3.2.

## 13. Pruebas

- **Decision**: Jest + Supertest. Unitarias sin base de datos; integración y concurrencia contra un
  PostgreSQL real (base `apuestas_test` del docker-compose; en CI, un `services: postgres` en el job
  `test-api`). Payphone se simula con un adaptador falso inyectado por Nest. E2E web con Playwright
  para registro y depósito.
- **Rationale**: los bloqueos de fila y los triggers solo se prueban de verdad contra PostgreSQL
  (constitución IV).
