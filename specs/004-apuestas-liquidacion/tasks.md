---

description: "Lista de tareas de la spec 4 — Apuestas y liquidación"
---

# Tasks: Apuestas y liquidación

**Input**: Design documents from `/specs/004-apuestas-liquidacion/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: obligatorios. La constitución (principio IV) exige escribir primero las pruebas de
apuestas, liquidación, suspensiones y cupones, y verlas fallar antes de implementar. Cada historia
incluye pruebas de concurrencia, idempotencia o abuso según corresponda.

**Organization**: tareas agrupadas por historia de usuario; cada historia se puede probar sola.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia a la que pertenece (US1…US6)
- **🔖 Commit**: punto de commit atómico. Cada commit agrupa una funcionalidad completa con sus
  pruebas, compila y pasa `pnpm lint`, `pnpm typecheck` y `pnpm test`. No mezclar dos funcionalidades
  en un commit ni partir una funcionalidad en un commit por archivo.

## Path Conventions

- API: `apps/api/src/`, pruebas de integración en `apps/api/test/`, Prisma en `apps/api/prisma/`
- Web: `apps/web/src/app/`, componentes en `apps/web/src/components/`, E2E en `apps/web/e2e/`
- Compartido: `packages/shared/src/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependencias, entorno local y CI listos para colas, WebSocket y pruebas con Redis.

- [X] T001 Añadir a `apps/api/package.json` `@nestjs/bullmq`, `bullmq`, `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io` y (dev) `socket.io-client`; comprobar que Jest las carga como CommonJS (si alguna es solo ESM, fijar la última versión CJS y anotarlo en `CLAUDE.md`)
- [X] T002 [P] Añadir `socket.io-client` a `apps/web/package.json` y el proxy de `/socket.io/:path*` hacia `API_URL` en `apps/web/next.config.ts`
- [X] T003 [P] Añadir `CATALOG_MODE=simulated` y `BULLMQ_PREFIX=apuestas` en `.env.example`
- [X] T004 [P] Añadir servicio `redis:7-alpine` y `REDIS_URL` al job `test-api` en `.github/workflows/ci.yml`
- [X] T005 Extender `apps/api/test/setup.ts` y `apps/api/test/env.ts`: prefijo BullMQ único por ejecución (`test-<pid>`), helper `drainQueues(app)` que vacía las colas entre pruebas y cierre de conexiones Redis en `afterAll`

🔖 Commit: `chore(api): preparar colas, WebSocket y CI para la spec 4`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: esquema, cálculo de cuotas, catálogo simulado, ajustes, colas y sesión compartida que
usan todas las historias.

**⚠️ CRITICAL**: ninguna historia empieza hasta terminar esta fase.

- [X] T006 Añadir a `apps/api/prisma/schema.prisma` todos los modelos y enums de [data-model.md](data-model.md) (Bet, BetSelection, MatchEvent, BetSettlement, MatchHold, BetDebt, BettingSetting, Coupon, CouponRedemption, Bonus, FreeBet, FraudAlert) y los valores nuevos de `LedgerTransactionType` (`BET_REFUND`, `BET_REVERSAL`, `DEBT_COLLECTION`, `BONUS_CONVERSION`, `BONUS_EXPIRY`); generar la migración `spec4_bets` en `apps/api/prisma/migrations/`
- [X] T007 Escribir migración SQL `spec4_integrity` en `apps/api/prisma/migrations/`: triggers que rechazan `DELETE` en `Bet`, `BetSelection`, `BetSettlement`, `MatchEvent`, `CouponRedemption`, `FraudAlert`; que rechazan `UPDATE` de las columnas inmutables de `Bet` (`userId`, `stake`, `source`, `type`, `totalOddsX`, `potentialPayout`, `requestKey`) y de `BetSelection` (`odds`, `selectionId`, `marketId`, `matchId`); que rechazan cualquier `UPDATE` en `BetSettlement` y todo `UPDATE` de `MatchEvent` salvo `processedAt`; índices parciales únicos `Bonus(userId) WHERE status='ACTIVE'` y `FraudAlert(rule, subjectKey) WHERE status='OPEN'`
- [X] T008 [P] Prueba de integración de los triggers e índices de T007 (edición de cuota o monto rechazada, borrado rechazado, segundo bono activo rechazado, alerta abierta duplicada rechazada) en `apps/api/test/bets-immutability.e2e-spec.ts`

🔖 Commit: `feat(api): esquema de apuestas, liquidación, cupones y fraude con triggers de integridad`

- [X] T009 [P] Añadir a `packages/shared/src/types.ts` los enums `BetType`, `StakeSource`, `BetStatus` (reemplaza el actual sin uso), `SelectionStatus`, `CouponType`, `RedemptionStatus`, `BonusStatus`, `FraudRule`, `AlertStatus` y los `ErrorCode` nuevos de [contracts/http-api.md](contracts/http-api.md); y `oddsToString`/`parseOdds` (centésimas ↔ `"2.10"`) en `packages/shared/src/odds.ts`, exportados desde `packages/shared/src/index.ts`
- [X] T010 [P] Pruebas unitarias primero, luego implementación de `apps/api/src/betting/odds.ts`: `potentialPayout(stake, odds[])` exacto con `BigInt` y redondeo hacia abajo, `totalOddsX(odds[])`, `displayTotalOdds()` truncada a 2 decimales, `applyBoost(odds, pct, cap)`; casos 10.00 × 2.10 = 21.00, combinada 1.50·2.00·1.80 = 5.40, selección anulada = 1.00, montos que no dividen exacto, en `apps/api/src/betting/odds.spec.ts`

🔖 Commit: `feat(api): cálculo exacto de cuotas y pagos`

- [X] T011 Crear `MatchCatalogPort`, tipos `SelectionQuote`, `MatchEventJob` y el token `MATCH_CATALOG` según [contracts/match-catalog.md](contracts/match-catalog.md) en `apps/api/src/catalog/match-catalog.port.ts`
- [X] T012 [P] Escribir la suite de contrato `runCatalogContract(factory)` (cuotas vigentes, ids desconocidas omitidas, historial de cuotas, listado solo con mercados abiertos) en `apps/api/src/catalog/testing/catalog-contract.ts`
- [X] T013 Implementar `SimulatedCatalog` en memoria con `fixtures.json` (3 partidos: en 2 h, en vivo con mercado habilitado, empezado hace 10 min; horas relativas al arranque), métodos `setOdds`, `setMarketStatus`, `reset` y registro del historial de cuotas, en `apps/api/src/catalog/simulated/simulated-catalog.ts` y `apps/api/src/catalog/simulated/fixtures.json`; correr la suite de T012 en `apps/api/src/catalog/simulated/simulated-catalog.spec.ts`
- [X] T014 Crear `SimulatedCatalogModule` (provee `MATCH_CATALOG`; se elige en `CatalogModule` según `CATALOG_MODE`), `CatalogController` con `GET /catalog/matches` (roles B O A, cuotas como string) y `DevCatalogController` con `/dev/catalog/odds`, `/dev/catalog/markets/:marketId/status`, `/dev/catalog/events` (encola en `match-events` con `jobId = sourceEventId`) y `/dev/catalog/reset`, solo roles O A y no registrado si `NODE_ENV === 'production'`, en `apps/api/src/catalog/`
- [X] T015 Prueba de integración: `GET /catalog/matches` por rol, `/dev/catalog/*` → 403 a apostadores y 404 con `NODE_ENV=production`, en `apps/api/test/catalog.e2e-spec.ts`

🔖 Commit: `feat(api): puerto del catálogo de partidos y catálogo simulado`

- [X] T016 Configurar BullMQ (`BullModule.forRootAsync` con `REDIS_URL` y `BULLMQ_PREFIX`) y registrar las colas `match-events` y `fraud-checks` con reintentos exponenciales (5 intentos) en `apps/api/src/queues/queues.module.ts`, importado en `apps/api/src/app.module.ts`
- [X] T017 [P] Pruebas primero, luego `BettingSettingsService`: valores por defecto de [data-model.md](data-model.md), validación por clave (enteros positivos, `minStake < maxStake`), caché de 10 s invalidada al escribir, y `set(key, value, actor, meta)` que audita `settings.changed` con valor anterior y nuevo, en `apps/api/src/betting/settings.service.ts` y `apps/api/src/betting/settings.service.spec.ts`
- [X] T018 [P] Extraer de `AuthGuard` la verificación de token + sesión viva + usuario no suspendido a `SessionVerifier.verify(token)` en `apps/api/src/common/auth/session-verifier.ts`; `AuthGuard` la usa sin cambiar comportamiento (debe seguir pasando `apps/api/test/access.e2e-spec.ts`)
- [X] T019 [P] Crear `DeviceIdMiddleware` (cookie httpOnly `device_id`, UUID, 2 años, `SameSite=Lax`, `Secure` en producción; la pone si falta y la expone como `req.deviceId`) y el decorador `@DeviceId()`, en `apps/api/src/common/device-id.middleware.ts`, registrado en `apps/api/src/app.setup.ts` tras `cookie-parser`

🔖 Commit: `feat(api): colas, ajustes de apuestas, verificador de sesión e id de dispositivo`

**Checkpoint**: base lista; las historias pueden empezar.

---

## Phase 3: User Story 1 - Apuesta simple con saldo y cuota garantizados (Priority: P1) 🎯 MVP

**Goal**: aceptar apuestas simples de forma atómica, con cuota congelada, cierre por reloj del
servidor, límites, retardo en vivo e historial.

**Independent Test**: con una billetera de saldo conocido y el catálogo simulado, colocar apuestas
válidas e inválidas y comprobar que solo las válidas se aceptan y el saldo baja exactamente.

### Tests for User Story 1 ⚠️ (escribir primero y verlas fallar)

- [X] T020 [P] [US1] Pruebas de integración de aceptación (escenarios 1–4, 7 y 8 de la US1): apuesta válida congela 2.10 y deja 40.00 USD; sin saldo → `INSUFFICIENT_FUNDS` sin apuesta ni asiento; cuota cambiada → `ODDS_CHANGED` con `details.quotes`; partido iniciado → `MATCH_STARTED`; mercado no abierto → `MARKET_CLOSED`; fuera de límites → `STAKE_OUT_OF_LIMITS`; pago sobre el máximo → `PAYOUT_LIMIT` con `maxStake`; límite diario → `DAILY_LIMIT`; pagar con bono usa `USER_BONUS`; no existe ruta que edite o borre apuestas, en `apps/api/test/bets.e2e-spec.ts`
- [X] T021 [P] [US1] Pruebas de concurrencia e idempotencia: 20 apuestas simultáneas de 10.00 sobre 100.00 → 10 aceptadas, saldo 0.00; 100 apuestas simultáneas → saldo exacto y nunca negativo (SC-002); misma `Idempotency-Key` dos veces → una apuesta y un débito; misma clave con otro monto → `IDEMPOTENCY_CONFLICT`, en `apps/api/test/bets-concurrency.e2e-spec.ts`
- [X] T022 [P] [US1] Prueba de apuesta en vivo: se acepta tras el retardo configurado (bajado a 200 ms en la prueba); si la cuota cambia o el mercado se suspende durante el retardo, se rechaza sin asiento, en `apps/api/test/bets-live.e2e-spec.ts`

### Implementation for User Story 1

- [X] T023 [US1] Crear `PlaceBetDto` (selecciones con `selectionId` y `odds` como string, `stake` como string, `source`; `whitelist`) y `BetView` + mapeo en `apps/api/src/betting/bets.dto.ts`
- [X] T024 [US1] Implementar `BetsService.place(userId, dto, requestKey, meta)` para apuestas simples según R4/R5 de [research.md](research.md): leer cotizaciones con `MATCH_CATALOG`, comparar cuota y estado, validar hora con el reloj del servidor, esperar `live.delayMs` y releer si es en vivo; en una transacción: bloquear billetera (vía `WalletService.debit` con `tx`), revisar límite diario con la billetera bloqueada, crear `Bet` + `BetSelection` con snapshot de etiquetas, `deviceId` e `ip`, débito con clave `bet:{betId}:stake`, auditoría `bet.placed`; auditar `bet.rejected` por motivos de seguridad; devolver la apuesta existente si `(userId, requestKey)` ya existe, en `apps/api/src/betting/bets.service.ts`
- [X] T025 [US1] Crear `BetsController` (`POST /bets` con `@IdempotencyKey()`, `GET /bets` paginado y filtrado, `GET /bets/:id` solo dueño, `GET /betting/limits`) y `BettingModule` en `apps/api/src/betting/`, registrado en `apps/api/src/app.module.ts`

🔖 Commit: `feat(api): aceptación atómica de apuestas simples con cuota congelada y límites`

- [X] T026 [US1] Crear `OperatorBettingController` con `GET /operator/settings` y `PUT /operator/settings/:key` (roles O A) en `apps/api/src/betting/operator.controller.ts`; prueba de integración (apostador → 403, cambio auditado con valor anterior y nuevo, el nuevo límite aplica a la siguiente apuesta) en `apps/api/test/betting-settings.e2e-spec.ts`

🔖 Commit: `feat(api): ajustes de límites de apuestas para operadores`

- [X] T027 [P] [US1] Crear el componente `BetSlip` (selección, monto, pago potencial informativo, elección de saldo, botón "Confirmar apuesta de X USD", aviso de cuota cambiada con botón "Aceptar nueva cuota", mensajes de error de cada `ErrorCode`, `aria-live` para el resultado) en `apps/web/src/components/BetSlip.tsx` y `BetSlip.module.css`, siguiendo el skill `frontend-design`
- [X] T028 [US1] Crear la página `/apuestas` (partidos y mercados de `GET /catalog/matches`, selección → `BetSlip`, `Idempotency-Key` generado por intento de confirmación) en `apps/web/src/app/apuestas/page.tsx`, y añadir "Apostar" y "Mis apuestas" a `apps/web/src/components/AppShell.tsx`
- [X] T029 [US1] Crear la página `/mis-apuestas` (historial paginado, filtros abiertas/liquidadas, detalle con cuotas congeladas) en `apps/web/src/app/mis-apuestas/page.tsx`
- [X] T030 [P] [US1] Crear la página `/operador/ajustes` (editar límites, retardo en vivo, plazo de suspensión) en `apps/web/src/app/operador/ajustes/page.tsx`

🔖 Commit: `feat(web): boleto de apuesta simple, historial y ajustes de operador`

**Checkpoint**: la US1 funciona sola (se puede apostar y ver el historial).

---

## Phase 4: User Story 2 - Liquidación automática en tiempo real (Priority: P1)

**Goal**: liquidar automáticamente e idempotentemente las apuestas al llegar resultados y avisar al
apostador en ≤ 5 s sin recargar.

**Independent Test**: publicar el resultado de un partido simulado con apuestas, comprobar estados,
saldos y avisos; publicarlo de nuevo y comprobar que nada cambia.

### Tests for User Story 2 ⚠️

- [X] T031 [P] [US2] Pruebas unitarias de `betOutcome(bet, selections)` para simples: ganada → pago = potencial; perdida → 0; anulada → reembolso del monto, en `apps/api/src/settlement/bet-outcome.spec.ts`
- [X] T032 [P] [US2] Pruebas de integración de liquidación: `MARKET_RESULTED` liquida ganada (+21.00 al saldo de origen) y perdida (sin asiento); repetir el evento 10 veces → saldos idénticos (SC-005); evento con mismo `sourceEventId` encolado dos veces → un solo `MatchEvent`; apuesta pagada con bono acredita al bono; resultado de un partido sin apuestas → sin efecto; la suma de asientos de cada apuesta cuadra con su estado (SC-010), en `apps/api/test/settlement.e2e-spec.ts`
- [X] T033 [P] [US2] Prueba de recuperación: encolar resultados con el worker detenido, levantar el worker y verificar que todo se liquida (SC-007); un fallo transitorio de base de datos en la primera ejecución se reintenta sin doble pago, en `apps/api/test/settlement-recovery.e2e-spec.ts`
- [X] T034 [P] [US2] Pruebas del gateway con `socket.io-client`: sin cookie o con sesión revocada → `connect_error UNAUTHENTICATED`; el dueño recibe `bet.updated` y `wallet.updated` tras liquidar; otro usuario conectado no recibe nada; dos pestañas del mismo usuario reciben ambas, en `apps/api/test/live.e2e-spec.ts`

### Implementation for User Story 2

- [X] T035 [US2] Implementar `betOutcome` (reglas puras para simples, extensible a combinadas) en `apps/api/src/settlement/bet-outcome.ts`
- [X] T036 [US2] Implementar `SettlementService.applyMarketResult(event)`: marcar `BetSelection` del mercado, recalcular cada apuesta afectada con `betOutcome`, y por apuesta en su propia transacción crear `BetSettlement` versión `n+1` (único `(betId, version)`), acreditar con `bet:{betId}:payout:v{n}` o `bet:{betId}:refund:v{n}` (`BET_CREDIT`/`BET_REFUND`), actualizar estado y `settledAt`, auditar `bet.settled` con actor de sistema; devolver las apuestas cambiadas para notificar, en `apps/api/src/settlement/settlement.service.ts`
- [X] T037 [US2] Implementar `SettlementProcessor` (worker de `match-events`): insertar `MatchEvent` por `sourceEventId` (si ya está procesado, terminar), despachar por tipo, marcar `processedAt`, notificar tras el commit y registrar `settlement.latency_ms` desde `occurredAt`; `SettlementModule` en `apps/api/src/settlement/`
- [X] T038 [US2] Implementar `LiveGateway` (namespace `/live`, autenticación con `SessionVerifier` y la cookie del handshake, sala `user:{id}`, desconexión con `TOKEN_EXPIRED`) y `NotifierService` (`betUpdated`, `walletUpdated`, `bonusUpdated` con montos como string) según [contracts/realtime.md](contracts/realtime.md), en `apps/api/src/realtime/`

🔖 Commit: `feat(api): liquidación idempotente por cola y avisos en tiempo real`

- [X] T039 [P] [US2] Crear el cliente `lib/live.ts` (conexión con `withCredentials`, reconexión con `POST /auth/refresh` ante `TOKEN_EXPIRED`, recarga de `GET /bets` y `GET /wallet` al reconectar, descarte de eventos con versión vieja) y `LiveProvider` en `apps/web/src/lib/live.ts` y `apps/web/src/components/LiveProvider.tsx`
- [X] T040 [US2] Conectar `/mis-apuestas` y el saldo de `AppShell` a `LiveProvider`: el estado y el saldo cambian sin recargar y se anuncian con `aria-live="polite"` (respetando `prefers-reduced-motion`), en `apps/web/src/app/mis-apuestas/page.tsx` y `apps/web/src/components/AppShell.tsx`
- [X] T041 [US2] Prueba E2E con Playwright: depositar, apostar, publicar el resultado por `/dev/catalog/events` y ver la apuesta ganada y el saldo nuevo sin recargar en menos de 5 s, en `apps/web/e2e/betting.spec.ts`

🔖 Commit: `feat(web): resultado de apuestas y saldo en vivo`

**Checkpoint**: ciclo mínimo completo (apostar → cobrar en vivo). MVP.

---

## Phase 5: User Story 3 - Apuesta combinada (Priority: P2)

**Goal**: combinadas de 2 a 10 selecciones de partidos distintos, con cuota total congelada y
liquidación anticipada al perder una selección.

**Independent Test**: aceptar combinadas y liquidarlas con todas las combinaciones de resultados.

### Tests for User Story 3 ⚠️

- [X] T042 [P] [US3] Ampliar `apps/api/src/settlement/bet-outcome.spec.ts` con combinadas: todas ganan → monto × producto; una pierde → perdida aunque haya pendientes; pendientes sin pérdidas → sigue abierta; una anulada → cuota 1.00; todas anuladas → reembolso
- [X] T043 [P] [US3] Pruebas de integración: combinada 1.50·2.00·1.80 de 10.00 → 5.40 y 54.00 con un solo débito; dos selecciones del mismo partido → `VALIDATION_ERROR`; 1 o 11 selecciones → `VALIDATION_ERROR`; una cuota cambiada → `ODDS_CHANGED` y nada aceptado; liquidación como perdida al primer resultado perdedor y como ganada al último ganador, en `apps/api/test/bets-combo.e2e-spec.ts`

### Implementation for User Story 3

- [X] T044 [US3] Extender `BetsService.place` y `PlaceBetDto` a combinadas (2..`combo.maxSelections`, partidos distintos, revalidación de todas las cuotas, retardo si alguna es en vivo, `totalOddsX` y pago con `odds.ts`) en `apps/api/src/betting/bets.service.ts` y `apps/api/src/betting/bets.dto.ts`
- [X] T045 [US3] Extender `betOutcome` y `SettlementService` a combinadas (liquidar en cuanto una selección pierde; pago con las cuotas congeladas y 1.00 en anuladas) en `apps/api/src/settlement/bet-outcome.ts` y `apps/api/src/settlement/settlement.service.ts`

🔖 Commit: `feat(api): apuestas combinadas`

- [X] T046 [US3] Extender `BetSlip` a varias selecciones (lista, quitar selección, cuota total, aviso si dos son del mismo partido, reconfirmación de cuotas cambiadas en bloque) en `apps/web/src/components/BetSlip.tsx` y `apps/web/src/app/apuestas/page.tsx`

🔖 Commit: `feat(web): boleto de apuesta combinada`

**Checkpoint**: US1–US3 funcionan de forma independiente.

---

## Phase 6: User Story 4 - Suspensiones, aplazamientos, cancelaciones y correcciones (Priority: P2)

**Goal**: mantener o anular apuestas según el plazo, reembolsar, aplicar cuota 1.00 en combinadas y
re-liquidar correcciones con saldo adeudado si hace falta.

**Independent Test**: simular partidos suspendidos dentro y fuera de plazo, uno cancelado y una
corrección de resultado; comprobar estados, reembolsos, cuota 1.00 y auditoría.

### Tests for User Story 4 ⚠️

- [X] T047 [P] [US4] Pruebas de integración de suspensiones (escenarios 1–6 y 8): reanudado en plazo → vigente y liquidada al final; aplazado fuera de plazo (plazo bajado a 1 s y cron invocado a mano) → reembolso al saldo de origen; cancelado → reembolso inmediato; combinada con un partido anulado → cuota 1.50·1.00·1.80 = 2.70; todas anuladas → reembolso; mercado resuelto antes de la suspensión se liquida y el resto se anula; anulación repetida → un solo reembolso (SC-006), en `apps/api/test/suspensions.e2e-spec.ts`
- [X] T048 [P] [US4] Pruebas de correcciones (escenario 7): ganada → perdida revierte el pago y audita resultado anterior y nuevo; perdida → ganada paga una vez; corrección repetida 10 veces → un solo efecto; reversión mayor que el saldo → débito de lo disponible, `BetDebt` abierta, `bet.place` y retiro rechazados con `DEBT_OUTSTANDING`, y cobro posterior al acreditarse saldo real; nunca saldo negativo, en `apps/api/test/settlement-corrections.e2e-spec.ts`

### Implementation for User Story 4

- [X] T049 [US4] Implementar `HoldsService`: manejar `MATCH_STATUS_CHANGED` (crear/actualizar `MatchHold` con `deadline = scheduledStart + suspension.windowMs`, cerrar al reanudar, anular al cancelar) y cron cada minuto que anula los holds vencidos; anular = marcar como `VOID` las selecciones de mercados no resueltos del partido y re-evaluar las apuestas con `SettlementService`, en `apps/api/src/settlement/holds.service.ts`
- [X] T050 [US4] Implementar `SettlementService.applyCorrection(event)`: por apuesta afectada y en una transacción, revertir la versión vigente (`bet:{betId}:reversal:v{n}`, `BET_REVERSAL`, hasta el saldo disponible), crear `BetDebt` por el resto, liquidar con el resultado nuevo (versión `n+1`) y auditar `bet.resettled` con resultado anterior, nuevo e importe, en `apps/api/src/settlement/settlement.service.ts`
- [X] T051 [US4] Implementar `DebtService` (`assertNoOpenDebt` → `DEBT_OUTSTANDING`, cron de cobro con `debt:{id}:collect:{n}` y `DEBT_COLLECTION`, auditoría `debt.created`/`debt.collected`) y `DebtGuard`; llamarlo desde `BetsService.place` y desde `WithdrawalsService.request` en `apps/api/src/settlement/debt.service.ts` y `apps/api/src/withdrawals/withdrawals.service.ts`

🔖 Commit: `feat(api): suspensiones, aplazamientos, cancelaciones y re-liquidación con saldo adeudado`

- [X] T052 [US4] Añadir `GET /operator/holds` y `GET /operator/bets` (roles O A) en `apps/api/src/betting/operator.controller.ts`, con prueba de acceso por rol en `apps/api/test/betting-settings.e2e-spec.ts`; crear la página `/operador/partidos-en-espera` (partido, estado, plazo restante, apuestas en espera) en `apps/web/src/app/operador/partidos-en-espera/page.tsx`; mostrar en `/mis-apuestas` el estado "en espera" y el aviso de saldo adeudado

🔖 Commit: `feat: vista de partidos en espera y saldo adeudado`

**Checkpoint**: US1–US4 completas.

---

## Phase 7: User Story 5 - Promociones y cupones (Priority: P3)

**Goal**: cupones de bono de depósito, apuesta gratis y aumento de cuota, con anti-abuso y rollover.

**Independent Test**: crear un cupón de cada tipo, canjearlos, intentar reutilizarlos por usuario,
dispositivo y método de pago, y verificar la conversión del bono.

### Tests for User Story 5 ⚠️

- [X] T053 [P] [US5] Pruebas de cupones: operador crea, pausa y reanuda (apostador → 403; auditado); canje válido; vencido/agotado/pausado/inexistente → `COUPON_INVALID` con motivo; mismo usuario, otra cuenta con la misma cookie `device_id` o con el mismo titular de pago → `COUPON_ALREADY_USED` y `coupon.redeem.rejected` auditado; 150 canjes simultáneos con cupo 100 → exactamente 100 (SC-008); cupón con canjes no se puede editar, en `apps/api/test/coupons.e2e-spec.ts`
- [X] T054 [P] [US5] Pruebas de bonos: canje de bono 50 % tope 20.00 + depósito acreditado de 30.00 → bono de 15.00 al correr el job; un segundo bono con uno activo → `BONUS_ACTIVE`; rollover 5× a cuota ≥ 1.50 con apuestas de bono liquidadas convierte el saldo de bono a real; apuestas a cuota menor o anuladas no cuentan; vencido sin apuestas pendientes → caduca a la casa; conversión y caducidad esperan a que no haya apuestas de bono abiertas, en `apps/api/test/bonus.e2e-spec.ts`
- [X] T055 [P] [US5] Pruebas de apuesta gratis y aumento: apuesta gratis de 5.00 a 3.00 ganada → 10.00 al bono y bono con rollover, sin débito al apostar; usada dos veces → rechazada; anulada → apuesta gratis disponible otra vez si sigue vigente; aumento del 10 % sobre 2.00 → cuota congelada 2.20, respetando el tope, en `apps/api/test/promotions-bets.e2e-spec.ts`

### Implementation for User Story 5

- [X] T056 [US5] Implementar `CouponsService` (`create` con código en mayúsculas, `pause`/`resume`, `redeem(userId, code, deviceId, meta)` en transacción con `FOR UPDATE` del cupón, contador `redeemed`, `payerKey` = hash del documento y teléfono del último depósito acreditado, y creación de `FreeBet` o canje `AWAITING_DEPOSIT`/`AVAILABLE` según tipo) y DTOs en `apps/api/src/promotions/coupons.service.ts`
- [X] T057 [US5] Implementar `BonusService`: job cada minuto que concede bonos de depósito (`bonus:{redemptionId}:grant`, `BONUS_CREDIT`), `grantFromFreeBet`, `recordWager(bet)` al liquidar apuestas de bono, conversión (`BONUS_CONVERSION`, transferencia `USER_BONUS → USER_REAL` con `WalletService.transfer`) y caducidad (`BONUS_EXPIRY`), auditoría y `bonusUpdated`, en `apps/api/src/promotions/bonus.service.ts`
- [X] T058 [US5] Integrar apuestas gratis y aumentos en `BetsService.place` (`source: FREE_BET` sin débito y con `FreeBet.usedAt`; `boostRedemptionId` aplica `applyBoost`) y en `SettlementService` (ganancia neta de apuesta gratis al bono + `grantFromFreeBet`; devolver la apuesta gratis si se anula; `recordWager` para apuestas de bono) en `apps/api/src/betting/bets.service.ts` y `apps/api/src/settlement/settlement.service.ts`
- [X] T059 [US5] Crear `OperatorCouponsController` (`/operator/coupons`, pausa y reanudación) y `PromotionsController` (`POST /coupons/redeem`, `GET /promotions`) y `PromotionsModule` en `apps/api/src/promotions/`

🔖 Commit: `feat(api): cupones, apuestas gratis, aumentos de cuota y rollover de bonos`

- [X] T060 [P] [US5] Crear la página `/promociones` (canjear código, bono con barra de avance del rollover y vencimiento, apuestas gratis y aumentos disponibles) en `apps/web/src/app/promociones/page.tsx`, y en `BetSlip` la opción de usar una apuesta gratis o un aumento disponible
- [X] T061 [P] [US5] Crear la página `/operador/cupones` (crear cupón con validación, lista con canjes, pausar y reanudar) en `apps/web/src/app/operador/cupones/page.tsx`

🔖 Commit: `feat(web): promociones y gestión de cupones`

**Checkpoint**: US1–US5 completas.

---

## Phase 8: User Story 6 - Detección de fraude y alertas (Priority: P3)

**Goal**: reglas configurables que generan alertas y una bandeja de administración para resolverlas.

**Independent Test**: generar cada patrón sospechoso con datos sintéticos y comprobar la alerta
correcta; la actividad normal no genera alertas.

### Tests for User Story 6 ⚠️

- [X] T062 [P] [US6] Pruebas unitarias de cada regla pura de R11 con casos positivos y negativos (umbral justo por debajo y por encima) en `apps/api/src/fraud/rules/*.spec.ts`
- [X] T063 [P] [US6] Pruebas de integración: cada patrón (3 cuentas mismo `device_id`, mismo titular de pago, monto anómalo, apuestas espejo, retiro tras depósito sin actividad, deuda por re-liquidación) genera una alerta deduplicada; un conjunto de actividad normal no genera ninguna (SC-009); alerta alta abierta bloquea canjes con `COUPON_BLOCKED`; solo administrador consulta y resuelve (apostador y operador → 403); resolver exige motivo, audita y puede suspender las cuentas, en `apps/api/test/fraud.e2e-spec.ts`

### Implementation for User Story 6

- [X] T064 [P] [US6] Implementar las reglas `multi-account`, `anomalous-stake`, `odds-drop-pattern` (con `MATCH_CATALOG.oddsHistory`), `mirror-bets`, `withdrawal-no-activity` y `resettlement-debt` como funciones puras con umbrales de `BettingSettingsService` en `apps/api/src/fraud/rules/`
- [X] T065 [US6] Implementar `FraudService` (crear alerta deduplicada por `(rule, subjectKey)`, auditar `fraud.alert.created`, `hasOpenHighAlert(userId)`) y `FraudProcessor` (cola `fraud-checks` encolada tras aceptar apuesta, canjear cupón y crear deuda; cron de 5 min para cuentas múltiples y retiros) en `apps/api/src/fraud/`; usar `hasOpenHighAlert` en `CouponsService.redeem`
- [X] T066 [US6] Crear `FraudAdminController` (`GET /admin/fraud-alerts`, `GET /admin/fraud-alerts/:id`, `POST /admin/fraud-alerts/:id/resolve` con suspensión opcional mediante el servicio de usuarios de la spec 2) y `FraudModule` en `apps/api/src/fraud/`

🔖 Commit: `feat(api): detección de fraude con alertas para administradores`

- [X] T067 [US6] Crear la página `/admin/fraude` (bandeja filtrable por estado y regla, detalle con evidencia y cuentas enlazadas, resolver con motivo y opción de suspender) en `apps/web/src/app/admin/fraude/page.tsx` y enlazarla en el menú de administración

🔖 Commit: `feat(web): bandeja de alertas de fraude`

**Checkpoint**: todas las historias completas.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T068 [P] Revisar las pantallas nuevas a 360 px y con teclado (foco visible, contraste AA, `aria-live`, movimiento reducido) y corregir lo necesario en `apps/web/src/app/`
- [X] T069 [P] Medir la latencia resultado → pantalla en la E2E de T041 y en local con 50 apuestas abiertas; documentar el p95 obtenido (objetivo SC-004 ≤ 5 s) en [quickstart.md](quickstart.md)
- [X] T070 [P] Recorrer [quickstart.md](quickstart.md) de punta a punta y corregir pasos o comandos que no coincidan
- [X] T071 [P] Actualizar `CLAUDE.md` (comandos y notas no obvias: catálogo simulado, colas, Redis en pruebas) y marcar la spec 4 como "Terminada" con su responsable en `specs/README.md`
- [X] T072 Correr `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, todas las pruebas de API y web, y revisar el análisis de SonarQube del PR (sin vulnerabilidades críticas ni altas)

🔖 Commit: `docs(spec-4): comandos, quickstart y cierre`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias.
- **Foundational (Phase 2)**: depende de Setup; bloquea todas las historias.
- **US1 (Phase 3)**: depende de Foundational.
- **US2 (Phase 4)**: depende de US1 (necesita apuestas que liquidar).
- **US3 (Phase 5)**: depende de US1 y US2 (extiende aceptación y liquidación).
- **US4 (Phase 6)**: depende de US2; si US3 está hecha, sus pruebas de combinadas aplican.
- **US5 (Phase 7)**: depende de US1 y US2 (apuestas gratis, aumentos y rollover se liquidan).
- **US6 (Phase 8)**: depende de US1; la regla de deuda depende de US4 y el bloqueo de canjes de US5.
- **Polish (Phase 9)**: al final.

### Grafo de historias

```text
Setup → Foundational → US1 → US2 ─┬─→ US3
                                  ├─→ US4 ─┐
                                  └─→ US5 ─┴─→ US6 → Polish
```

### Within Each User Story

- Las pruebas se escriben primero y deben fallar.
- Modelos y reglas puras → servicios → controladores → web.
- Cada 🔖 deja la rama compilando y con pruebas en verde.

### Parallel Opportunities

- Setup: T002, T003 y T004 en paralelo.
- Foundational: T008, T009, T010 y T012 en paralelo; T017, T018 y T019 en paralelo.
- Las pruebas de cada historia (marcadas [P]) se escriben en paralelo.
- Tras US2, US3, US4 y US5 pueden avanzar en paralelo (tocan `bets.service.ts` y
  `settlement.service.ts`: coordinar o hacerlas en secuencia si trabaja una sola persona).
- Web y API de una misma historia en paralelo una vez fijado el contrato.

---

## Parallel Example: User Story 1

```text
# Pruebas primero, en paralelo:
T020 apps/api/test/bets.e2e-spec.ts
T021 apps/api/test/bets-concurrency.e2e-spec.ts
T022 apps/api/test/bets-live.e2e-spec.ts

# Tras el commit de API, web en paralelo:
T027 apps/web/src/components/BetSlip.tsx
T030 apps/web/src/app/operador/ajustes/page.tsx
```

## Parallel Example: User Story 2

```text
T031 apps/api/src/settlement/bet-outcome.spec.ts
T032 apps/api/test/settlement.e2e-spec.ts
T033 apps/api/test/settlement-recovery.e2e-spec.ts
T034 apps/api/test/live.e2e-spec.ts
```

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Setup y Foundational.
2. US1: apostar con saldo y cuota garantizados.
3. US2: liquidación en vivo. **Parar y validar**: ciclo apostar → cobrar de punta a punta con el
   catálogo simulado. Es el criterio de cierre de las fases F4 y F5 de `PLAN.md`.

### Incremental Delivery

4. US3 (combinadas) → US4 (suspensiones y correcciones) → US5 (cupones) → US6 (fraude).
5. Cada historia termina con sus commits 🔖 y se puede demostrar sola.

### Integración con la spec 3

Cuando exista la spec 3: su módulo provee `MATCH_CATALOG` y pasa `catalog-contract.ts`, produce
eventos en `match-events`, se cambia `CATALOG_MODE` y se borra `apps/api/src/catalog/simulated/`
junto con `GET /catalog/matches` si la spec 3 ofrece su propio listado.
