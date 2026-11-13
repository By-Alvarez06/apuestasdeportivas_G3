# Catálogo de specs

Cuatro specs, una por integrante, en orden de construcción. Cada spec se desarrolla con SDD (Spec
Kit: `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`) en su rama
`feature/spec-N`, y su carpeta vive en `specs/00N-nombre/`.

Fuente: fases de [`PLAN.md`](../PLAN.md). Reglas: [constitución](../.specify/memory/constitution.md).

| # | Rama | Carpeta | Responsable | Alcance | Depende de | Estado |
|---|------|---------|-------------|---------|------------|--------|
| 1 | `feature/spec-1` | `specs/001-fundaciones-monorepo` | Líder | Monorepo con las tres apps (web, api, reports), paquete compartido, Docker (PostgreSQL + Redis), CI, convenciones de commits | — | Terminada |
| 2 | `feature/spec-2` | `specs/002-cuentas-billetera` | — | Registro, login, 2FA, roles (RBAC), bloqueo por intentos fallidos, auditoría; ledger de doble entrada con saldo real y de bono; depósitos con Payphone sandbox (confirmación servidor a servidor); retiros con 2FA, mismo titular y revisión manual | 1 | Pendiente |
| 3 | `feature/spec-3` | `specs/003-partidos-mercados` | — | Partidos y máquina de estados, mercados y cuotas, gestión del operador; worker de API-Football con presupuesto diario y frecuencia adaptativa; servicio de reportes en Python con dashboard y exportación CSV/PDF | 1 | Pendiente |
| 4 | `feature/spec-4` | `specs/004-apuestas-liquidacion` | — | Apuestas simples y combinadas (aceptación atómica, cuota congelada, límites); liquidación idempotente en tiempo real por WebSocket; suspensiones y aplazamientos (reembolso, cuota 1.00 en combinadas); promociones y cupones; detección de fraude | 2, 3 | Pendiente |

Specs 2 y 3 pueden avanzar en paralelo. La spec 4 necesita la billetera (2) y los partidos y
mercados (3); mientras no estén integradas, trabaja contra interfaces simuladas.

## Origen

Las cuatro specs agrupan el catálogo original de 13:

| Spec | Specs originales |
|------|------------------|
| 1 | 001 fundaciones-monorepo |
| 2 | 002 autenticación-roles, 003 billetera-ledger, 004 depósitos-payphone, 011 retiros |
| 3 | 005 partidos-mercados, 006 sincronización-api-football, 013 reportes-dashboard |
| 4 | 007 apuestas-simples-combinadas, 008 liquidación-tiempo-real, 009 suspensiones-aplazamientos, 010 promociones-cupones, 012 detección-fraude |

Al crear o cerrar una spec, actualiza su fila (Pendiente → En curso → Terminada) y el responsable.
