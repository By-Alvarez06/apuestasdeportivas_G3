# Contrato con la spec 3: catálogo de partidos y eventos de resultado

Contrato entre la spec 3 (partidos y mercados) y la spec 4 (apuestas y liquidación).
`PrismaMatchCatalog` (`apps/api/src/catalog/prisma-match-catalog.ts`) implementa el catálogo
persistente y `MatchEventPublisher` registra y publica resultados y cambios de estado en
`match-events`. `SimulatedCatalog` queda disponible solo para pruebas o desarrollo explícito
(`CATALOG_MODE=simulated`); la configuración normal usa `CATALOG_MODE=database`.

## 1. Puerto síncrono `MatchCatalogPort`

```ts
type Odds = number; // entero en centésimas, >= 101 (2.10 -> 210)

type MatchStatus = 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'SUSPENDED' | 'POSTPONED' | 'CANCELLED';
type MarketStatus = 'OPEN' | 'SUSPENDED' | 'CLOSED' | 'RESULTED' | 'VOID';

interface SelectionQuote {
  selectionId: string;
  marketId: string;
  matchId: string;
  odds: Odds;                 // cuota vigente
  marketStatus: MarketStatus;
  matchStatus: MatchStatus;
  startsAt: Date;             // hora de inicio programada
  liveBettingEnabled: boolean;// el operador habilitó este mercado en vivo
  labels: { match: string; market: string; selection: string };
}

interface MatchCatalogPort {
  /** Cuotas vigentes; las ids desconocidas se omiten del resultado. */
  getQuotes(selectionIds: string[]): Promise<SelectionQuote[]>;

  /** Cambios de cuota de una selección entre dos instantes (para la regla ODDS_DROP_PATTERN). */
  oddsHistory(selectionId: string, from: Date, to: Date): Promise<{ at: Date; odds: Odds }[]>;

  /** Partidos con mercados abiertos, con escudos y marcador para la pantalla de apuestas. */
  listOpenMatches(): Promise<
    { matchId: string; label: string; startsAt: Date; status: MatchStatus;
      homeTeam: { name: string; logoUrl: string | null };
      awayTeam: { name: string; logoUrl: string | null };
      homeScore: number | null; awayScore: number | null;
      markets: { marketId: string; label: string; status: MarketStatus; live: boolean;
        selections: { selectionId: string; label: string; odds: Odds }[] }[] }[]
  >;
}
```

Garantías: `getQuotes` refleja el último estado confirmado (lectura de base de datos o caché de
menos de 1 s). La spec 4 vuelve a llamarla justo antes de aceptar.

## 2. Cola `match-events` (BullMQ)

La spec 3 añade un job por evento con `jobId = sourceEventId` (único y estable: reenviar el mismo
evento no crea otro job). La spec 4 es la única consumidora.

```ts
type MatchEventJob =
  | { type: 'MARKET_RESULTED'; sourceEventId: string; matchId: string; marketId: string;
      results: Record<string /*selectionId*/, 'WON' | 'LOST' | 'VOID'>; occurredAt: string }
  | { type: 'RESULT_CORRECTED'; sourceEventId: string; matchId: string; marketId: string;
      results: Record<string, 'WON' | 'LOST' | 'VOID'>; occurredAt: string }
  | { type: 'MATCH_STATUS_CHANGED'; sourceEventId: string; matchId: string;
      status: MatchStatus; scheduledStart: string; occurredAt: string };
```

Reglas:

- Un mercado se resuelve una vez con `MARKET_RESULTED`; cambios posteriores llegan como
  `RESULT_CORRECTED` con el resultado completo nuevo.
- `results` cubre todas las selecciones del mercado.
- Al pasar a `FINISHED`, la spec 3 publica antes (o en el mismo lote) los `MARKET_RESULTED` de los
  mercados resueltos. Los mercados que la fuente no pueda resolver se publican como `VOID`.
- `MATCH_STATUS_CHANGED` a `SUSPENDED`, `POSTPONED`, `CANCELLED` o de vuelta a `LIVE`/`SCHEDULED`
  dispara las reglas de suspensión de la spec 4; la spec 3 no anula apuestas por su cuenta.
- La spec 3 cierra los mercados pre-partido (`CLOSED`) al inicio; la spec 4 además valida la hora
  con su propio reloj.

## 3. Simulador (solo desarrollo y pruebas)

`SimulatedCatalogModule` carga `fixtures.json` y expone, únicamente si `NODE_ENV !== 'production'`
y para el rol operador o administrador:

| Método | Ruta | Cuerpo |
|--------|------|--------|
| POST | `/dev/catalog/odds` | `{ selectionId, odds }` |
| POST | `/dev/catalog/markets/:marketId/status` | `{ status }` |
| POST | `/dev/catalog/events` | un `MatchEventJob` (se encola en `match-events`) |
| POST | `/dev/catalog/reset` | — recarga los fixtures |
