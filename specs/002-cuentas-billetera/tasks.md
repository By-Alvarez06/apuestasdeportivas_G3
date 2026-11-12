---

description: "Lista de tareas de la spec 2 — Cuentas y billetera"
---

# Tasks: Cuentas y billetera

**Input**: Design documents from `/specs/002-cuentas-billetera/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: obligatorios. La constitución (principio IV) exige escribir primero las pruebas de ledger,
billetera, pagos y retiros, y verlas fallar antes de implementar.

**Organization**: tareas agrupadas por historia de usuario; cada historia se puede probar sola.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia a la que pertenece (US1…US5)
- **🔖 Commit**: punto de commit atómico. Cada commit agrupa una funcionalidad completa con sus
  pruebas, compila y pasa `pnpm lint`, `pnpm typecheck` y `pnpm test`. No mezclar dos funcionalidades
  en un commit ni partir una funcionalidad en un commit por archivo.

## Path Conventions

- API: `apps/api/src/`, pruebas de integración en `apps/api/test/`, Prisma en `apps/api/prisma/`
- Web: `apps/web/src/app/`
- Compartido: `packages/shared/src/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependencias, entorno local y CI listos para escribir pruebas contra PostgreSQL.

- [ ] T001 Añadir dependencias a `apps/api/package.json`: `prisma`, `@prisma/client`, `@nestjs/jwt`, `@nestjs/throttler`, `@nestjs/config`, `@nestjs/schedule`, `argon2`, `otplib`, `qrcode`, `nodemailer`, `cookie-parser`, `class-validator`, `class-transformer`, `supertest` (dev) y sus `@types`
- [ ] T002 [P] Añadir Mailpit (SMTP 1025, web 8025) y la base `apuestas_test` (script de init) en `docker/docker-compose.yml`
- [ ] T003 [P] Añadir `TOTP_ENC_KEY`, `SMTP_URL`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`, `PAYPHONE_RESPONSE_URL`, `WITHDRAWAL_REVIEW_THRESHOLD_CENTS=20000`, `TEST_DATABASE_URL` en `.env.example`
- [ ] T004 Configurar `apps/api/src/main.ts`: `ConfigModule` con `.env`, `cookie-parser`, `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`) y puerto desde `API_PORT`; quitar `--port` del script `dev` en `apps/api/package.json`
- [ ] T005 Añadir servicio `postgres:16-alpine` y paso `pnpm --filter @apuestas/api test:e2e` al job `test-api` en `.github/workflows/ci.yml`

🔖 Commit: `chore(api): preparar dependencias, entorno y CI para la spec 2`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: base de datos, auditoría, guards y manejo de errores que usan todas las historias.

**⚠️ CRITICAL**: ninguna historia empieza hasta terminar esta fase.

- [ ] T006 Crear `apps/api/prisma/schema.prisma` con todas las entidades de [data-model.md](data-model.md) (User, EmailToken, RefreshToken, RecoveryCode, LoginAttempt, AuditLog, LedgerAccount, Wallet, LedgerTransaction, LedgerPosting, Deposit, Withdrawal) y la migración inicial en `apps/api/prisma/migrations/`
- [ ] T007 Escribir migración SQL con triggers que rechazan `UPDATE`/`DELETE` en `AuditLog`, `LedgerTransaction` y `LedgerPosting`, y trigger diferido que valida `SUM(amount) = 0` por transacción, en `apps/api/prisma/migrations/`
- [ ] T008 [P] Prueba de integración que verifica que los triggers rechazan edición y borrado, y asientos descuadrados, en `apps/api/test/immutability.e2e-spec.ts`
- [ ] T009 [P] Crear `PrismaService` y `PrismaModule` global en `apps/api/src/prisma/`
- [ ] T010 [P] Crear helper de pruebas que limpia y migra `apuestas_test` y crea la app de Nest, en `apps/api/test/setup.ts`
- [ ] T011 Crear seed con cuentas del sistema (`HOUSE`, `GATEWAY`, `PAYOUT`) y primer administrador desde `ADMIN_EMAIL`/`ADMIN_PASSWORD`, en `apps/api/prisma/seed.ts`

🔖 Commit: `feat(api): esquema de datos con libro contable y auditoría inmutables`

- [ ] T012 [P] Añadir enums y DTOs compartidos (`UserStatus`, `DepositStatus`, `WithdrawalStatus`, `ErrorCode`, `Money` como string `"0.00"`) en `packages/shared/src/types.ts`, y helpers `toCents`/`fromCents` con pruebas en `packages/shared/src/money.ts`
- [ ] T013 [P] Crear `AuditService.record({ actorId, action, target, metadata, ip, userAgent })` y `AuditModule` en `apps/api/src/audit/`
- [ ] T014 [P] Crear filtro global de errores con formato `{ error: { code, message } }` y excepciones de dominio en `apps/api/src/common/errors/`
- [ ] T015 Crear `AuthGuard` global (JWT en cookie `access_token`, denegado por defecto), decorador `@Public()`, `RolesGuard` con `@Roles(...)` y decorador `@CurrentUser()` en `apps/api/src/common/auth/`
- [ ] T016 [P] Crear verificación de `Origin` contra `WEB_URL` en peticiones que cambian estado, en `apps/api/src/common/csrf.middleware.ts`
- [ ] T017 [P] Crear interceptor que exige el header `Idempotency-Key` en rutas marcadas con `@Idempotent()`, en `apps/api/src/common/idempotency/`
- [ ] T018 Pruebas de los guards: sin sesión → 401, rol incorrecto → 403, ruta sin `@Roles` → 403, en `apps/api/src/common/auth/roles.guard.spec.ts`

🔖 Commit: `feat(api): guards de autenticación y roles, auditoría y errores comunes`

**Checkpoint**: base lista; las historias pueden empezar.

---

## Phase 3: User Story 1 - Registro e inicio de sesión seguro (Priority: P1) 🎯 MVP

**Goal**: registrarse, verificar el correo, iniciar y cerrar sesión, con bloqueo por fuerza bruta.

**Independent Test**: registro → correo en Mailpit → verificación → login → logout; 5 fallos bloquean
15 min.

### Tests for User Story 1 ⚠️ (escribir primero, deben fallar)

- [ ] T019 [P] [US1] Prueba de registro: mayor de edad crea cuenta `UNVERIFIED` con 3 cuentas `USER_*` y billetera; menor de edad rechazado; correo repetido responde 202 sin revelar; contraseña débil o filtrada rechazada, en `apps/api/test/auth-register.e2e-spec.ts`
- [ ] T020 [P] [US1] Prueba de verificación y login: token válido activa, usado o caducado → 410; login correcto pone cookies; error genérico 401; 5 fallos en 15 min → 423 y auditoría, en `apps/api/test/auth-login.e2e-spec.ts`
- [ ] T021 [P] [US1] Prueba de sesión: refresh rota el token; reusar un refresh revoca todas las sesiones; logout invalida; recuperación de contraseña cierra sesiones, en `apps/api/test/auth-session.e2e-spec.ts`

### Implementation for User Story 1

- [ ] T022 [P] [US1] Crear `PasswordService` (Argon2id, política de 10 caracteres, consulta k-anonymity a HIBP con fallo abierto) en `apps/api/src/auth/password.service.ts`
- [ ] T023 [P] [US1] Crear `CaptchaService` (Turnstile, verificación en servidor; claves de prueba en dev/CI) en `apps/api/src/auth/captcha.service.ts`
- [ ] T024 [P] [US1] Crear `MailService` (nodemailer + plantillas de verificación, recuperación y aviso de registro duplicado) en `apps/api/src/auth/mail.service.ts`
- [ ] T025 [US1] Crear `TokenService` (JWT de acceso 15 min, refresh opaco 7 días con hash SHA-256, rotación y detección de reuso) en `apps/api/src/auth/token.service.ts`
- [ ] T026 [US1] Crear `AuthService` (registro que crea usuario, billetera y cuentas `USER_*` en una transacción; verificación; login con `LoginAttempt` y `lockedUntil`; recuperación) con auditoría en `apps/api/src/auth/auth.service.ts`
- [ ] T027 [US1] Crear `AuthController` con las rutas de autenticación de [contracts/http-api.md](contracts/http-api.md) (sin 2FA), cookies `httpOnly`/`Secure`/`SameSite=Lax` y `ThrottlerGuard` por IP en `apps/api/src/auth/auth.controller.ts`
- [ ] T028 [US1] Registrar `AuthModule` y `ThrottlerModule` en `apps/api/src/app.module.ts`

🔖 Commit: `feat(api): registro, verificación de correo, login y sesiones rotativas`

- [ ] T029 [P] [US1] Crear cliente HTTP con `credentials: 'include'` y renovación automática ante 401 en `apps/web/src/lib/api.ts`
- [ ] T030 [P] [US1] Crear páginas de registro, ingreso, verificación de correo y recuperación (mobile-first, WCAG AA, Turnstile) en `apps/web/src/app/(auth)/`
- [ ] T031 [US1] Prueba E2E de registro → verificación (Mailpit API) → login con Playwright en `apps/web/e2e/registro.spec.ts`

🔖 Commit: `feat(web): pantallas de registro e inicio de sesión`

**Checkpoint**: US1 funciona sola.

---

## Phase 4: User Story 2 - Billetera con saldo trazable (Priority: P1)

**Goal**: billetera con saldo real, bono y retenido derivado del libro contable, segura ante
concurrencia.

**Independent Test**: aplicar créditos y débitos de prueba; 20 débitos simultáneos sobre 100.00 USD
dejan exactamente 0.00 USD.

### Tests for User Story 2 ⚠️ (escribir primero, deben fallar)

- [ ] T032 [P] [US2] Suite de contrato de `WalletService` reutilizable (débito sin saldo falla, idempotencia, misma clave con otro monto → conflicto, hold/release) exportada en `apps/api/src/wallet/testing/wallet-contract.ts`
- [ ] T033 [P] [US2] Prueba de concurrencia: 20 débitos de 10.00 simultáneos sobre 100.00 → 10 aceptados, saldo 0.00; 100 operaciones mixtas cuadran al centavo (SC-002), en `apps/api/test/wallet-concurrency.e2e-spec.ts`
- [ ] T034 [P] [US2] Prueba de reconstrucción: el saldo es igual a la suma del historial (SC-005) y el endpoint de movimientos pagina y filtra, en `apps/api/test/wallet-movements.e2e-spec.ts`

### Implementation for User Story 2

- [ ] T035 [US2] Crear `LedgerService.post({ type, idempotencyKey, reference, postings }, tx)` que valida suma 0 y devuelve la transacción existente si la clave se repite, en `apps/api/src/wallet/ledger.service.ts`
- [ ] T036 [US2] Crear `WalletService` (`getBalances`, `debit`, `credit`, `hold`, `release` con `SELECT … FOR UPDATE` sobre `Wallet` y `tx` opcional) según [contracts/wallet-service.md](contracts/wallet-service.md) en `apps/api/src/wallet/wallet.service.ts`
- [ ] T037 [US2] Crear `WalletController` (`GET /wallet`, `GET /wallet/movements`, rol apostador) y `WalletModule` que exporta `WalletService`, en `apps/api/src/wallet/`
- [ ] T038 [US2] Crear doble en memoria de `WalletService` que pasa la misma suite de contrato, para la spec 4, en `apps/api/src/wallet/testing/in-memory-wallet.service.ts`

🔖 Commit: `feat(api): billetera sobre libro contable con bloqueo e idempotencia`

- [ ] T039 [US2] Crear página de billetera con saldos e historial paginado en `apps/web/src/app/billetera/page.tsx`

🔖 Commit: `feat(web): pantalla de billetera y movimientos`

**Checkpoint**: US1 y US2 funcionan; la spec 4 ya puede usar `WalletService`.

---

## Phase 5: User Story 3 - Depositar con la pasarela de pagos (Priority: P2)

**Goal**: depósitos con Payphone sandbox que se acreditan una sola vez y solo tras confirmar con la
pasarela.

**Independent Test**: depósito pagado en el sandbox se acredita; repetir la confirmación no cambia el
saldo; datos que no coinciden dejan el depósito en revisión.

### Tests for User Story 3 ⚠️ (escribir primero, deben fallar)

- [ ] T040 [P] [US3] Prueba de contrato de `PayphoneClient` con respuestas grabadas de `Prepare` y `V2/Confirm` (aprobado, cancelado, monto distinto) en `apps/api/src/deposits/payphone.client.spec.ts`
- [ ] T041 [P] [US3] Prueba de depósitos con `PayphoneClient` falso: correo sin verificar → 403; fuera de límites → 400; confirmación aprobada acredita; 10 confirmaciones repetidas acreditan una vez (SC-003); monto o referencia distintos → `IN_REVIEW` y auditoría; el retorno sin confirmar no acredita, en `apps/api/test/deposits.e2e-spec.ts`
- [ ] T042 [P] [US3] Prueba del job de reconciliación: confirma pendientes y expira los de más de 24 h, en `apps/api/test/deposits-reconcile.e2e-spec.ts`

### Implementation for User Story 3

- [ ] T043 [US3] Verificar en el sandbox de Payphone los nombres de campos y estados de `Prepare` y `V2/Confirm`, grabar las respuestas en `apps/api/src/deposits/__fixtures__/` y anotar diferencias en [research.md](research.md) §11
- [ ] T044 [US3] Crear `PayphoneClient` (interfaz + implementación HTTP con `PAYPHONE_TOKEN`) en `apps/api/src/deposits/payphone.client.ts`
- [ ] T045 [US3] Crear `DepositsService` (crear intención, confirmar con validación de monto/moneda/referencia y crédito `GATEWAY → USER_REAL` con clave `deposit:<id>`, guardar titular del pagador) en `apps/api/src/deposits/deposits.service.ts`
- [ ] T046 [US3] Crear `DepositsController` (`POST /deposits`, `GET /deposits/:id`, `GET /payments/payphone/return`) en `apps/api/src/deposits/deposits.controller.ts`
- [ ] T047 [US3] Crear job cada 5 min de reconciliación y expiración con `@nestjs/schedule` en `apps/api/src/deposits/deposits.reconcile.ts`

🔖 Commit: `feat(api): depósitos con Payphone confirmados servidor a servidor`

- [ ] T048 [US3] Crear páginas de depositar y estado del depósito (pendiente, acreditado, fallido) en `apps/web/src/app/billetera/depositar/` y `apps/web/src/app/billetera/depositos/[id]/`
- [ ] T049 [US3] Prueba E2E de depósito con Payphone simulado en `apps/web/e2e/deposito.spec.ts`

🔖 Commit: `feat(web): flujo de depósito`

**Checkpoint**: se puede cargar saldo de prueba.

---

## Phase 6: User Story 4 - Retirar ganancias con 2FA (Priority: P3)

**Goal**: 2FA TOTP y retiros de saldo real al mismo titular, con revisión manual.

**Independent Test**: sin 2FA el retiro se rechaza; con 2FA, uno bajo el umbral se paga y uno sobre el
umbral queda pendiente.

### Tests for User Story 4 ⚠️ (escribir primero, deben fallar)

- [ ] T050 [P] [US4] Prueba de 2FA: setup devuelve QR; enable con código válido activa y entrega 10 códigos de recuperación; cada código de recuperación sirve una vez, en `apps/api/test/two-factor.e2e-spec.ts`

### Implementation for User Story 4 (2FA)

- [ ] T051 [US4] Crear `TwoFactorService` (secreto TOTP cifrado AES-256-GCM con `TOTP_ENC_KEY`, verificación con `otplib`, códigos de recuperación con Argon2) y rutas `/auth/2fa/setup` y `/auth/2fa/enable` en `apps/api/src/auth/two-factor.service.ts`
- [ ] T052 [US4] Crear página de seguridad de la cuenta con activación de 2FA en `apps/web/src/app/cuenta/seguridad/page.tsx`

🔖 Commit: `feat: verificación en dos pasos con TOTP`

### Tests for User Story 4 (retiros) ⚠️

- [ ] T053 [P] [US4] Prueba de abuso: sin 2FA → 403; código inválido → 403; otro titular → 403 y auditoría; saldo de bono no retirable; saldo insuficiente → 422 (SC-006), en `apps/api/test/withdrawals-abuse.e2e-spec.ts`
- [ ] T054 [P] [US4] Prueba de flujo: bajo umbral retiene y paga con `SIM-`; sobre umbral o tras depósito sin apuestas queda `PENDING_APPROVAL`; rechazo libera la retención; dos retiros simultáneos que superan el saldo → solo uno, en `apps/api/test/withdrawals.e2e-spec.ts`

### Implementation for User Story 4 (retiros)

- [ ] T055 [US4] Crear `WithdrawalsService` (validar 2FA y titular contra depósitos acreditados, `hold`, reglas de revisión, pago simulado `USER_HELD → PAYOUT`, rechazo con `release`) en `apps/api/src/withdrawals/withdrawals.service.ts`
- [ ] T056 [US4] Crear `WithdrawalsController` (`POST /withdrawals`, `GET /withdrawals`) y rutas de administración `approve`/`reject` en `apps/api/src/withdrawals/`
- [ ] T057 [US4] Crear página de retiro y listado de retiros propios en `apps/web/src/app/billetera/retirar/page.tsx`

🔖 Commit: `feat: retiros con 2FA, mismo titular y revisión manual`

**Checkpoint**: el ciclo del dinero está completo.

---

## Phase 7: User Story 5 - Roles y auditoría para la administración (Priority: P3)

**Goal**: el administrador gestiona roles, suspende cuentas, aprueba retiros, corrige saldos y
consulta la auditoría.

**Independent Test**: cambiar un rol y verlo en la auditoría; un apostador recibe 403 en toda ruta de
administración.

### Tests for User Story 5 ⚠️ (escribir primero, deben fallar)

- [ ] T058 [P] [US5] Prueba de autorización: cada ruta `/admin/*` responde 403 a apostador y operador (SC-007); el único administrador no puede quitarse el rol; suspensión impide login, en `apps/api/test/admin.e2e-spec.ts`
- [ ] T059 [P] [US5] Prueba de auditoría: toda acción de FR-011 queda con quién, qué, cuándo, IP y dispositivo (SC-009); corrección contable exige motivo, en `apps/api/test/audit.e2e-spec.ts`

### Implementation for User Story 5

- [ ] T060 [US5] Crear `UsersAdminController` y servicio (listar, cambiar rol, suspender/activar) en `apps/api/src/users/`
- [ ] T061 [US5] Crear `GET /admin/audit` con filtros y paginación en `apps/api/src/audit/audit.controller.ts`
- [ ] T062 [US5] Crear `POST /admin/ledger/adjustments` (asiento compensatorio contra `HOUSE`, motivo obligatorio, `Idempotency-Key`) en `apps/api/src/wallet/adjustments.controller.ts`

🔖 Commit: `feat(api): administración de usuarios, auditoría y correcciones contables`

- [ ] T063 [US5] Crear páginas de administración de usuarios, retiros pendientes y auditoría en `apps/web/src/app/admin/`

🔖 Commit: `feat(web): panel de administración`

**Checkpoint**: todas las historias funcionan por separado.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T064 [P] Añadir comandos reales (dev, test, test:e2e, un solo test, migraciones, seed) en la sección "Estado del proyecto" de `CLAUDE.md`
- [ ] T065 [P] Revisión de cabeceras de seguridad (`helmet`) y que ningún log incluya contraseñas, tokens ni secretos TOTP, en `apps/api/src/main.ts`
- [ ] T066 Recorrer [quickstart.md](quickstart.md) completo y corregir lo que no coincida
- [ ] T067 Actualizar la fila de la spec 2 a "Terminada" en `specs/README.md`

🔖 Commit: `docs(spec-2): comandos, quickstart y cierre`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)** → historias.
- **US1 (3)** y **US2 (4)** dependen solo de la fase 2 y pueden ir en paralelo (US2 prueba con
  usuarios creados en el helper de pruebas).
- **US3 (5)** depende de US2 (acredita en la billetera) y de US1 (correo verificado).
- **US4 (6)** depende de US1 (2FA sobre la sesión), US2 (`hold`/`release`) y US3 (titular del
  depósito).
- **US5 (7)** depende de la fase 2; las rutas de retiros y correcciones necesitan US4 y US2.
- **Polish (8)** al final.

### Within Each User Story

- Pruebas primero y en rojo → servicios → controladores → web → commit.

### Parallel Opportunities

- Fase 1: T002, T003.
- Fase 2: T008, T009, T010 tras T006–T007; T012, T013, T014, T016, T017 entre sí.
- US1: T019–T021 juntas; T022–T024 juntas; T029–T030 juntas.
- US2: T032–T034 juntas.
- US3: T040–T042 juntas.
- US4: T053–T054 juntas.
- US5: T058–T059 juntas.

## Parallel Example: User Story 2

```text
T032 Suite de contrato de WalletService en apps/api/src/wallet/testing/wallet-contract.ts
T033 Prueba de concurrencia en apps/api/test/wallet-concurrency.e2e-spec.ts
T034 Prueba de reconstrucción en apps/api/test/wallet-movements.e2e-spec.ts
```

## Implementation Strategy

### MVP First

1. Fases 1 y 2.
2. US1 (registro e inicio de sesión) y US2 (billetera): ya hay usuarios con saldo trazable y la
   spec 4 puede integrarse con `WalletService`.
3. **Parar y validar**; abrir PR a `develop` si el equipo necesita la billetera pronto.

### Incremental Delivery

US3 (depósitos) → US4 (2FA y retiros) → US5 (administración). Cada historia termina con sus commits
y deja la rama en verde.

## Notes

- Commits atómicos: 1 o 2 por funcionalidad (API y web), siempre con sus pruebas; nunca un commit que
  no compile o con pruebas en rojo.
- Mensajes Conventional Commits en español: `feat(api): …`, `feat(web): …`, `test(api): …`,
  `chore: …`, `docs(spec-2): …`.
- Las tareas que tocan archivos compartidos (T002, T003, T004, T005, T012) se avisan al equipo para
  evitar conflictos con las ramas de las specs 3 y 4.
