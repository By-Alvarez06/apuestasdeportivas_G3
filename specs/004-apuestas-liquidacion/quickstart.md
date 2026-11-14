# Quickstart: Apuestas y liquidación

Cómo probar la spec 4 de punta a punta en local, con el catálogo simulado (la spec 3 aún no existe).

## Preparación

```bash
pnpm install
pnpm db:up                                   # PostgreSQL, Redis y Mailpit
pnpm --filter @apuestas/api db:migrate
pnpm --filter @apuestas/api db:seed          # admin + cuentas del sistema
pnpm dev                                     # api :3001, web :3000
```

`fixtures.json` del catálogo simulado trae 3 partidos: uno que empieza en 2 h, uno en vivo con un
mercado habilitado para apuestas en vivo, y uno que empezó hace 10 min (para probar el rechazo).

## Recorrido

1. Registra un apostador, verifica el correo en Mailpit (http://localhost:8025) y deposita 50.00 USD
   con el Payphone simulado (como en la spec 2).
2. En **/apuestas**, elige "gana el local" (2.10) y apuesta 10.00 USD → saldo real 40.00 USD.
3. Como operador, cambia la cuota en la misma selección y vuelve a apostar como apostador con la
   página sin recargar → aviso de cuota cambiada y botón para reconfirmar.
4. Deja abierta **/mis-apuestas** y publica el resultado:

   ```bash
   curl -X POST localhost:3001/dev/catalog/events -H 'content-type: application/json' \
     -b "access_token=<cookie de operador>" -H 'origin: http://localhost:3000' \
     -d '{"type":"MARKET_RESULTED","sourceEventId":"demo-1","matchId":"m1","marketId":"m1-1x2",
          "results":{"m1-1x2-home":"WON","m1-1x2-draw":"LOST","m1-1x2-away":"LOST"},
          "occurredAt":"2026-11-13T20:00:00Z"}'
   ```

   La apuesta pasa a ganada y el saldo sube a 61.00 USD sin recargar. Repetir el mismo `curl` no
   cambia nada.
5. Publica `MATCH_STATUS_CHANGED` a `POSTPONED` sobre otro partido con apuestas, y cambia
   `suspension.windowMs` a 60000 en **/operador/ajustes**: al minuto, las apuestas se reembolsan.
6. Como operador crea el cupón `BIENVENIDA` (bono de depósito 50 %, tope 20.00 USD); como apostador
   canjéalo y deposita 30.00 USD: en menos de un minuto aparece un bono de 15.00 USD en
   **/promociones** con su rollover. Canjéalo desde otra cuenta en el mismo navegador → rechazado.
7. Como administrador abre **/admin/fraude**: aparece la alerta de cuentas múltiples del paso 6.

## Pruebas

```bash
pnpm --filter @apuestas/api test                      # unitarias
pnpm --filter @apuestas/api test:e2e -- bets          # aceptación, concurrencia, abuso
pnpm --filter @apuestas/api test:e2e -- settlement    # liquidación, idempotencia, correcciones
pnpm --filter @apuestas/api test:e2e -- suspensions
pnpm --filter @apuestas/api test:e2e -- coupons
pnpm --filter @apuestas/api test:e2e -- fraud
pnpm --filter @apuestas/web test:e2e -- betting       # apostar y ver la liquidación en vivo
```

Las pruebas de integración necesitan Redis además de PostgreSQL (`pnpm db:up`).
