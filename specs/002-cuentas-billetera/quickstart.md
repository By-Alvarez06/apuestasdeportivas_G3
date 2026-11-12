# Quickstart: Cuentas y billetera

Cómo levantar y validar la spec 2 en local. Requisitos: Node 22, pnpm y Docker.

## 1. Preparar

```bash
cp .env.example .env
openssl rand -base64 32     # pegar el resultado en TOTP_ENC_KEY
pnpm install                # genera también el cliente de Prisma
pnpm db:up                  # PostgreSQL, Redis y Mailpit (si el 5432 está ocupado: POSTGRES_PORT=5434 pnpm db:up
                            # y cambiar el puerto en DATABASE_URL y TEST_DATABASE_URL)
pnpm --filter @apuestas/api db:migrate
pnpm --filter @apuestas/api db:seed   # cuentas del sistema y el administrador de ADMIN_EMAIL / ADMIN_PASSWORD
pnpm dev
```

- Web: http://localhost:3000 (llama a la API por `/api`) · API: http://localhost:3001 · Correos: http://localhost:8025
- Turnstile funciona con las claves de prueba de `.env.example` (siempre aprueban).
- Para pagar en el sandbox real de Payphone hacen falta `PAYPHONE_TOKEN` y `PAYPHONE_STORE_ID` del panel de
  desarrollador, y registrar ahí `PAYPHONE_RESPONSE_URL` como URL de respuesta. Sin credenciales, la E2E usa un
  Payphone simulado.

## 2. Validar cada historia

| Historia | Pasos | Resultado esperado |
|----------|-------|--------------------|
| US1 | Registrarse en `/registro`, abrir el enlace en Mailpit, iniciar sesión. Fallar el login 5 veces. | Sesión iniciada; al 5.º fallo, cuenta bloqueada 15 min y correo de aviso. |
| US2 | Ir a `/billetera`. | Saldo, bono y retenido en $0.00; historial vacío con enlace para depositar. |
| US3 | Depositar 20.00 en `/billetera/depositar` y pagar en Payphone. | Vuelve a `/billetera/depositos/:id` como acreditado; saldo $20.00; recargar no lo duplica. |
| US4 | Activar 2FA en `/cuenta/seguridad` y guardar los códigos; retirar 10.00 al titular del depósito. | Como no hubo apuestas desde el depósito, queda en revisión (FR-029); tras apostar (spec 4) se paga al instante. Sobre 200.00 siempre queda en revisión. |
| US5 | Entrar como administrador: `/admin/retiros` aprueba o rechaza, `/admin/usuarios` cambia un rol, `/admin/auditoria` muestra todo. | Aprobar paga desde lo retenido; rechazar lo devuelve al saldo; cada acción aparece en la auditoría. |

## 3. Pruebas

```bash
pnpm --filter @apuestas/api test                 # unitarias: dinero, Payphone, billetera en memoria
pnpm --filter @apuestas/api test:e2e             # integración: concurrencia, idempotencia, abuso, roles (PostgreSQL real)
pnpm --filter @apuestas/web test:e2e             # Playwright: registro y depósito de punta a punta, escritorio y móvil
```

La E2E necesita Mailpit arriba; si la web corre en otro puerto, pásalo con `E2E_BASE_URL=http://localhost:3005`.
Si ya hay una API corriendo en :3001, Playwright la reutiliza: para la E2E de depósito debe haber arrancado con
`PAYPHONE_BASE_URL=http://localhost:8099` y `THROTTLE_LIMIT=1000` (lo hace solo si Playwright la levanta).
