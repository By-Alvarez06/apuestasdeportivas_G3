# Catálogo de specs

Listado de especificaciones previstas (Spec Kit), en orden de construcción. Cada spec se crea con
`/speckit-specify` en una rama `feature/NNN-nombre` y su carpeta vive en `specs/NNN-nombre/`.

Fuente: fases de [`PLAN.md`](../PLAN.md). Reglas: [constitución](../.specify/memory/constitution.md).

| # | Spec | Fase | Alcance | Estado |
|---|------|------|---------|--------|
| 001 | `001-fundaciones-monorepo` | F0 | Monorepo con las tres apps, CI/CD, SonarQube, despliegues Vercel/Render y Grafana | Pendiente |
| 002 | `002-autenticacion-roles` | F1 | Registro, login, 2FA, roles (RBAC), bloqueo por intentos fallidos y auditoría | Pendiente |
| 003 | `003-billetera-ledger` | F2 | Ledger de doble entrada, saldo real y de bono, bloqueo de concurrencia | Pendiente |
| 004 | `004-depositos-payphone` | F2 | Depósitos con Payphone sandbox y confirmación servidor a servidor | Pendiente |
| 005 | `005-partidos-mercados` | F3 | Partidos, máquina de estados, mercados y cuotas, gestión del operador | Pendiente |
| 006 | `006-sincronizacion-api-football` | F3 | Worker de API-Football con presupuesto diario y frecuencia adaptativa | Pendiente |
| 007 | `007-apuestas-simples-combinadas` | F4 | Boleto de apuesta, aceptación atómica, cuota congelada, límites | Pendiente |
| 008 | `008-liquidacion-tiempo-real` | F5 | Liquidación idempotente, WebSocket, objetivo ≤ 5 s, re-liquidación auditada | Pendiente |
| 009 | `009-suspensiones-aplazamientos` | F5 | Plazo de reanudación, anulación y reembolso, cuota 1.00 en combinadas | Pendiente |
| 010 | `010-promociones-cupones` | F6 | Cupones, rollover y controles anti-abuso | Pendiente |
| 011 | `011-retiros` | F6 | Retiros con 2FA, solo al mismo titular y revisión manual | Pendiente |
| 012 | `012-deteccion-fraude` | F6 | Reglas de detección (cuentas múltiples, apuestas anómalas) y alertas | Pendiente |
| 013 | `013-reportes-dashboard` | F7 | Servicio de reportes en Python, dashboard y exportación CSV/PDF | Pendiente |

Al crear o cerrar una spec, actualiza su fila (Pendiente → En curso → Terminada).
