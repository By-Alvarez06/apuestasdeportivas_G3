import type {
  CatalogMatch,
  MarketStatus,
  MatchCatalogPort,
  MatchEventJob,
  MatchStatus,
  OddsHundredths,
  OddsPoint,
  SelectionQuote,
} from '../match-catalog.port';
import fixtures from './fixtures.json';

interface FixtureMatch {
  matchId: string;
  label: string;
  startsInMinutes: number;
  status: string;
  markets: {
    marketId: string;
    label: string;
    status: string;
    live: boolean;
    selections: { selectionId: string; label: string; odds: number }[];
  }[];
}

interface SimMarket {
  marketId: string;
  label: string;
  status: MarketStatus;
  live: boolean;
  selections: { selectionId: string; label: string; odds: OddsHundredths }[];
}

interface SimMatch {
  matchId: string;
  label: string;
  startsAt: Date;
  status: MatchStatus;
  homeTeam: { name: string; logoUrl: string | null };
  awayTeam: { name: string; logoUrl: string | null };
  homeScore: number | null;
  awayScore: number | null;
  markets: SimMarket[];
}

const CLOSED_MATCH: ReadonlySet<MatchStatus> = new Set(['FINISHED', 'CANCELLED']);

function parseTeams(label: string): [string, string] {
  const teams = label.split(' · ').at(-1) ?? label;
  const separator = teams.includes(' vs ') ? ' vs ' : ' - ';
  const [home = teams, ...away] = teams.split(separator);
  return [home.trim(), away.join(separator).trim()];
}

function toSimMatch(match: FixtureMatch, base: number): SimMatch {
  const [home, away] = parseTeams(match.label);
  return {
    matchId: match.matchId,
    label: match.label,
    startsAt: new Date(base + match.startsInMinutes * 60_000),
    status: match.status as MatchStatus,
    homeTeam: { name: home, logoUrl: null },
    awayTeam: { name: away, logoUrl: null },
    homeScore: null,
    awayScore: null,
    markets: match.markets.map((market) => ({
      ...market,
      status: market.status as MarketStatus,
      selections: market.selections.map((selection) => ({ ...selection })),
    })),
  };
}

/**
 * Catálogo de partidos en memoria que sustituye a la spec 3 (research R2). Carga `fixtures.json`
 * con horas relativas al arranque y permite a las pruebas y al operador (solo fuera de producción)
 * cambiar cuotas y estados. No persiste nada: un reinicio vuelve a los fixtures.
 */
export class SimulatedCatalog implements MatchCatalogPort {
  private matches = new Map<string, SimMatch>();
  private history = new Map<string, OddsPoint[]>();

  constructor(private readonly now: () => Date = () => new Date()) {
    this.reset();
  }

  /** Recarga los fixtures con horas relativas a este instante y borra el historial de cuotas. */
  reset(): void {
    const base = this.now().getTime();
    this.matches = new Map(
      (fixtures.matches as FixtureMatch[]).map((match) => [match.matchId, toSimMatch(match, base)]),
    );
    this.history.clear();
  }

  getQuotes(selectionIds: readonly string[]): Promise<SelectionQuote[]> {
    const wanted = new Set(selectionIds);
    const quotes: SelectionQuote[] = [];
    for (const match of this.matches.values())
      for (const market of match.markets)
        for (const s of market.selections)
          if (wanted.has(s.selectionId))
            quotes.push({
              selectionId: s.selectionId,
              marketId: market.marketId,
              matchId: match.matchId,
              odds: s.odds,
              marketStatus: market.status,
              matchStatus: match.status,
              startsAt: new Date(match.startsAt),
              liveBettingEnabled: market.live,
              labels: { match: match.label, market: market.label, selection: s.label },
            });
    return Promise.resolve(quotes);
  }

  oddsHistory(selectionId: string, from: Date, to: Date): Promise<OddsPoint[]> {
    const points = (this.history.get(selectionId) ?? []).filter((p) => p.at >= from && p.at <= to);
    return Promise.resolve(points.map((p) => ({ at: new Date(p.at), odds: p.odds })));
  }

  listOpenMatches(): Promise<CatalogMatch[]> {
    const open = [...this.matches.values()]
      .filter((m) => !CLOSED_MATCH.has(m.status) && m.markets.some((mk) => mk.status === 'OPEN'))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((m) => ({
        matchId: m.matchId,
        label: m.label,
        startsAt: new Date(m.startsAt),
        status: m.status,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        markets: m.markets.map((mk) => ({
          marketId: mk.marketId,
          label: mk.label,
          status: mk.status,
          live: mk.live,
          selections: mk.selections.map((s) => ({ ...s })),
        })),
      }));
    return Promise.resolve(open);
  }

  // ── Control del simulador ──────────────────────────────────────────────────

  /** Cambia la cuota vigente y la registra en el historial. Lanza si la selección no existe. */
  setOdds(selectionId: string, odds: OddsHundredths): void {
    const selection = this.findSelection(selectionId);
    selection.odds = odds;
    const points = this.history.get(selectionId) ?? [];
    points.push({ at: this.now(), odds });
    this.history.set(selectionId, points);
  }

  setMarketStatus(marketId: string, status: MarketStatus): void {
    this.findMarket(marketId).status = status;
  }

  setMatchStatus(matchId: string, status: MatchStatus): void {
    this.findMatch(matchId).status = status;
  }

  /** Mueve la hora de inicio de un partido (para probar cierres por reloj). */
  setStartsAt(matchId: string, startsAt: Date): void {
    this.findMatch(matchId).startsAt = new Date(startsAt);
  }

  /** Refleja en el catálogo un evento publicado, como haría la spec 3 al producirlo. */
  applyEvent(event: MatchEventJob): void {
    if (!this.matches.has(event.matchId)) return;
    if (event.type === 'MATCH_STATUS_CHANGED') {
      this.setMatchStatus(event.matchId, event.status);
      return;
    }
    const allVoid = Object.values(event.results).every((r) => r === 'VOID');
    if (this.findMatch(event.matchId).markets.some((mk) => mk.marketId === event.marketId))
      this.setMarketStatus(event.marketId, allVoid ? 'VOID' : 'RESULTED');
  }

  private findMatch(matchId: string): SimMatch {
    const match = this.matches.get(matchId);
    if (!match) throw new Error(`Partido simulado desconocido: ${matchId}`);
    return match;
  }

  private findMarket(marketId: string): SimMarket {
    for (const match of this.matches.values())
      for (const market of match.markets) if (market.marketId === marketId) return market;
    throw new Error(`Mercado simulado desconocido: ${marketId}`);
  }

  private findSelection(selectionId: string): SimMarket['selections'][number] {
    for (const match of this.matches.values())
      for (const market of match.markets)
        for (const s of market.selections) if (s.selectionId === selectionId) return s;
    throw new Error(`Selección simulada desconocida: ${selectionId}`);
  }
}
