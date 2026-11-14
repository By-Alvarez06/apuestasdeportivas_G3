# Data Model: Apuestas y liquidación

Se añade al `apps/api/prisma/schema.prisma` de la spec 2. Montos en centavos (`Int`), cuotas en
centésimas (`Int`, `2.10` → `210`). Ningún modelo tiene clave foránea a tablas de la spec 3: se
guarda el id externo y una copia de los nombres (snapshot).

## Cambios a modelos de la spec 2

- `enum LedgerTransactionType` + `BET_REFUND`, `BET_REVERSAL`, `DEBT_COLLECTION`,
  `BONUS_CONVERSION`, `BONUS_EXPIRY`. (`BET_DEBIT`, `BET_CREDIT`, `BONUS_CREDIT` ya existen.)
- `User`: relaciones nuevas `bets`, `couponRedemptions`, `bonuses`, `freeBets`, `debts`.
- `WithdrawalsService.request()` llama a `DebtGuard.assertNoOpenDebt(userId)` (sin cambios de tabla).

## Apuestas

```prisma
enum BetType      { SINGLE COMBO }
enum StakeSource  { REAL BONUS FREE_BET }
enum BetStatus    { OPEN WON LOST VOID }
enum SelectionStatus { PENDING WON LOST VOID }

model Bet {
  id               String      @id @default(uuid()) @db.Uuid
  userId           String      @db.Uuid
  requestKey       String      // Idempotency-Key del cliente
  type             BetType
  stake            Int         // centavos; en FREE_BET es el valor de la apuesta gratis
  source           StakeSource
  totalOddsX       String      // producto exacto de cuotas en centésimas^n, como texto (BigInt)
  potentialPayout  Int         // centavos, floor(stake × Π cuotas)
  status           BetStatus   @default(OPEN)
  settledVersion   Int         @default(0)  // versión de la última liquidación aplicada
  payout           Int         @default(0)  // pagado en la liquidación vigente
  couponRedemptionId String?   @db.Uuid     // aumento de cuota aplicado
  freeBetId        String?     @unique @db.Uuid
  live             Boolean     @default(false)
  deviceId         String?
  ip               String
  acceptedAt       DateTime    @default(now())
  settledAt        DateTime?
  selections       BetSelection[]
  settlements      BetSettlement[]

  @@unique([userId, requestKey])
  @@index([userId, acceptedAt])
  @@index([status])
}

model BetSelection {
  id            String          @id @default(uuid()) @db.Uuid
  betId         String          @db.Uuid
  selectionId   String          // id externo (spec 3)
  marketId      String
  matchId       String
  odds          Int             // centésimas, congelada (ya con aumento si aplica)
  status        SelectionStatus @default(PENDING)
  resultVersion Int             @default(0)
  matchLabel    String          // snapshot: "Liga Pro · Barcelona vs Emelec"
  marketLabel   String          // snapshot: "Resultado final"
  selectionLabel String         // snapshot: "Barcelona"
  startsAt      DateTime

  @@unique([betId, matchId])     // FR: selecciones de partidos distintos
  @@index([selectionId])
  @@index([marketId])
  @@index([matchId])
}
```

**Reglas**: `Bet` y `BetSelection` no se borran (trigger `BEFORE DELETE` que lanza error). Las
columnas `stake`, `source`, `type`, `totalOddsX`, `potentialPayout`, `odds`, `selectionId`,
`userId` son inmutables (trigger `BEFORE UPDATE` que las compara). Solo cambian estados, versiones,
`payout` y `settledAt`.

**Estados de `Bet`**:

```text
OPEN ──todas las selecciones resueltas / una perdida──▶ WON | LOST | VOID
WON | LOST | VOID ──corrección de resultado (versión n+1)──▶ WON | LOST | VOID | OPEN
```

`VOID` = todas las selecciones anuladas (reembolso). Una corrección puede devolver una combinada a
`OPEN` si la selección corregida deja de estar perdida y quedan otras pendientes.

## Liquidación y eventos

```prisma
enum MatchEventType { MARKET_RESULTED MATCH_STATUS_CHANGED RESULT_CORRECTED }

/// Inmutable. Garantiza que ningún evento se procesa dos veces ni se pierde.
model MatchEvent {
  id            String         @id @default(uuid()) @db.Uuid
  sourceEventId String         @unique
  type          MatchEventType
  matchId       String
  marketId      String?
  payload       Json
  receivedAt    DateTime       @default(now())
  processedAt   DateTime?
}

/// Una fila por versión de liquidación de una apuesta. Inmutable.
model BetSettlement {
  id                  String    @id @default(uuid()) @db.Uuid
  betId               String    @db.Uuid
  version             Int
  outcome             BetStatus // WON | LOST | VOID | OPEN (revertida sin resultado final)
  payout              Int       // centavos acreditados en esta versión
  reversedAmount      Int       @default(0) // revertido de la versión anterior
  matchEventId        String    @db.Uuid
  ledgerTransactionIds String[]
  createdAt           DateTime  @default(now())

  @@unique([betId, version])
}

/// Suspensión o aplazamiento en espera de reanudación.
model MatchHold {
  matchId    String    @id
  status     String    // SUSPENDED | POSTPONED
  deadline   DateTime  // inicio programado + plazo configurado
  resolvedAt DateTime?
  resolution String?   // RESUMED | VOIDED | CANCELLED
}

/// Diferencia pendiente tras una re-liquidación (R7).
model BetDebt {
  id        String    @id @default(uuid()) @db.Uuid
  userId    String    @db.Uuid
  betId     String    @db.Uuid
  amount    Int       // pendiente original
  collected Int       @default(0)
  createdAt DateTime  @default(now())
  closedAt  DateTime?

  @@index([userId, closedAt])
}
```

## Configuración

```prisma
model BettingSetting {
  key       String   @id   // p. ej. "limits.maxStake"
  value     Json
  updatedById String? @db.Uuid
  updatedAt DateTime @updatedAt
}
```

Claves y valores por defecto: `limits.minStake` 50, `limits.maxStake` 50000,
`limits.maxPayout` 1000000, `limits.dailyStakePerUser` 200000, `combo.maxSelections` 10,
`live.delayMs` 5000, `suspension.windowMs` 172800000, `bonus.rolloverMultiplier` 5,
`bonus.minOdds` 150, `bonus.validDays` 30, más los umbrales de fraude de R11.

## Promociones

```prisma
enum CouponType   { DEPOSIT_BONUS FREE_BET ODDS_BOOST }
enum CouponStatus { ACTIVE PAUSED }
enum RedemptionStatus { AWAITING_DEPOSIT GRANTED AVAILABLE USED EXPIRED }

model Coupon {
  id           String       @id @default(uuid()) @db.Uuid
  code         String       @unique         // mayúsculas, 4–20 caracteres
  type         CouponType
  value        Int          // % (DEPOSIT_BONUS, ODDS_BOOST) o centavos (FREE_BET)
  cap          Int?         // tope en centavos (bono) o en centésimas de cuota (aumento)
  startsAt     DateTime
  endsAt       DateTime
  totalLimit   Int
  perUserLimit Int          @default(1)
  redeemed     Int          @default(0)     // contador bajo FOR UPDATE
  status       CouponStatus @default(ACTIVE)
  createdById  String       @db.Uuid
  createdAt    DateTime     @default(now())
}

model CouponRedemption {
  id        String           @id @default(uuid()) @db.Uuid
  couponId  String           @db.Uuid
  userId    String           @db.Uuid
  deviceId  String
  payerKey  String?          // hash del titular de pago (spec 2)
  status    RedemptionStatus
  createdAt DateTime         @default(now())

  @@unique([couponId, userId])
  @@unique([couponId, deviceId])
  @@unique([couponId, payerKey])  // NULL no colisiona en PostgreSQL
}

enum BonusStatus { ACTIVE CONVERTED EXPIRED }

model Bonus {
  id             String      @id @default(uuid()) @db.Uuid
  userId         String      @db.Uuid
  redemptionId   String?     @unique @db.Uuid
  amount         Int
  wagerRequired  Int         // amount × multiplicador
  wagerProgress  Int         @default(0)
  expiresAt      DateTime
  status         BonusStatus @default(ACTIVE)
  closedAt       DateTime?
  // Índice parcial en la migración: un solo ACTIVE por usuario.
}

model FreeBet {
  id           String    @id @default(uuid()) @db.Uuid
  userId       String    @db.Uuid
  redemptionId String    @unique @db.Uuid
  amount       Int
  expiresAt    DateTime
  usedAt       DateTime?
}
```

## Fraude

```prisma
enum FraudRule     { MULTI_ACCOUNT ANOMALOUS_STAKE ODDS_DROP_PATTERN MIRROR_BETS WITHDRAWAL_NO_ACTIVITY RESETTLEMENT_DEBT }
enum FraudSeverity { MEDIUM HIGH }
enum AlertStatus   { OPEN DISMISSED CONFIRMED }

model FraudAlert {
  id           String        @id @default(uuid()) @db.Uuid
  rule         FraudRule
  severity     FraudSeverity
  subjectKey   String        // p. ej. "device:<id>" o "user:<id>"; dedupe de alertas abiertas
  userIds      String[]
  evidence     Json
  status       AlertStatus   @default(OPEN)
  resolvedById String?       @db.Uuid
  resolution   String?
  createdAt    DateTime      @default(now())
  resolvedAt   DateTime?

  // Índice parcial en la migración: único (rule, subjectKey) WHERE status = 'OPEN'.
  @@index([status, createdAt])
}
```

## Validaciones (resumen)

| Regla | Dónde |
|-------|-------|
| `minStake ≤ stake ≤ maxStake`; `potentialPayout ≤ maxPayout`; suma diaria ≤ `dailyStakePerUser` | `BetsService.place` con la billetera bloqueada |
| 2 ≤ selecciones ≤ `combo.maxSelections` en combinadas, partidos distintos | DTO + `@@unique([betId, matchId])` |
| cuota enviada = cuota vigente; mercado `OPEN`; `now < startsAt` o mercado en vivo habilitado | `BetsService.place` (reloj del servidor) |
| sin `BetDebt` abierta | `DebtGuard` |
| cupón vigente, activo, con cupo; sin alerta HIGH abierta | `CouponsService.redeem` |
