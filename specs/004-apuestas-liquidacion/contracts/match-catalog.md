# Contrato con la spec 3: catálogo de partidos y eventos de resultado

Lo que la spec 4 necesita de la spec 3. Mientras la spec 3 no exista, lo implementa
`SimulatedCatalogModule` (`apps/api/src/catalog/simulated`). La spec 3 debe proveer un módulo que
exporte el token `MATCH_CATALOG` y producir los eventos en la cola `match-events`, y pasar la suite
`apps/api/src/catalog/testing/catalog-contract.ts`.

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

  /** Partidos con mercados abiertos, para la pantalla de apuestas provisional. */
  listOpenMatches(): Promise<
    { matchId: string; label: string; startsAt: Date; status: MatchStatus;
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
