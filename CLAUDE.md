# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estado del proyecto

Proyecto académico (UTPL). La especificación completa está en `promtp.md` y es la fuente de verdad de requisitos; léela antes de implementar cualquier funcionalidad. Los principios no negociables del proyecto están en `.specify/memory/constitution.md` (Spec Kit) y prevalecen sobre este archivo. El orden de construcción, las decisiones técnicas base y los criterios de cierre de cada fase están en `PLAN.md`. Las specs y su reparto están en `specs/README.md`; cada spec vive en `specs/00N-nombre/`.

## Comandos

Requisitos: Node 22 (Prisma no soporta Node 26), pnpm, Docker. El `.env` vive en la raíz (copia `.env.example`).

```bash
pnpm install                                   # también genera el cliente de Prisma (postinstall)
pnpm db:up                                     # PostgreSQL, Redis y Mailpit; si el 5432 está ocupado: POSTGRES_PORT=5434 pnpm db:up
pnpm --filter @apuestas/api db:migrate         # migraciones en la base de desarrollo
pnpm --filter @apuestas/api db:seed            # cuentas del sistema y primer administrador (ADMIN_EMAIL/ADMIN_PASSWORD)
pnpm dev                                       # api :3001, web :3000 (la web llega a la API por el proxy /api)

pnpm lint && pnpm typecheck && pnpm format:check
pnpm --filter @apuestas/api test               # unitarias (src/**/*.spec.ts)
pnpm --filter @apuestas/api test:e2e           # integración contra apuestas_test (TEST_DATABASE_URL)
pnpm --filter @apuestas/api test:e2e -- wallet # un solo archivo: patrón del nombre
pnpm --filter @apuestas/api test:e2e -- -t "texto del it"   # una sola prueba
pnpm --filter @apuestas/web test:e2e           # Playwright contra la pila local (E2E_BASE_URL si la web no está en :3000)
```

Notas que no se deducen del código:

- Las pruebas de integración usan dobles sin red para correo, Turnstile, HIBP y Payphone (`apps/api/test/fakes.ts`); la E2E de depósito levanta un Payphone simulado (`apps/web/e2e/payphone-mock.ts`).
- `@nestjs/config`, `@nestjs/jwt`, `@nestjs/schedule` y `otplib` están fijados en versiones CommonJS: las siguientes son solo ESM y Jest no las carga.
- Todo movimiento de dinero pasa por `WalletService` (`apps/api/src/wallet`, contrato en `specs/002-cuentas-billetera/contracts/wallet-service.md`); ningún otro módulo escribe en las tablas del libro contable.

## Arquitectura prevista

Monorepo con tres aplicaciones:

- `apps/web` — Next.js (TypeScript), desplegado en **Vercel**. Solo presentación: nunca calcula saldos, cuotas ni liquidaciones.
- `apps/api` — NestJS (TypeScript), desplegado en **Render**. Dueño de toda la lógica de dinero, apuestas y liquidación. Expone un gateway WebSocket para resultados en tiempo real.
- `apps/reports` — Python (FastAPI + pandas), desplegado en **Render**. Genera los reportes del dashboard leyendo PostgreSQL con un usuario de **solo lectura**; no escribe datos de negocio. Valida el mismo token de acceso que la API (solo rol administrador).

Infraestructura en Render: PostgreSQL + Redis (pub/sub y colas).

Flujo de resultados en vivo: un único worker en `apps/api` consulta **API-Football** (respetando la cuota de peticiones del plan; alta frecuencia solo para partidos en vivo) → publica en Redis → se liquidan las apuestas → se notifica a los clientes por WebSocket. El frontend nunca llama a API-Football ni ve su API key.

Pagos con **Payphone en modo sandbox**: el saldo solo se acredita cuando el backend confirma la transacción servidor a servidor con Payphone y verifica monto/moneda/referencia contra la intención de pago registrada. El redirect del navegador no acredita nada.

## Invariantes que no se deben romper

La seguridad antifraude es el criterio prioritario del proyecto. Al tocar dinero o apuestas:

- El saldo se deriva de un **ledger de doble entrada inmutable**; nunca se actualiza un saldo directamente ni se borran asientos (las correcciones son asientos compensatorios).
- Crear una apuesta = validar saldo + descontar + registrar apuesta en **una sola transacción** con bloqueo de fila de la billetera.
- La cuota se congela al aceptar la apuesta; no se aceptan apuestas pre-partido tras el inicio.
- Liquidación, confirmación de pagos y reembolsos son **idempotentes** (reprocesar un evento no paga dos veces).
- Partido suspendido/aplazado: se mantiene si se reanuda dentro del plazo configurado; si no, se anula y se reembolsa. En combinadas, la selección anulada cuenta con cuota 1.00.
- Toda acción sensible queda en el registro de auditoría.

## Flujo de trabajo

- **Git Flow**: `main`, `develop`, `feature/*`, `release/*`, `hotfix/*`. Nada se integra a `main` o `develop` sin Pull Request.
- **Commits atómicos y reversibles** con Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`…); cada commit debe compilar y pasar las pruebas.
- Pipeline CI (GitHub Actions): lint + tipos → tests (Jest / pytest) → SonarQube con quality gate bloqueante → deploy (`develop` → staging, `main` → producción).
- Grafana se usa para la trazabilidad del equipo de desarrollo (commits, PRs, despliegues, métricas DORA).
- No usar Java ni Rust.
- Para trabajo de UI, usar el skill `frontend-design` instalado en `.claude/skills/`.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/002-cuentas-billetera/plan.md`
<!-- SPECKIT END -->
