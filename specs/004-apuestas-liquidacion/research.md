# Research: Apuestas y liquidación

Decisiones técnicas de la spec 4. Formato: decisión, razón, alternativas descartadas.

## R1. Base de código: la spec 2 ya integrada en `develop`

- **Decisión**: `feature/spec-4` parte de `develop` con la spec 2 integrada (PR #3). Se usan
  directamente `WalletService`, `LedgerService`, `AuditService`, `AuthGuard`/`RolesGuard`, Prisma y
  la infraestructura de pruebas (`test/setup.ts`, `test/fakes.ts`).
- **Razón**: simular login, roles, auditoría y billetera sería trabajo desechable y haría más
  arriesgada la integración final.
- **Alternativas**: quedarse en `develop` con dobles de todo (descartada por coste y riesgo); usar el
  doble en memoria `InMemoryWalletService` en producción (descartado: solo sirve para pruebas
  unitarias, que sí lo usan).

## R2. Spec 3 detrás de un puerto (`MatchCatalogPort`) y una cola de eventos

- **Decisión**: la spec 4 no lee tablas de partidos. Consume:
  1. `MatchCatalogPort` (síncrono): datos vigentes de selecciones para validar una apuesta.
  2. La cola BullMQ `match-events` (asíncrona): resultados de mercados, cambios de estado de partido
     y correcciones. La spec 3 será la productora.

  Mientras la spec 3 no exista, `SimulatedCatalogModule` implementa ambos: un catálogo en memoria
  cargado de `apps/api/src/catalog/simulated/fixtures.json` y endpoints de operador (solo fuera de
  producción) para cambiar cuotas y publicar eventos. Contrato en
  [contracts/match-catalog.md](contracts/match-catalog.md).
- **Razón**: desacopla las dos specs; la spec 3 solo tiene que cumplir el contrato. Las apuestas
  guardan una copia (snapshot) de los nombres de partido, mercado y selección, así que no necesitan
  claves foráneas a tablas de la spec 3.
- **Alternativas**: crear ya las tablas de partidos (descartado: es alcance de la spec 3 y
  chocaría con su modelo); llamar a la spec 3 por HTTP (descartado: es el mismo proceso).

## R3. Representación de cuotas y cálculo del pago

- **Decisión**: cuota como entero en centésimas (`2.10` → `210`), mínimo `101`. Pago potencial
  `floor(monto × Π cuotas / 100ⁿ)` en centavos calculado con `BigInt` (exacto). La cuota total que se
  guarda y se muestra es `Π cuotas` truncada a 2 decimales solo para mostrar; el dinero se calcula
  siempre con el producto exacto. Selección anulada = `100`.
- **Razón**: sin coma flotante en dinero (constitución II, FR-020 de la spec 2). El redondeo hacia
  abajo nunca paga de más.
- **Alternativas**: `Decimal` de Prisma (más lento y propenso a mezclar con `number`); flotantes
  (descartado).

## R4. Aceptación atómica de la apuesta

- **Decisión**: `BetsService.place()` abre una transacción Prisma y dentro: (1) `FOR UPDATE` de la
  fila `Wallet` (lo hace `WalletService.debit` con `tx`), (2) revalida límites diarios y deuda con la
  billetera ya bloqueada, (3) inserta `Bet` + `BetSelection`, (4) `debit` con clave
  `bet:{betId}:stake`, (5) registra la auditoría. Las cuotas, el estado del mercado y la hora de
  inicio se leen del catálogo justo antes de abrir la transacción y se comparan con las enviadas por
  el cliente.
- **Idempotencia**: el cliente envía `Idempotency-Key`; se guarda en `Bet.requestKey` único por
  usuario. Una segunda solicitud con la misma clave devuelve la apuesta existente (o 409 si los datos
  difieren).
- **Razón**: cumple FR-002 y la constitución II con el mecanismo que la spec 2 ya probó.
- **Alternativas**: reservar saldo con `hold` y confirmar después (más estados, sin beneficio).

## R5. Retardo de apuestas en vivo

- **Decisión**: para selecciones de mercados en vivo, el servidor espera el retardo configurado
  (`liveDelayMs`, 5 000 por defecto) dentro de la petición y luego vuelve a leer el catálogo y
  ejecuta la aceptación de R4. No se mueve dinero durante la espera.
- **Razón**: la solución más simple que cumple FR-007; si el proceso cae durante la espera no queda
  nada a medias. La clave de idempotencia evita duplicados si el cliente reintenta.
- **Alternativas**: estado `PENDING_ACCEPTANCE` + job diferido en BullMQ (más estados y polling en
  el cliente; se puede adoptar si el retardo crece).

## R6. Cola persistente de eventos y liquidación

- **Decisión**: BullMQ sobre Redis (`@nestjs/bullmq`). Cola `match-events` con `jobId` = id del
  evento de la fuente (deduplicación en Redis). El worker `SettlementProcessor` primero inserta el
  evento en `MatchEvent` (único por `sourceEventId`) y luego procesa; reintentos con backoff
  exponencial. Cada apuesta se liquida en su propia transacción.
- **Idempotencia**: `BetSettlement` único por `(betId, version)`; claves de libro
  `bet:{betId}:payout:v{n}`, `bet:{betId}:refund:v{n}`, `bet:{betId}:reversal:v{n}`. Repetir el
  evento choca con la fila existente y no repite efecto.
- **Razón**: constitución V exige cola persistente; BullMQ ya está decidido en `PLAN.md`.
- **Alternativas**: Redis pub/sub puro (pierde mensajes si nadie escucha); tabla outbox con cron
  (más latencia que el objetivo de 5 s).

## R7. Re-liquidación por corrección y saldo adeudado

- **Decisión**: un evento `RESULT_CORRECTED` sube la versión del mercado. Para cada apuesta afectada
  ya liquidada: asiento de reversión de la versión anterior (débito del pago o del reembolso) y
  nueva liquidación con versión `n+1`, en una transacción. Si el saldo no alcanza para la reversión,
  se debita lo disponible y el resto se registra en `BetDebt` (abierta). Mientras haya deuda
  abierta, `BetsService.place()` y `WithdrawalsService.request()` (spec 2, cambio de una línea vía
  `DebtGuard`) rechazan con `DEBT_OUTSTANDING`. Un job cada minuto cobra deudas con el saldo real
  disponible (`debt:{id}:collect:{n}`) y se genera una alerta de fraude `RESETTLEMENT_DEBT`.
- **Razón**: FR-019/FR-020 sin saldo negativo, que el libro de la spec 2 prohíbe.
- **Alternativas**: permitir saldo negativo (rompe el contrato de la spec 2); bloquear la
  re-liquidación hasta que el usuario tenga saldo (deja apuestas en estado incorrecto).

## R8. Suspensiones y aplazamientos

- **Decisión**: al recibir `MATCH_STATUS_CHANGED` a `SUSPENDED` o `POSTPONED`, se crea/actualiza
  `MatchHold` con `deadline = scheduledStart + suspensionWindowMs` (48 h). Un cron (`@nestjs/schedule`,
  cada minuto) anula los mercados no resueltos de los holds vencidos. `CANCELLED` anula al instante.
  Reanudar (`LIVE`/`SCHEDULED`) antes del plazo cierra el hold. Anular = marcar selecciones como
  `VOID` y re-evaluar cada apuesta: simple → reembolso; combinada → cuota 1.00 en esa selección.
- **Razón**: las reglas temporales con reloj del servidor (constitución III); el cron es la
  solución más simple y es idempotente porque reutiliza la misma liquidación de R6.

## R9. Tiempo real

- **Decisión**: gateway Socket.IO (`@nestjs/websockets` + `@nestjs/platform-socket.io`) en el
  namespace `/live`. Autenticación en el handshake con la cookie `access_token` (misma verificación
  que `AuthGuard`, extraída a `SessionVerifier`). Cada socket entra a la sala `user:{id}`. Tras el
  commit de cada liquidación se emite `bet.updated` y `wallet.updated`. La web pasa por el proxy
  `/api` de Next.js en desarrollo; en producción se conecta al dominio de la API con
  `withCredentials`.
- **Razón**: FR-017 y ≤ 5 s; solo el dueño recibe sus eventos.
- **Alternativas**: SSE (más simple, pero `PLAN.md` decidió Socket.IO y la spec 3 lo usará para
  marcadores); adaptador Redis de Socket.IO (innecesario con una sola instancia; ver Complexity).

## R10. Cupones y bonos

- **Decisión**:
  - `Coupon` + `CouponRedemption`. Canje en transacción con `SELECT … FOR UPDATE` sobre el cupón
    (cupo total exacto con concurrencia) y restricciones únicas `(couponId, userId)`,
    `(couponId, deviceId)` y `(couponId, payerKey)` (FR-031).
  - **Dispositivo**: cookie httpOnly `device_id` (UUID, 2 años) que la API pone en la primera
    petición; se guarda en el canje y en las apuestas.
  - **Método de pago**: `payerKey` = hash del documento y teléfono del pagador del último depósito
    acreditado (datos de la spec 2). Sin depósitos, `payerKey` es nulo y no aplica esa restricción.
  - **Bono de depósito**: el canje queda `AWAITING_DEPOSIT`; un job cada minuto busca el primer
    depósito acreditado posterior al canje y acredita el bono (`bonus:{redemptionId}:grant`). Así no
    se modifica la confirmación de depósitos de la spec 2.
  - **Apuesta gratis**: crea un `FreeBet` (monto fijo, vence con el cupón). La apuesta gratis no
    debita; si gana, se acredita la ganancia neta al saldo de bono y se crea un `Bonus` con rollover.
  - **Aumento de cuota**: se aplica a una sola apuesta; la cuota aumentada se congela.
  - **Rollover**: un solo `Bonus` activo por usuario. El avance suma el monto de apuestas pagadas
    con saldo de bono, liquidadas (no anuladas), con cuota total ≥ 1.50. Al llegar al requisito y sin
    apuestas de bono pendientes, todo el saldo de bono pasa a real (`BONUS_CONVERSION`). Al vencer y
    sin apuestas de bono pendientes, el saldo de bono restante vuelve a la casa (`BONUS_EXPIRY`).
- **Razón**: cumple FR-026 a FR-033 con el mínimo de estados, sin tocar la spec 2 salvo el guard de
  deuda.
- **Alternativas**: huella de navegador (frágil y discutible en privacidad); evento síncrono desde
  la confirmación de depósito (acopla las specs).

## R11. Detección de fraude

- **Decisión**: `FraudService` con reglas puras y configurables, ejecutadas por la cola
  `fraud-checks` (tras aceptar apuesta, canjear cupón) y por un cron (retiros, cuentas múltiples).
  Reglas iniciales:

  | Regla | Señal | Severidad |
  |-------|-------|-----------|
  | `MULTI_ACCOUNT` | ≥ 3 cuentas comparten `deviceId`, IP de sesión (7 días) o `payerKey` | Alta |
  | `ANOMALOUS_STAKE` | monto > 5× promedio de las últimas 20 apuestas y > 50.00 USD | Media |
  | `ODDS_DROP_PATTERN` | ≥ 3 apuestas en 30 días seguidas de una caída de cuota ≥ 15 % en 10 min | Media |
  | `MIRROR_BETS` | cuentas relacionadas apuestan la misma selección en ≤ 5 min | Alta |
  | `WITHDRAWAL_NO_ACTIVITY` | retiro solicitado tras un depósito sin apuestas intermedias | Media |
  | `RESETTLEMENT_DEBT` | deuda creada por re-liquidación (R7) | Alta |

  Deduplicación: una alerta abierta por `(rule, subjectKey)`. El historial de cuotas para
  `ODDS_DROP_PATTERN` lo da `MatchCatalogPort.oddsHistory()`.
- **Razón**: FR-034 a FR-038; las reglas puras se prueban con datos sintéticos (SC-009).

## R12. Configuración

- **Decisión**: tabla `BettingSetting` (clave → valor JSON, con valores por defecto en código).
  Lectura cacheada 10 s en memoria; cambios solo por operador o administrador y auditados con valor
  anterior y nuevo (FR-039).
- **Alternativas**: variables de entorno (requieren redeploy y no se auditan).

## R13. Pruebas

- Unitarias (Jest): cálculo de pagos y combinadas, reglas de liquidación, reglas de fraude, rollover;
  con `InMemoryWalletService` y `SimulatedCatalog`.
- Integración (`test/*.e2e-spec.ts`, PostgreSQL + Redis reales): concurrencia (100 apuestas
  simultáneas, 150 canjes con cupo 100), idempotencia (10 repeticiones de cada evento), abuso
  (sin saldo, tras el inicio, cuota alterada, cupón reutilizado), caída del worker.
- Contrato: la suite `wallet-contract.ts` de la spec 2 sigue pasando; nueva suite
  `catalog-contract.ts` que la spec 3 deberá pasar.
- E2E (Playwright): apostar y ver la liquidación en vivo sin recargar; medición de latencia
  (SC-004).
- CI: añadir el servicio Redis al job de pruebas de la API.
