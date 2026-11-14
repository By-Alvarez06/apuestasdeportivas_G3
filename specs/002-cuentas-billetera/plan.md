# Implementation Plan: Cuentas y billetera

**Branch**: `feature/spec-2` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-cuentas-billetera/spec.md`

## Summary

Identidad (registro, verificación de correo, login con sesión rotativa, 2FA TOTP, RBAC, bloqueo por
intentos y auditoría inmutable) y dinero (libro contable de doble entrada con saldo real, de bono y
retenido; depósitos con Payphone sandbox confirmados servidor a servidor; retiros con 2FA, mismo
titular y aprobación manual). Todo vive en `apps/api` (NestJS + Prisma + PostgreSQL); `apps/web`
solo presenta formularios y saldos. `WalletService` queda como contrato para la spec 4.
Detalle de decisiones en [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js 22
**Primary Dependencies**: NestJS 11, Prisma, `@nestjs/jwt`, `@nestjs/throttler`, `argon2`, `otplib`,
`qrcode`, `nodemailer`, `class-validator`; Next.js 15 en web
**Storage**: PostgreSQL 16 (datos y libro contable), Redis 7 (rate limiting)
**Testing**: Jest + Supertest contra PostgreSQL real; Playwright para E2E web
**Target Platform**: Render (API), Vercel (web); local con `docker/docker-compose.yml`
**Project Type**: aplicación web (monorepo `apps/api` + `apps/web` + `packages/shared`)
**Performance Goals**: depósito confirmado visible en < 10 s (SC-008); 100 operaciones simultáneas
sobre una billetera sin error de saldo (SC-002)
**Constraints**: montos en centavos enteros; saldo siempre derivado del libro; sin dinero real
**Scale/Scope**: proyecto académico, decenas a cientos de usuarios; 5 historias, ~30 endpoints,
~10 pantallas

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Seguridad y antifraude**: vectores y mitigaciones en la spec; guard global de rol con
  acceso denegado por defecto; `AuditLog` inmutable; secretos (`JWT_SECRET`, `TOTP_ENC_KEY`,
  `PAYPHONE_TOKEN`, `TURNSTILE_SECRET`) solo en variables del backend; redirect de Payphone
  verificado con `Confirm` servidor a servidor.
- [x] **II. Integridad financiera**: libro de doble entrada con triggers de inmutabilidad; saldo por
  `SUM`; `FOR UPDATE` sobre `Wallet`; `idempotencyKey` único; depósito acreditado solo tras validar
  monto, moneda y referencia.
- [x] **III. Servidor como autoridad**: el cliente envía montos como intención; límites, saldo, edad
  y caducidades se validan con reloj y datos del servidor.
- [x] **IV. Pruebas primero**: las tareas de ledger, billetera, depósitos y retiros empiezan por
  pruebas que fallan: concurrencia (SC-002), idempotencia (SC-003) y abuso (SC-006, SC-007).
- [x] **V. Tiempo real**: no aplica a esta spec (sin resultados de partidos).
- [x] **VI. Simplicidad**: solo `apps/api`, `apps/web` y `packages/shared`. Mailpit es una
  herramienta de desarrollo en docker-compose, no un servicio de la aplicación.
- [x] **VII. UX**: pantallas mobile-first desde 360 px, WCAG 2.1 AA (Turnstile sin retos visuales),
  textos con la acción ("Depositar 20.00 USD"); UI con el skill `frontend-design`.

**Re-check post-diseño**: sin cambios; el modelo de datos y los contratos mantienen las compuertas.

## Project Structure

### Documentation (this feature)

```text
specs/002-cuentas-billetera/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── http-api.md
│   └── wallet-service.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
apps/api/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/          # incluye triggers de inmutabilidad
│   └── seed.ts              # cuentas del sistema + primer administrador
├── src/
│   ├── prisma/              # PrismaService
│   ├── common/              # guards (auth, roles), decoradores, filtro de errores, Idempotency-Key
│   ├── audit/               # AuditService (append-only)
│   ├── auth/                # registro, login, refresh, recuperación, 2FA, captcha, correo
│   ├── users/               # administración de usuarios y roles
│   ├── wallet/              # WalletService, LedgerService, endpoints de billetera
│   ├── deposits/            # intención de pago, PayphoneClient, confirmación, job de reconciliación
│   └── withdrawals/         # solicitud, retención, aprobación, pago simulado
└── test/                    # *.e2e-spec.ts: integración, concurrencia, idempotencia, abuso

apps/web/src/app/
├── (auth)/registro, ingresar, verificar-correo, recuperar
├── billetera/               # saldo, movimientos, depositar, retirar, depositos/[id]
├── cuenta/seguridad/        # 2FA
└── admin/                   # usuarios, retiros, auditoria

packages/shared/src/         # DTOs y enums compartidos (roles, estados, códigos de error)
```

**Structure Decision**: monorepo existente de la spec 1. La lógica vive en módulos de Nest por
dominio dentro de `apps/api/src`; `apps/web` llama a la API con `fetch` y cookies. Se reutilizan
`UserRole` y las constantes de `packages/shared`.

## Cambios de infraestructura

- `docker/docker-compose.yml`: añadir Mailpit (SMTP 1025, web 8025) y una base `apuestas_test`.
- `.env.example`: `TOTP_ENC_KEY`, `SMTP_URL`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`,
  `PAYPHONE_RESPONSE_URL`, `WITHDRAWAL_REVIEW_THRESHOLD_CENTS=20000`.
- `.github/workflows/ci.yml`: servicio PostgreSQL en el job `test-api` y paso `test:e2e`.
- `apps/api/src/main.ts`: cargar `.env`, `cookie-parser`, `ValidationPipe` global, y leer
  `API_PORT` (hoy lee `PORT`).
- `apps/reports/app/main.py` queda fuera, pero su CORS `*` con credenciales debe corregirse antes de
  la spec de reportes.

## Complexity Tracking

Sin violaciones que justificar.
