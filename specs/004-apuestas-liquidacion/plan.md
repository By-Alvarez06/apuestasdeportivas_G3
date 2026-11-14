# Implementation Plan: Apuestas y liquidación

**Branch**: `feature/spec-4` | **Date**: 2026-11-13 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-apuestas-liquidacion/spec.md`

## Summary

Apuestas simples y combinadas aceptadas de forma atómica sobre la billetera real de la spec 2
(ya en `develop`), con cuota congelada, límites configurables y retardo en vivo; liquidación
automática e idempotente consumiendo una cola BullMQ de eventos de resultado, con aviso por
Socket.IO en ≤ 5 s; reglas de suspensión, aplazamiento, cancelación y re-liquidación con saldo
adeudado; cupones (bono de depósito, apuesta gratis, aumento de cuota) con rollover; y reglas de
detección de fraude con alertas para el administrador. La spec 3 se sustituye con
`SimulatedCatalogModule`, que cumple el contrato [match-catalog.md](contracts/match-catalog.md).
Detalle de decisiones en [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js 22
**Primary Dependencies**: NestJS 11, Prisma 7 (de la spec 2), `@nestjs/bullmq` + `bullmq`,
`@nestjs/websockets` + `@nestjs/platform-socket.io` + `socket.io`; en web, Next.js 15 +
`socket.io-client`
**Storage**: PostgreSQL 16 (apuestas, liquidaciones, cupones, alertas), Redis 7 (colas BullMQ)
**Testing**: Jest + Supertest contra PostgreSQL y Redis reales; Jest unitario con
`InMemoryWalletService` y catálogo simulado; Playwright para E2E web
**Target Platform**: Render (API + worker en el mismo proceso), Vercel (web)
**Project Type**: aplicación web (monorepo `apps/api` + `apps/web` + `packages/shared`)
**Performance Goals**: resultado → pantalla del apostador p95 ≤ 5 s (SC-004); 100 apuestas
simultáneas sobre una billetera sin error de saldo (SC-002)
**Constraints**: centavos y centésimas enteros; sin saldo negativo; todo dinero vía `WalletService`;
sin claves foráneas a la spec 3
**Scale/Scope**: proyecto académico, cientos de usuarios y apuestas por partido; 6 historias,
~25 endpoints, ~8 pantallas

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Seguridad y antifraude**: tabla de vectores en la spec; cada endpoint con `@Roles`
  (denegado por defecto, guard global de la spec 2); endpoints `/dev/catalog/*` deshabilitados en
  producción; auditoría de todas las acciones de http-api.md; reglas de fraude con alertas; sin
  secretos nuevos.
- [x] **II. Integridad financiera**: todo movimiento por `WalletService` con clave idempotente y
  `tx` compartida (apuesta + débito atómicos con `FOR UPDATE`); reversiones con asientos
  compensatorios; `Bet`, `BetSelection`, `BetSettlement` y `MatchEvent` protegidos por triggers;
  saldo adeudado en vez de saldo negativo.
- [x] **III. Servidor como autoridad**: el cliente envía selección, cuota vista y monto; el servidor
  relee cuota, estado y hora de inicio del catálogo, recalcula el pago y aplica límites con su
  reloj.
- [x] **IV. Pruebas primero**: cada historia empieza con pruebas que fallan: concurrencia (SC-002,
  cupo de cupones), idempotencia (SC-005), abuso (SC-003, SC-008) y caída del worker (SC-007).
- [x] **V. Tiempo real**: cola persistente BullMQ + tabla `MatchEvent`; Socket.IO por usuario;
  medición de latencia; correcciones re-liquidadas y auditadas; reglas de suspensión de la
  constitución. La cuota de API-Football es responsabilidad de la spec 3.
- [x] **VI. Simplicidad**: sin servicios nuevos; el worker vive en `apps/api`. Una sola instancia:
  sin adaptador Redis para Socket.IO (ver Complexity Tracking).
- [x] **VII. UX**: pantallas mobile-first desde 360 px, WCAG 2.1 AA (anuncios `aria-live` para
  cambios en vivo), textos con la acción ("Confirmar apuesta de 10.00 USD"); skill
  `frontend-design`.

**Re-check post-diseño**: sin cambios. El modelo de datos mantiene las compuertas I–III; el contrato
de catálogo no introduce un cuarto servicio.

## Project Structure

### Documentation (this feature)

```text
specs/004-apuestas-liquidacion/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── http-api.md
│   ├── match-catalog.md
│   └── realtime.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
apps/api/
├── prisma/
│   ├── schema.prisma            # + modelos de data-model.md
│   └── migrations/              # + spec4_bets, triggers de inmutabilidad, índices parciales
├── src/
│   ├── catalog/
│   │   ├── match-catalog.port.ts        # MatchCatalogPort, tipos de eventos, token MATCH_CATALOG
│   │   ├── catalog.controller.ts        # GET /catalog/matches (provisional)
│   │   ├── simulated/                   # SimulatedCatalogModule, fixtures.json, /dev/catalog/*
│   │   └── testing/catalog-contract.ts  # suite que la spec 3 deberá pasar
│   ├── betting/
│   │   ├── odds.ts                      # cálculo exacto de cuotas y pagos (BigInt)
│   │   ├── settings.service.ts          # BettingSetting con caché y auditoría
│   │   ├── bets.service.ts              # aceptación atómica, límites, retardo en vivo
│   │   ├── bets.controller.ts
│   │   └── operator.controller.ts       # ajustes, holds, apuestas por partido
│   ├── settlement/
│   │   ├── settlement.processor.ts      # worker de la cola match-events
│   │   ├── settlement.service.ts        # liquidar, anular, re-liquidar (idempotente)
│   │   ├── bet-outcome.ts               # reglas puras: simple, combinada, cuota 1.00
│   │   ├── holds.service.ts             # MatchHold + cron de plazos
│   │   └── debt.service.ts              # BetDebt, DebtGuard, cobro periódico
│   ├── realtime/
│   │   ├── session-verifier.ts          # extraído de AuthGuard, compartido con el gateway
│   │   ├── live.gateway.ts              # namespace /live, sala user:{id}
│   │   └── notifier.service.ts
│   ├── promotions/
│   │   ├── coupons.service.ts           # crear, pausar, canjear (FOR UPDATE + únicos)
│   │   ├── bonus.service.ts             # concesión, rollover, conversión, caducidad (cron)
│   │   ├── device-id.middleware.ts      # cookie device_id
│   │   └── *.controller.ts
│   └── fraud/
│       ├── rules/                       # una regla pura por archivo
│       ├── fraud.processor.ts           # cola fraud-checks + cron
│       ├── fraud.service.ts
│       └── fraud-admin.controller.ts
└── test/                                # bets*, settlement*, suspensions*, coupons*, fraud* .e2e-spec.ts

apps/web/src/
├── app/
│   ├── apuestas/                # catálogo provisional + boleto (simple/combinada)
│   ├── mis-apuestas/            # historial con actualización en vivo
│   ├── promociones/             # canjear cupón, bono y rollover, apuestas gratis
│   ├── operador/                # cupones, ajustes, partidos en espera
│   └── admin/fraude/            # alertas
├── components/BetSlip.tsx, LiveProvider.tsx
└── lib/live.ts                  # cliente socket.io con reconexión y refresh

packages/shared/src/             # BetStatus, StakeSource, CouponType, ErrorCode nuevos, odds a string
```

**Structure Decision**: módulos Nest por dominio dentro de `apps/api/src`, igual que la spec 2. El
catálogo simulado vive aislado en `src/catalog/simulated` para borrarlo cuando llegue la spec 3. La
web añade rutas y reutiliza `AppShell` y `lib/api.ts` de la spec 2.

## Cambios de infraestructura

- Dependencias API: `@nestjs/bullmq`, `bullmq`, `@nestjs/websockets`, `@nestjs/platform-socket.io`,
  `socket.io` (verificar que las versiones carguen en Jest como CommonJS, igual que en la spec 2).
  Web: `socket.io-client`.
- `.env.example`: `REDIS_URL` ya existe; añadir `CATALOG_MODE=simulated`.
- `.github/workflows/ci.yml`: servicio Redis en el job de pruebas de la API.
- `apps/web/next.config.ts`: proxy de `/socket.io` hacia la API en desarrollo.
- Spec 2: `WithdrawalsService.request()` llama a `DebtGuard`; `AuthGuard` delega en
  `SessionVerifier` (refactor sin cambio de comportamiento, cubierto por sus pruebas).
- `packages/shared/src/types.ts`: el `BetStatus` actual (`pending`, `cashout`…) se reemplaza por el
  de esta spec; nadie lo usa todavía.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Catálogo simulado con endpoints `/dev/*` | La spec 3 no existe y hay que demostrar y probar apuestas de punta a punta | Esperar a la spec 3 bloquearía la spec 4; crear las tablas reales invadiría su alcance |
| Socket.IO sin adaptador Redis | — (simplificación) | Con una sola instancia en Render basta la memoria del proceso; si se escala a varias instancias, añadir `@socket.io/redis-adapter` |
