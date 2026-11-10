# Plan de trabajo y roadmap

Sistema web de apuestas deportivas — proyecto académico (UTPL).
Requisitos: [`promtp.md`](promtp.md). Guía técnica: [`CLAUDE.md`](CLAUDE.md).

## 1. Enfoque

- **Seguridad primero**: el dinero (ledger, billetera, pagos) se construye y se prueba antes que las apuestas, y las apuestas antes que la UI pulida.
- **Entregas verticales**: cada fase termina con algo desplegado en staging y demostrable de punta a punta.
- **Sprints de 2 semanas**. Cada historia es una rama `feature/*` desde `develop` y entra por Pull Request con CI en verde y quality gate de SonarQube aprobado.
- Las fechas son una propuesta y se ajustan al calendario académico.

## 2. Decisiones técnicas base

| Tema | Decisión |
|------|----------|
| Monorepo | pnpm workspaces + Turborepo (`apps/web`, `apps/api`, `apps/reports`, `packages/shared`) |
| Frontend | Next.js (App Router, TypeScript) en Vercel |
| API | NestJS (TypeScript) en Render |
| ORM / migraciones | Prisma sobre PostgreSQL (con `SELECT … FOR UPDATE` en transacciones de billetera) |
| Tiempo real | Gateway WebSocket de NestJS (Socket.IO) + Redis pub/sub |
| Colas / jobs | BullMQ sobre Redis (sincronización API-Football, liquidación) |
| Reportes | Python 3.12 + FastAPI + pandas, gestionado con `uv` |
| Autenticación | JWT de corta duración en cookie httpOnly + refresh rotativo, 2FA TOTP |
| Pruebas | Jest + Supertest (API), Testing Library (web), Playwright (E2E), pytest (reportes) |
| Calidad | SonarQube Cloud (gratis para repos públicos) con quality gate bloqueante |
| CI/CD | GitHub Actions; deploy a Vercel y Render por rama |
| Trazabilidad del equipo | Grafana Cloud con datasource de GitHub (commits, PRs, despliegues, métricas DORA) |

## 3. Roadmap

```
Sprint     S0      S1      S2      S3      S4      S5      S6      S7
Semana   16-nov  30-nov  14-dic  11-ene  25-ene  08-feb  22-feb  08-mar
         ├───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┤
F0 Base  ███████
F1 Auth          ███████
F2 Dinero                ███████
F3 Partidos                      ███████
F4 Apuestas                              ███████
F5 Tiempo real                                   ███████
F6 Promos+Retiros                                        ███████
F7 Reportes+Cierre                                               ███████
                                                          v0.9 RC   v1.0
```

(Se omite la semana del 28-dic al 10-ene por vacaciones.)

| Hito | Fecha estimada | Contenido |
|------|---------------|-----------|
| **v0.1** | 29-nov-2026 | Infraestructura, CI/CD y despliegue "hola mundo" de las tres apps |
| **v0.3** | 27-dic-2026 | Usuarios, billetera y depósitos con Payphone sandbox |
| **v0.5** | 07-feb-2027 | Partidos y apuestas simples/combinadas |
| **v0.7** | 21-feb-2027 | Resultados y liquidación en tiempo real, suspensiones |
| **v0.9 RC** | 07-mar-2027 | Promociones, cupones y retiros completos |
| **v1.0** | 21-mar-2027 | Reportes, endurecimiento de seguridad, documentación y defensa |

## 4. Fases

### F0 — Fundaciones (S0)
- [ ] Git Flow: ramas `main` y `develop` protegidas (PR obligatorio, CI requerido).
- [ ] Monorepo con pnpm + Turborepo, ESLint, Prettier, TypeScript estricto, Ruff para Python.
- [ ] Commitlint + Husky para Conventional Commits.
- [ ] Esqueleto de `apps/web`, `apps/api` (con `/health`) y `apps/reports` (con `/health`).
- [ ] Docker Compose local con PostgreSQL y Redis.
- [ ] GitHub Actions: lint → tipos → tests → SonarQube → deploy.
- [ ] Proyectos en Vercel y Render (staging desde `develop`, producción desde `main`).
- [ ] Grafana Cloud con dashboard de trazabilidad del equipo.
- [ ] Plantillas de issue y PR; tablero de proyecto en GitHub.

**Criterio de cierre**: un PR a `develop` despliega automáticamente las tres apps en staging.

### F1 — Identidad y acceso (S1)
- [ ] Registro con verificación de correo y declaración de mayoría de edad.
- [ ] Login con JWT en cookie httpOnly y refresh rotativo; hash de contraseñas con Argon2.
- [ ] 2FA TOTP (obligatorio para retiros).
- [ ] RBAC: apostador, operador, administrador.
- [ ] Rate limiting, bloqueo por intentos fallidos y CAPTCHA en registro/login.
- [ ] Módulo de auditoría (tabla append-only) usado desde aquí en adelante.

**Criterio de cierre**: pruebas de autorización por rol en cada endpoint; intento de fuerza bruta bloqueado.

### F2 — Billetera, ledger y depósitos (S2)
- [ ] Modelo de ledger de doble entrada (cuentas: usuario-real, usuario-bono, casa, pasarela).
- [ ] Saldo derivado del ledger; ninguna ruta actualiza saldos directamente.
- [ ] Servicio de billetera con transacción + bloqueo de fila y claves de idempotencia.
- [ ] Integración Payphone sandbox: intención de pago → pasarela → confirmación servidor a servidor → asiento en ledger.
- [ ] Validación de monto, moneda y referencia contra la intención registrada.
- [ ] UI: depositar y ver movimientos.

**Criterio de cierre**: pruebas de concurrencia (N depósitos/débitos simultáneos dejan el saldo exacto) y de doble confirmación (se acredita una sola vez).

### F3 — Partidos y mercados (S3)
- [ ] Modelo de competición, partido, mercado, selección y cuota.
- [ ] Máquina de estados del partido: `programado → en_vivo → finalizado`, `suspendido`, `aplazado`, `cancelado`.
- [ ] Worker BullMQ de sincronización con API-Football, con presupuesto de peticiones diario y frecuencia adaptativa (alta solo en vivo).
- [ ] CRUD de operador para partidos, mercados y cuotas manuales.
- [ ] UI: cartelera de partidos y detalle de mercados.

**Criterio de cierre**: los partidos del día se importan solos sin superar la cuota del plan de API-Football.

### F4 — Apuestas (S4)
- [ ] Boleto de apuesta (bet slip) simple y combinada.
- [ ] Aceptación atómica: validar saldo + descontar + registrar apuesta en una sola transacción.
- [ ] Cuota congelada al aceptar; reconfirmación si cambió.
- [ ] Cierre de mercados al inicio del partido; retardo configurable para apuestas en vivo.
- [ ] Límites de monto por apuesta, por usuario y de ganancia máxima.
- [ ] UI: boleto de apuesta e historial.

**Criterio de cierre**: imposible apostar sin saldo, después del inicio o con una cuota distinta a la mostrada (pruebas E2E con Playwright).

### F5 — Tiempo real y liquidación (S5)
- [ ] Evento "partido finalizado" → job de liquidación idempotente → asientos en ledger.
- [ ] Gateway WebSocket: marcadores en vivo y resultado de apuestas del usuario sin recargar.
- [ ] Re-liquidación controlada ante corrección de resultado, con auditoría.
- [ ] Suspensiones y aplazamientos: plazo configurable, anulación y reembolso; selección anulada = cuota 1.00 en combinadas.
- [ ] Medición de latencia resultado → usuario (objetivo ≤ 5 s).

**Criterio de cierre**: reprocesar el mismo resultado no cambia saldos; un partido aplazado fuera de plazo reembolsa todas sus apuestas.

### F6 — Promociones, cupones y retiros (S6)
- [ ] Cupones: bono de depósito, apuesta gratis, aumento de cuota; vigencia, cupo total y límite por usuario.
- [ ] Rollover antes de convertir saldo de bono en saldo real.
- [ ] Anti-abuso: un cupón por usuario/dispositivo/método de pago.
- [ ] Retiros: 2FA, solo al titular del depósito, revisión manual sobre umbral. Si Payphone sandbox no admite pagos salientes, retiro simulado aprobado por administrador.
- [ ] Reglas de detección de fraude (cuentas múltiples, apuestas anómalas, retiro inmediato tras depósito) con alertas.

**Criterio de cierre**: pruebas de abuso de cupones y de retiro sin 2FA o a otro titular rechazados.

### F7 — Reportes, endurecimiento y cierre (S7)
- [ ] Servicio Python con usuario de BD de solo lectura y validación del token de administrador.
- [ ] Dashboard: volumen apostado, GGR, pagos, depósitos/retiros, usuarios activos, cupones, alertas de fraude; filtros y exportación CSV/PDF.
- [ ] Revisión OWASP Top 10 y análisis de dependencias; cero vulnerabilidades críticas en SonarQube.
- [ ] Accesibilidad WCAG 2.1 AA y revisión responsiva desde 360 px.
- [ ] Datos de demostración (seed) y guion de demo.
- [ ] Documentación final: arquitectura, manual de usuario y de despliegue.
- [ ] `release/1.0` → `main`, tag `v1.0.0`.

**Criterio de cierre**: release en producción y defensa del proyecto.

## 5. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Cuota baja del plan gratuito de API-Football | Un único worker con presupuesto diario, caché en Redis y modo de simulación de partidos para la demo |
| Las cuotas en vivo pueden no estar en el plan gratuito | Cuotas pre-partido de la API + cuotas manuales del operador |
| Payphone sandbox sin pagos salientes | Retiro simulado aprobado por administrador (registrado igual en el ledger) |
| Servicios gratuitos de Render se duermen | Precalentar antes de la demo o usar plan pago durante la defensa |
| Errores de concurrencia en dinero | Pruebas de concurrencia obligatorias en F2 y F4 antes de avanzar |

## 6. Definición de terminado

Una historia está terminada cuando:
- Está en `develop` vía PR revisado, con commits atómicos y Conventional Commits.
- CI en verde y quality gate de SonarQube aprobado.
- Tiene pruebas de los casos de fraude relevantes (no solo del camino feliz).
- Está desplegada en staging y verificada.
