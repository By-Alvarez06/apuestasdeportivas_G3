# Contrato HTTP: Apuestas y liquidación

Base: `apps/api`. Mismas convenciones que la spec 2: JSON, montos como string con 2 decimales
(`"10.00"`), cuotas como string con 2 decimales (`"2.10"`), cookie `access_token`, errores
`{ "error": { "code", "message" } }`.

Roles: **B** apostador, **O** operador, **A** administrador. Sin rol listado, 403.

## Códigos de error nuevos (`ErrorCode` en `packages/shared`)

`ODDS_CHANGED` (409, incluye `details.quotes`), `MARKET_CLOSED` (409), `MATCH_STARTED` (409),
`STAKE_OUT_OF_LIMITS` (422, incluye `details.min`/`max`), `PAYOUT_LIMIT` (422, incluye
`details.maxStake`), `DAILY_LIMIT` (422), `DEBT_OUTSTANDING` (423), `COUPON_INVALID` (422, con
`details.reason`: `EXPIRED` | `EXHAUSTED` | `PAUSED` | `NOT_FOUND`), `COUPON_ALREADY_USED` (409),
`COUPON_BLOCKED` (423), `BONUS_ACTIVE` (409). Se reutilizan `INSUFFICIENT_FUNDS`,
`IDEMPOTENCY_CONFLICT`, `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`.

## Apuestas

| Método | Ruta | Rol | Cuerpo / notas | Respuesta |
|--------|------|-----|----------------|-----------|
| POST | `/bets` | B | header `Idempotency-Key`; `{ selections: [{ selectionId, odds }], stake, source: "REAL"\|"BONUS"\|"FREE_BET", freeBetId?, boostRedemptionId? }`. `type` se deduce del número de selecciones. Con `FREE_BET`, `stake` debe ser el monto de la apuesta gratis (no aplica mínimo ni máximo ni límite diario). El aumento solo en simples: `odds` es la cuota vigente sin aumento y se congela la aumentada | 201 `BetView`; 200 si la clave ya existía con los mismos datos; 422 `COUPON_INVALID` (`USED`, `EXPIRED`, `NOT_FOUND`) |
| GET | `/bets` | B | `?status=OPEN\|SETTLED&from=&to=&page=&pageSize=` | lista paginada de `BetView` propias |
| GET | `/bets/:id` | B (dueño) | — | `BetView` con liquidaciones |
| GET | `/betting/limits` | B O A | — | `{ minStake, maxStake, maxPayout, dailyStakePerUser, dailyStakeUsed, comboMaxSelections }` |

`BetView`: `{ id, type, status, stake, source, totalOdds, potentialPayout, payout, live, acceptedAt,
settledAt, selections: [{ id, selectionId, matchLabel, marketLabel, selectionLabel, odds, status,
startsAt, hold }] }`. `hold` es `{ status: "SUSPENDED" | "POSTPONED", deadline }` si la selección
está pendiente en un partido en espera, o `null`. `GET /betting/limits` incluye además `openDebt`
(saldo adeudado por re-liquidaciones; con más de 0.00 no se puede apostar ni retirar). `totalOdds` se trunca a 2 decimales solo para mostrar; el pago usa el producto exacto.

Orden de validación en `POST /bets`: formato (400) → límites de monto (422) → selección inexistente
(404) → mercado o partido no apostable (409 `MARKET_CLOSED` / `MATCH_STARTED`) → cuota distinta
(409 `ODDS_CHANGED`) → ganancia máxima (422) → [retardo en vivo y revalidación] → con la billetera
bloqueada: límite diario (422) y saldo (422 `INSUFFICIENT_FUNDS`). El límite diario se cuenta por
día calendario de Ecuador (UTC-5) y solo suma apuestas con saldo real o de bono.

## Catálogo provisional (lo reemplaza la spec 3)

| Método | Ruta | Rol | Respuesta |
|--------|------|-----|-----------|
| GET | `/catalog/matches` | B O A | `listOpenMatches()` con cuotas como string |

## Operación

| Método | Ruta | Rol | Notas | Respuesta |
|--------|------|-----|-------|-----------|
| GET | `/operator/settings` | O A | — | todas las claves de `BettingSetting` con su valor efectivo |
| PUT | `/operator/settings/:key` | O A | `{ value }`; validado por clave; auditado con valor anterior y nuevo | 200 |
| GET | `/operator/holds` | O A | partidos en espera y los resueltos en los últimos 7 días | `[{ matchId, matchLabel, status, deadline, resolution, resolvedAt, openBets }]` |
| GET | `/operator/bets` | O A | `?matchId=&status=OPEN\|SETTLED&page=&pageSize=` | lista paginada de `BetView` + `userId` (sin otros datos personales) |

## Cupones y bonos

| Método | Ruta | Rol | Notas | Respuesta |
|--------|------|-----|-------|-----------|
| POST | `/operator/coupons` | O A | `{ code, type, startsAt, endsAt, totalLimit }` + por tipo: DEPOSIT_BONUS `percent`, `maxBonus`; FREE_BET `amount`; ODDS_BOOST `percent`, `maxBoost?`. Límite por usuario fijo en 1 | 201 `CouponView`; 409 código repetido |
| GET | `/operator/coupons` | O A | `?status=` | lista con `redeemed` |
| POST | `/operator/coupons/:id/pause` · `/resume` | O A | auditado | 200 |
| POST | `/coupons/redeem` | B | `{ code }`; usa la cookie `device_id` | 201 `{ redemptionId, code, type, status, freeBet? }`; 422 `COUPON_INVALID` (`NOT_FOUND`, `PAUSED`, `NOT_STARTED`, `EXPIRED`, `EXHAUSTED`); 409 `COUPON_ALREADY_USED`; 423 `COUPON_BLOCKED`; 409 `BONUS_ACTIVE` |
| GET | `/promotions` | B | — | `{ bonus: { amount, wagerRequired, wagerProgress, expiresAt, status } \| null, freeBets: [...], boosts: [...], redemptions: [...] }` |

## Fraude

| Método | Ruta | Rol | Notas | Respuesta |
|--------|------|-----|-------|-----------|
| GET | `/admin/fraud-alerts` | A | `?status=&rule=&page=` | lista paginada |
| GET | `/admin/fraud-alerts/:id` | A | — | alerta con evidencia y `users: [{ id, email, status, role, createdAt }]` |
| POST | `/admin/fraud-alerts/:id/resolve` | A | `{ decision: "DISMISSED"\|"CONFIRMED", reason (3–500), suspendUsers?: boolean }` | 200; audita y, si se pide, suspende a los apostadores con el servicio de usuarios de la spec 2; 409 si ya estaba resuelta |

Severidades: `MULTI_ACCOUNT` por dispositivo o titular de pago, `MIRROR_BETS` y `RESETTLEMENT_DEBT`
son altas (bloquean canjes, FR-037); `MULTI_ACCOUNT` por IP (umbral `fraud.multiAccountIpMin`, 10 por
defecto: las redes compartidas son comunes), `ANOMALOUS_STAKE`, `ODDS_DROP_PATTERN` y
`WITHDRAWAL_NO_ACTIVITY` son medias.

## Auditoría (acciones nuevas)

`bet.placed`, `bet.rejected` (solo motivos de seguridad: cuota, inicio, límites, deuda),
`bet.settled`, `bet.voided`, `bet.resettled`, `debt.created`, `debt.collected`, `settings.changed`,
`coupon.created`, `coupon.paused`, `coupon.resumed`, `coupon.redeemed`, `coupon.redeem.rejected`,
`bonus.granted`, `bonus.converted`, `bonus.expired`, `fraud.alert.created`, `fraud.alert.resolved`.
Los eventos automáticos se registran con `actorId: null`, `ip: "system"`, `userAgent: "worker"`.
