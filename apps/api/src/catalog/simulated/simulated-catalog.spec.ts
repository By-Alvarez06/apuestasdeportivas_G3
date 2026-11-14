import { runCatalogContract } from '../testing/catalog-contract';
import { SimulatedCatalog } from './simulated-catalog';

describe('SimulatedCatalog cumple el contrato de MatchCatalogPort', () => {
  runCatalogContract(() => {
    const catalog = new SimulatedCatalog();
    return Promise.resolve({
      catalog,
      openSelection: { selectionId: 'm1-1x2-home', marketId: 'm1-1x2', matchId: 'm1', odds: 210 },
      closedSelectionId: 'm2-first-goal-home',
      changeOdds: (selectionId, odds) => Promise.resolve(catalog.setOdds(selectionId, odds)),
    });
  });
});

describe('SimulatedCatalog', () => {
  const t0 = new Date('2026-11-14T12:00:00Z');
  let catalog: SimulatedCatalog;

  beforeEach(() => {
    catalog = new SimulatedCatalog(() => t0);
  });

  it('calcula las horas de inicio relativas al arranque', async () => {
    const [m1, m3] = await catalog.getQuotes(['m1-1x2-home', 'm3-1x2-home']);
    expect(m1!.startsAt.toISOString()).toBe('2026-11-14T14:00:00.000Z');
    expect(m3!.startsAt.toISOString()).toBe('2026-11-14T11:50:00.000Z');
  });

  it('marca el mercado como resuelto al aplicar un resultado, y anulado si todo es VOID', async () => {
    catalog.applyEvent({
      type: 'MARKET_RESULTED',
      sourceEventId: 'e1',
      matchId: 'm1',
      marketId: 'm1-1x2',
      results: { 'm1-1x2-home': 'WON', 'm1-1x2-draw': 'LOST', 'm1-1x2-away': 'LOST' },
      occurredAt: t0.toISOString(),
    });
    catalog.applyEvent({
      type: 'MARKET_RESULTED',
      sourceEventId: 'e2',
      matchId: 'm1',
      marketId: 'm1-goals',
      results: { 'm1-goals-over': 'VOID', 'm1-goals-under': 'VOID' },
      occurredAt: t0.toISOString(),
    });
    const [result, goals] = await catalog.getQuotes(['m1-1x2-home', 'm1-goals-over']);
    expect(result!.marketStatus).toBe('RESULTED');
    expect(goals!.marketStatus).toBe('VOID');
  });

  it('aplica cambios de estado del partido y lo saca del listado al terminar', async () => {
    catalog.applyEvent({
      type: 'MATCH_STATUS_CHANGED',
      sourceEventId: 'e3',
      matchId: 'm4',
      status: 'CANCELLED',
      scheduledStart: t0.toISOString(),
      occurredAt: t0.toISOString(),
    });
    const ids = (await catalog.listOpenMatches()).map((m) => m.matchId);
    expect(ids).not.toContain('m4');
  });

  it('reset vuelve a los fixtures', async () => {
    catalog.setOdds('m1-1x2-home', 250);
    catalog.reset();
    const [quote] = await catalog.getQuotes(['m1-1x2-home']);
    expect(quote!.odds).toBe(210);
  });

  it('lanza con ids desconocidas al controlarlo', () => {
    expect(() => catalog.setOdds('x', 200)).toThrow(/desconocida/);
    expect(() => catalog.setMarketStatus('x', 'OPEN')).toThrow(/desconocido/);
  });
});
