/**
 * Contrato entre partidos y mercados (spec 3) y apuestas/liquidación (spec 4).
 * La implementación persistente es PrismaMatchCatalog; el simulador se reserva para pruebas.
 * Ver specs/004-apuestas-liquidacion/contracts/match-catalog.md.
 */

/** Token de inyección del catálogo. */
export const MATCH_CATALOG = Symbol('MATCH_CATALOG');

/** Cuota en centésimas, >= 101 (2.10 → 210). */
export type OddsHundredths = number;

export type MatchStatus =
  'SCHEDULED' | 'LIVE' | 'FINISHED' | 'SUSPENDED' | 'POSTPONED' | 'CANCELLED';
export type MarketStatus = 'OPEN' | 'SUSPENDED' | 'CLOSED' | 'RESULTED' | 'VOID';
export type SelectionResult = 'WON' | 'LOST' | 'VOID';

export interface SelectionQuote {
  selectionId: string;
  marketId: string;
  matchId: string;
  /** Cuota vigente. */
  odds: OddsHundredths;
  marketStatus: MarketStatus;
  matchStatus: MatchStatus;
  /** Hora de inicio programada. */
  startsAt: Date;
  /** El operador habilitó este mercado para apuestas en vivo. */
  liveBettingEnabled: boolean;
  labels: { match: string; market: string; selection: string };
}

export interface OddsPoint {
  at: Date;
  odds: OddsHundredths;
}

export interface CatalogMatch {
  matchId: string;
  label: string;
  startsAt: Date;
  status: MatchStatus;
  homeTeam: { name: string; logoUrl: string | null };
  awayTeam: { name: string; logoUrl: string | null };
  homeScore: number | null;
  awayScore: number | null;
  markets: {
    marketId: string;
    label: string;
    status: MarketStatus;
    live: boolean;
    selections: { selectionId: string; label: string; odds: OddsHundredths }[];
  }[];
}

export interface MatchCatalogPort {
  /** Cuotas vigentes; las ids desconocidas se omiten del resultado. */
  getQuotes(selectionIds: readonly string[]): Promise<SelectionQuote[]>;

  /** Cambios de cuota de una selección entre dos instantes (regla ODDS_DROP_PATTERN). */
  oddsHistory(selectionId: string, from: Date, to: Date): Promise<OddsPoint[]>;

  /** Hasta 20 partidos con cuotas abiertas y vigentes (pantalla de apuestas). */
  listOpenMatches(): Promise<CatalogMatch[]>;
}

// ── Eventos de la cola `match-events` ────────────────────────────────────────

interface MatchEventBase {
  /** Id estable del evento en la fuente; es el jobId de BullMQ y la clave de deduplicación. */
  sourceEventId: string;
  matchId: string;
  /** ISO 8601: cuándo ocurrió en la fuente (para medir la latencia). */
  occurredAt: string;
}

export interface MarketResultedEvent extends MatchEventBase {
  type: 'MARKET_RESULTED';
  marketId: string;
  /** Resultado de todas las selecciones del mercado. */
  results: Record<string, SelectionResult>;
}

export interface ResultCorrectedEvent extends MatchEventBase {
  type: 'RESULT_CORRECTED';
  marketId: string;
  /** Resultado completo nuevo del mercado. */
  results: Record<string, SelectionResult>;
}

export interface MatchStatusChangedEvent extends MatchEventBase {
  type: 'MATCH_STATUS_CHANGED';
  status: MatchStatus;
  /** ISO 8601: hora de inicio programada (base del plazo de suspensión). */
  scheduledStart: string;
}

export type MatchEventJob = MarketResultedEvent | ResultCorrectedEvent | MatchStatusChangedEvent;
