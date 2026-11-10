<!--
Sync Impact Report
- Versión: plantilla sin versionar → 1.0.0 (ratificación inicial)
- Principios definidos:
  I. Seguridad y antifraude primero (NO NEGOCIABLE)
  II. Integridad financiera (NO NEGOCIABLE)
  III. Servidor como única autoridad
  IV. Pruebas primero en dominios críticos
  V. Tiempo real confiable
  VI. Simplicidad y límites de servicio
  VII. Experiencia accesible y responsiva
- Secciones añadidas: Restricciones tecnológicas; Flujo de desarrollo y quality gates; Gobernanza
- Secciones eliminadas: ninguna
- Plantillas:
  ✅ .specify/templates/plan-template.md (Constitution Check con las compuertas de esta constitución)
  ✅ .specify/templates/spec-template.md (sin cambios necesarios: ya exige requisitos verificables)
  ✅ .specify/templates/tasks-template.md (sin cambios necesarios: la disciplina de pruebas se exige desde el plan)
  ✅ CLAUDE.md (referencia a la constitución)
- TODOs diferidos: ninguno
-->

# Constitución del Sistema de Apuestas Deportivas

## Core Principles

### I. Seguridad y antifraude primero (NO NEGOCIABLE)

La seguridad es el criterio que prevalece sobre rendimiento, comodidad y plazos.

- Toda funcionalidad que toque dinero, cuotas, apuestas, cupones o identidad DEBE identificar en su
  especificación los vectores de fraude o abuso que la afectan y cómo se mitigan.
- Cada endpoint DEBE aplicar autenticación y control de acceso por rol (apostador, operador,
  administrador); el acceso por defecto es denegado.
- Las acciones sensibles DEBEN quedar en un registro de auditoría append-only (quién, qué, cuándo,
  IP, dispositivo).
- Las credenciales de terceros (API-Football, Payphone, base de datos) DEBEN vivir solo en
  variables de entorno del backend; nunca en el frontend ni en el repositorio.
- Toda integración externa entrante DEBE verificarse en el servidor (confirmación servidor a
  servidor o firma) antes de producir efectos.
- El código DEBE cumplir OWASP Top 10; las vulnerabilidades críticas o altas bloquean la integración.

**Razón**: una plataforma de apuestas es un objetivo natural de fraude; un fallo de seguridad
invalida cualquier otra cualidad del sistema.

### II. Integridad financiera (NO NEGOCIABLE)

- Todo movimiento de dinero DEBE registrarse en un ledger de doble entrada inmutable; el saldo se
  deriva del ledger y NUNCA se actualiza ni se borra directamente. Las correcciones son asientos
  compensatorios.
- Saldo real y saldo de bonificación DEBEN mantenerse en cuentas separadas del ledger.
- Crear una apuesta DEBE validar saldo, descontarlo y registrar la apuesta en una sola transacción
  de base de datos con bloqueo de fila sobre la billetera.
- Depósitos, retiros, liquidaciones y reembolsos DEBEN ser idempotentes: reprocesar el mismo evento
  no produce un segundo efecto.
- Un depósito solo se acredita tras confirmar la transacción con Payphone desde el servidor y
  verificar monto, moneda y referencia contra la intención de pago registrada.
- Una apuesta aceptada no se modifica; solo se anula por regla de negocio, con auditoría.

**Razón**: los errores de dinero son irreversibles para la confianza del usuario y son el principal
vector de fraude (doble gasto, doble cobro, saldo inventado).

### III. Servidor como única autoridad

- El backend NestJS (`apps/api`) es la única fuente de verdad para saldos, cuotas, estados de
  partido, aceptación y liquidación de apuestas.
- El frontend (`apps/web`) solo presenta datos y envía intenciones; ningún valor calculado en el
  cliente (monto, cuota, ganancia, saldo) se acepta sin revalidarse en el servidor.
- La cuota se congela al aceptar la apuesta; si cambió respecto a la mostrada, el usuario DEBE
  reconfirmar.
- Las reglas temporales (cierre de mercado al inicio del partido, retardo de apuestas en vivo) se
  evalúan con el reloj del servidor.

**Razón**: el cliente está bajo control del usuario y no puede ser confiable.

### IV. Pruebas primero en dominios críticos

- Para ledger, billetera, pagos, apuestas, liquidación, suspensiones y cupones, las pruebas DEBEN
  escribirse antes que la implementación y fallar primero (Red-Green-Refactor).
- Además del camino feliz, DEBEN existir pruebas de:
  - concurrencia (operaciones simultáneas sobre la misma billetera dejan el saldo exacto);
  - idempotencia (eventos repetidos no duplican efectos);
  - abuso (apostar sin saldo, tras el inicio, con cuota alterada, cupón reutilizado, retiro sin 2FA
    o a otro titular).
- Cada historia de usuario DEBE tener al menos una prueba de integración o E2E de punta a punta.

**Razón**: en estos dominios un bug no es un defecto visual, es una pérdida de dinero o una puerta
al fraude.

### V. Tiempo real confiable

- El resultado de un partido DEBE reflejarse en las apuestas del usuario en ≤ 5 s desde que
  API-Football lo publica.
- Un único worker del backend consulta API-Football respetando la cuota del plan contratado; los
  clientes nunca consultan la API directamente.
- Los eventos de resultado DEBEN procesarse a través de una cola persistente (BullMQ/Redis) para que
  una caída no pierda resultados.
- Las correcciones de resultado se re-liquidan de forma controlada y auditada.
- Las reglas de partidos suspendidos y aplazados son las definidas en la especificación: se mantiene
  si se reanuda en plazo; si no, se anula y se reembolsa; en combinadas la selección anulada cuenta
  con cuota 1.00.

**Razón**: el valor percibido del sistema depende de conocer el resultado al instante, pero nunca a
costa de liquidar mal.

### VI. Simplicidad y límites de servicio

- El sistema se compone de exactamente tres aplicaciones: `apps/web`, `apps/api` y
  `apps/reports`. Añadir un servicio nuevo requiere enmendar esta constitución.
- El servicio de reportes en Python accede a la base de datos con un usuario de solo lectura y no
  escribe datos de negocio.
- Se prefiere la solución más simple que cumpla los principios I a V; cualquier complejidad extra
  DEBE justificarse en la tabla "Complexity Tracking" del plan.

**Razón**: un proyecto académico con plazo fijo necesita una arquitectura que el equipo pueda
entender, probar y defender.

### VII. Experiencia accesible y responsiva

- Toda interfaz DEBE ser mobile-first y usable desde 360 px de ancho.
- Toda interfaz DEBE cumplir WCAG 2.1 AA (contraste, foco visible por teclado, movimiento reducido).
- Los textos de la interfaz nombran las acciones por lo que hacen ("Confirmar apuesta", no
  "Enviar") y los errores explican qué pasó y cómo resolverlo.
- El trabajo de UI DEBE seguir el skill `frontend-design`.

**Razón**: "fácil de usar" y "responsivo" son requisitos explícitos del proyecto.

## Restricciones tecnológicas

- Frontend: Next.js (TypeScript) desplegado en Vercel.
- Backend: NestJS (TypeScript) desplegado en Render, con PostgreSQL y Redis en Render.
- Reportes: Python (FastAPI + pandas) desplegado en Render.
- Integraciones: API-Football (resultados y cuotas) y Payphone en modo sandbox (pagos).
- Prohibido usar Java o Rust.
- Proyecto académico: no se opera con dinero real; la pasarela se usa únicamente en sandbox.
- Monorepo con pnpm workspaces + Turborepo. Las decisiones técnicas de detalle viven en `PLAN.md`.

## Flujo de desarrollo y quality gates

- **Git Flow**: `main` (producción), `develop` (integración), `feature/*`, `release/*`, `hotfix/*`.
  Nada se integra a `main` ni a `develop` sin Pull Request revisado.
- Las features creadas con Spec Kit usan ramas `feature/NNN-nombre-corto` (p. ej.
  `feature/001-billetera-ledger`), y su especificación vive en `specs/NNN-nombre-corto/`.
- **Commits atómicos y reversibles** con Conventional Commits; cada commit compila y pasa las
  pruebas.
- Un PR solo se integra si:
  1. lint y verificación de tipos pasan;
  2. las pruebas (Jest, pytest, Playwright) pasan;
  3. el quality gate de SonarQube está aprobado;
  4. la revisión confirma el cumplimiento de esta constitución.
- `develop` despliega a staging y `main` a producción automáticamente.
- Grafana registra la trazabilidad del equipo (commits, PRs, despliegues, métricas DORA).

## Governance

- Esta constitución prevalece sobre cualquier otra guía del proyecto (`PLAN.md`, `CLAUDE.md`,
  convenciones de equipo). En caso de conflicto, se corrige el documento subordinado.
- Toda enmienda se hace mediante Pull Request que modifique este archivo, explique el motivo y
  actualice las plantillas de `.specify/templates/` afectadas.
- Versionado semántico:
  - MAJOR: se elimina o redefine un principio de forma incompatible;
  - MINOR: se añade un principio o sección, o se amplía materialmente una regla;
  - PATCH: aclaraciones y redacción sin cambio de significado.
- Cada plan (`/speckit-plan`) DEBE pasar el "Constitution Check" antes de la investigación y
  volver a verificarlo tras el diseño. Las violaciones solo se aceptan justificadas en
  "Complexity Tracking"; los principios I y II no admiten excepciones.
- La guía operativa para agentes de IA está en `CLAUDE.md`.

**Version**: 1.0.0 | **Ratified**: 2026-11-10 | **Last Amended**: 2026-11-10
