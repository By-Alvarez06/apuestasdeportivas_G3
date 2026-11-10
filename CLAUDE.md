# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estado del proyecto

Proyecto académico (UTPL) en fase inicial: todavía no hay código. La especificación completa está en `promtp.md` y es la fuente de verdad de requisitos; léela antes de implementar cualquier funcionalidad. El orden de construcción, las decisiones técnicas base y los criterios de cierre de cada fase están en `PLAN.md`. Cuando se creen los `package.json` / `pyproject.toml`, añade aquí los comandos reales de build, lint y tests (incluido cómo ejecutar un solo test).

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
