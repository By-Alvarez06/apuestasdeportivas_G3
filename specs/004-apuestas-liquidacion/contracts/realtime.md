# Contrato de tiempo real (Socket.IO)

Namespace `/live` del API (`apps/api`), path `/socket.io`. En desarrollo la web conecta a través del
proxy de Next.js; en producción, al dominio de la API con `withCredentials: true`.

## Conexión

- La autenticación usa la cookie `access_token` del handshake, verificada igual que `AuthGuard`
  (firma, sesión viva, usuario no suspendido). Sin sesión válida, el servidor desconecta con
  `connect_error` `{ code: "UNAUTHENTICATED" }`.
- El servidor une el socket a la sala `user:{userId}`. El cliente no puede unirse a otras salas: no
  existe ningún evento de suscripción.
- Si el handshake trae `Origin`, debe ser `WEB_URL`; si no, se rechaza igual que sin sesión.
- Al expirar el token de acceso (15 min), el servidor emite `session.expired`
  `{ code: "TOKEN_EXPIRED" }` y desconecta; el cliente renueva con `POST /auth/refresh` y reconecta.

## Eventos servidor → cliente

| Evento | Payload | Cuándo |
|--------|---------|--------|
| `bet.updated` | `{ bet: BetView, version }` (`BetView` de http-api.md) | tras el commit de cualquier liquidación, anulación, reembolso o re-liquidación de una apuesta del usuario, o del resultado de una selección de una combinada aún abierta |
| `wallet.updated` | `{ real: Money, bonus: Money, held: Money }` | tras cualquier movimiento hecho por la spec 4 en la billetera del usuario |
| `bonus.updated` | `{ bonusId, status, wagerProgress: Money, wagerRequired: Money }` | avance, conversión o caducidad del bono |

`Money` = string con 2 decimales. Los eventos son avisos: si el cliente se pierde uno, al reconectar
recarga `GET /bets` y `GET /wallet`. Cada evento lleva `version` (o `settledAt`) para descartar
eventos viejos que lleguen desordenados.

## Latencia

Se mide `occurredAt` del evento de la cola → emisión del socket y se registra en el log
(`settlement.latency_ms`). Objetivo SC-004: p95 ≤ 5 s de punta a punta.
