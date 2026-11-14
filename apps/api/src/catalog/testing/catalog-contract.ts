import type { MatchCatalogPort } from '../match-catalog.port';

/**
 * Datos que la implementación bajo prueba debe tener cargados para la suite. Cada implementación
 * (el catálogo simulado y el de la spec 3) prepara un escenario equivalente y lo describe así.
 */
export interface CatalogContractFixture {
  catalog: MatchCatalogPort;
  /** Selección de un mercado abierto, con su cuota vigente. */
  openSelection: { selectionId: string; marketId: string; matchId: string; odds: number };
  /** Selección de un mercado no abierto (suspendido, cerrado o resuelto). */
  closedSelectionId: string;
  /** Cambia la cuota vigente de una selección (la spec 3 lo hará con su gestión de operador). */
  changeOdds(selectionId: string, odds: number): Promise<void>;
}

/**
 * Suite de contrato de MatchCatalogPort (contracts/match-catalog.md). Se ejecuta dentro de un
 * `describe` de Jest con una factoría que devuelve un escenario limpio para cada prueba.
 */
export function runCatalogContract(setup: () => Promise<CatalogContractFixture>): void {
  let f: CatalogContractFixture;

  beforeEach(async () => {
    f = await setup();
  });

  it('getQuotes devuelve la cuota vigente y los datos del mercado', async () => {
    const [quote] = await f.catalog.getQuotes([f.openSelection.selectionId]);
    expect(quote).toMatchObject({
      selectionId: f.openSelection.selectionId,
      marketId: f.openSelection.marketId,
      matchId: f.openSelection.matchId,
      odds: f.openSelection.odds,
      marketStatus: 'OPEN',
    });
    expect(quote!.startsAt).toBeInstanceOf(Date);
    expect(typeof quote!.liveBettingEnabled).toBe('boolean');
    expect(quote!.labels.match).toBeTruthy();
    expect(quote!.labels.market).toBeTruthy();
    expect(quote!.labels.selection).toBeTruthy();
  });

  it('getQuotes omite las ids desconocidas', async () => {
    const quotes = await f.catalog.getQuotes([f.openSelection.selectionId, 'no-existe']);
    expect(quotes.map((q) => q.selectionId)).toEqual([f.openSelection.selectionId]);
    expect(await f.catalog.getQuotes([])).toEqual([]);
  });

  it('getQuotes refleja un cambio de cuota al instante', async () => {
    await f.changeOdds(f.openSelection.selectionId, f.openSelection.odds + 15);
    const [quote] = await f.catalog.getQuotes([f.openSelection.selectionId]);
    expect(quote!.odds).toBe(f.openSelection.odds + 15);
  });

  it('getQuotes informa el estado de un mercado no abierto', async () => {
    const [quote] = await f.catalog.getQuotes([f.closedSelectionId]);
    expect(quote!.marketStatus).not.toBe('OPEN');
  });

  it('oddsHistory devuelve los cambios dentro del intervalo, en orden', async () => {
    const before = new Date(Date.now() - 1000);
    await f.changeOdds(f.openSelection.selectionId, f.openSelection.odds + 10);
    await f.changeOdds(f.openSelection.selectionId, f.openSelection.odds + 20);
    const after = new Date(Date.now() + 1000);

    const history = await f.catalog.oddsHistory(f.openSelection.selectionId, before, after);
    expect(history.map((p) => p.odds)).toEqual([
      f.openSelection.odds + 10,
      f.openSelection.odds + 20,
    ]);
    expect(await f.catalog.oddsHistory(f.openSelection.selectionId, after, after)).toEqual([]);
  });

  it('listOpenMatches incluye el partido abierto y solo mercados con selecciones', async () => {
    const matches = await f.catalog.listOpenMatches();
    const match = matches.find((m) => m.matchId === f.openSelection.matchId);
    expect(match).toBeDefined();
    const market = match!.markets.find((m) => m.marketId === f.openSelection.marketId);
    expect(market!.status).toBe('OPEN');
    expect(market!.selections.map((s) => s.selectionId)).toContain(f.openSelection.selectionId);
    for (const m of matches) expect(m.markets.some((mk) => mk.status === 'OPEN')).toBe(true);
  });
}
