# Quickstart: Cuentas y billetera

Cómo levantar y validar la spec 2 en local.

## 1. Preparar

```bash
cp .env.example .env        # completar TOTP_ENC_KEY, TURNSTILE_* (claves de prueba) y PAYPHONE_*
pnpm install
pnpm db:up                  # PostgreSQL, Redis y Mailpit
pnpm --filter @apuestas/api prisma migrate dev
pnpm --filter @apuestas/api prisma db seed   # cuentas del sistema y primer administrador
pnpm dev
```

- Web: http://localhost:3000 · API: http://localhost:3001 · Correos: http://localhost:8025

## 2. Validar cada historia

| Historia | Pasos | Resultado esperado |
|----------|-------|--------------------|
| US1 | Registrarse en `/registro`, abrir el correo en Mailpit, verificar, iniciar sesión. Fallar el login 5 veces. | Sesión iniciada; al 5.º fallo, cuenta bloqueada 15 min. |
| US2 | Ir a `/billetera`. | Saldo real, bono y retenido en 0.00 USD. |
| US3 | Depositar 20.00 en `/billetera/depositar` y pagar en el sandbox de Payphone con una tarjeta de prueba. | Saldo real 20.00; recargar la página de retorno no lo duplica. |
| US4 | Activar 2FA en `/cuenta/seguridad`; retirar 10.00 y luego 250.00. | El primero queda pagado; el segundo, pendiente de aprobación. |
| US5 | Entrar como administrador en `/admin/usuarios`, cambiar un rol, revisar `/admin/auditoria`. | El cambio aparece en la auditoría. |

## 3. Pruebas

```bash
pnpm --filter @apuestas/api test                 # unitarias
pnpm --filter @apuestas/api test:e2e             # integración, concurrencia e idempotencia (PostgreSQL real)
pnpm --filter @apuestas/web test:e2e             # Playwright: registro y depósito
```
