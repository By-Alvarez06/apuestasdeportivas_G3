# Quickstart: Apuestas y liquidación

Cómo probar la spec 4 de punta a punta en local. Por defecto (`CATALOG_MODE=database`) las apuestas
usan los partidos y cuotas reales de la spec 3 (cartelera, gestión del operador y sincronización
con API-Football). Este recorrido usa el **catálogo simulado** (`CATALOG_MODE=simulated` en el
`.env`, solo fuera de producción) porque permite publicar resultados, correcciones y aplazamientos
a mano; es el mismo que usan las pruebas de integración y la E2E de apuestas.

## Preparación

```bash
pnpm install
pnpm db:up                                   # PostgreSQL, Redis y Mailpit (si el 5432 está ocupado: POSTGRES_PORT=5434)
pnpm --filter @apuestas/api db:migrate
pnpm --filter @apuestas/api db:seed          # admin (ADMIN_EMAIL / ADMIN_PASSWORD) + cuentas del sistema
pnpm dev                                     # api :3001, web :3000
```

El catálogo simulado (`apps/api/src/catalog/simulated/fixtures.json`) trae 5 partidos con horas
relativas al arranque de la API:

| Partido | Estado | Para probar |
|---------|--------|-------------|
| `m1` Barcelona SC vs Emelec | empieza en 2 h | apuesta simple, resultados, correcciones |
| `m2` LDU Quito vs Independiente del Valle | en vivo (mercado 1X2 habilitado) | retardo en vivo; su mercado "primer gol" está cerrado |
| `m3` Aucas vs Deportivo Cuenca | empezó hace 10 min | rechazo por partido iniciado |
| `m4`, `m5` (Copa Ecuador) | mañana | combinadas, suspensiones |

## Controlar el simulador como operador

Los endpoints `/dev/catalog/*` hacen sobre el catálogo simulado lo que la spec 3 hace con partidos
reales (cambiar cuotas, publicar resultados). Solo existen fuera de producción y piden rol operador
o administrador. Con el administrador del seed
(Turnstile de prueba acepta el token ficticio):

```bash
curl -c op.jar -H 'Origin: http://localhost:3000' -H 'content-type: application/json' \
  localhost:3001/auth/login \
  -d '{"email":"admin@apuestas.local","password":"<ADMIN_PASSWORD>","captchaToken":"XXXX.DUMMY.TOKEN.XXXX"}'

# Atajo para los ejemplos de abajo
op() { curl -s -b op.jar -H 'Origin: http://localhost:3000' -H 'content-type: application/json' "$@"; }
op -X POST localhost:3001/dev/catalog/reset          # vuelve a los fixtures
```

## Recorrido

1. Registra un apostador, verifica el correo en Mailpit (http://localhost:8025) y deposita
   50.00 USD con el Payphone simulado (como en la spec 2).
2. En **/apuestas** elige "Barcelona SC" (2.10) y confirma 10.00 USD: saldo 40.00 USD y la apuesta
   en **/mis-apuestas**.
3. Cuota cambiada: con la selección en el boleto, cambia la cuota y confirma sin recargar. El boleto
   muestra la cuota nueva y pide confirmar de nuevo.

   ```bash
   op localhost:3001/dev/catalog/odds -d '{"selectionId":"m1-1x2-home","odds":"1.95"}'
   ```

4. Resultado en vivo: deja abierta **/mis-apuestas** y publica el resultado. La apuesta pasa a
   ganada y el saldo de la cabecera sube sin recargar. Repetir el mismo evento no cambia nada.

   ```bash
   op localhost:3001/dev/catalog/events -d '{"type":"MARKET_RESULTED","sourceEventId":"demo-1",
     "matchId":"m1","marketId":"m1-1x2",
     "results":{"m1-1x2-home":"WON","m1-1x2-draw":"LOST","m1-1x2-away":"LOST"}}'
   ```

5. Corrección: publica `RESULT_CORRECTED` con otro ganador. Se revierte el pago (si ya no hay saldo,
   queda saldo adeudado y apostar o retirar se bloquea hasta cubrirlo).

   ```bash
   op localhost:3001/dev/catalog/events -d '{"type":"RESULT_CORRECTED","sourceEventId":"demo-2",
     "matchId":"m1","marketId":"m1-1x2",
     "results":{"m1-1x2-home":"LOST","m1-1x2-draw":"WON","m1-1x2-away":"LOST"}}'
   ```

6. Aplazamiento: apuesta a `m4` y aplaza el partido con un inicio programado de hace 3 días. El
   plazo (48 h) ya venció: en el siguiente minuto la apuesta se anula y se reembolsa. Mientras
   tanto aparece en **/operador/partidos-en-espera**. Un partido cancelado (`CANCELLED`) se
   reembolsa al instante.

   ```bash
   op localhost:3001/dev/catalog/events -d '{"type":"MATCH_STATUS_CHANGED","sourceEventId":"demo-3",
     "matchId":"m4","status":"POSTPONED","scheduledStart":"2026-11-12T20:00:00Z"}'
   ```

7. Promociones: en **/operador/cupones** crea `BIENVENIDA` (bono de depósito 50 %, tope 20.00 USD)
   y una apuesta gratis. El apostador los canjea en **/promociones**; tras depositar 30.00 USD
   aparece en menos de un minuto un bono de 15.00 USD con su rollover, y la apuesta gratis se elige
   en el boleto. Canjear el mismo cupón desde otra cuenta en el mismo navegador se rechaza.
8. Fraude: si 3 cuentas apuestan o canjean desde el mismo navegador, **/admin/fraude** muestra una
   alerta alta de cuentas múltiples (y esas cuentas ya no pueden canjear cupones hasta resolverla).

## Latencia resultado → pantalla (SC-004)

La E2E `apps/web/e2e/betting.spec.ts` mide desde que el operador publica el resultado hasta que el
apostador ve su apuesta ganada y su saldo nuevo, sin recargar:

| Proyecto | Medido (2026-11-14) | Objetivo |
|----------|--------------------|----------|
| Escritorio (Chrome) | 173 ms | ≤ 5 s |
| Móvil (Pixel 7) | 140 ms | ≤ 5 s |

En la API, cada liquidación registra `settlement.latency_ms` desde el `occurredAt` del evento.

## Pruebas

```bash
pnpm --filter @apuestas/api test                                   # unitarias
pnpm --filter @apuestas/api test:e2e -- bets                       # aceptación, combinadas, en vivo, concurrencia
pnpm --filter @apuestas/api test:e2e -- "settlement|live"          # liquidación, correcciones, recuperación, WebSocket
pnpm --filter @apuestas/api test:e2e -- suspensions
pnpm --filter @apuestas/api test:e2e -- "coupons|bonus|promotions" # cupones, rollover, apuestas gratis y aumentos
pnpm --filter @apuestas/api test:e2e -- fraud
pnpm --filter @apuestas/web test:e2e -- betting                    # E2E en escritorio y móvil (necesita ADMIN_* del .env)
```

Las pruebas de integración necesitan Redis además de PostgreSQL (`pnpm db:up`).
