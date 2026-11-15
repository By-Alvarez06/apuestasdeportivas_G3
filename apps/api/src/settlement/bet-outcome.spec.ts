import { betOutcome } from './bet-outcome';

const sel = (odds: number, status: 'PENDING' | 'WON' | 'LOST' | 'VOID') => ({ odds, status });

describe('betOutcome · apuestas simples (T031)', () => {
  it('ganada: paga monto × cuota congelada', () => {
    expect(betOutcome({ stake: 1000, selections: [sel(210, 'WON')] })).toEqual({
      status: 'WON',
      payout: 2100,
    });
  });

  it('perdida: no paga', () => {
    expect(betOutcome({ stake: 1000, selections: [sel(210, 'LOST')] })).toEqual({
      status: 'LOST',
      payout: 0,
    });
  });

  it('anulada: reembolsa el monto', () => {
    expect(betOutcome({ stake: 1000, selections: [sel(210, 'VOID')] })).toEqual({
      status: 'VOID',
      payout: 1000,
    });
  });

  it('pendiente: sigue abierta', () => {
    expect(betOutcome({ stake: 1000, selections: [sel(210, 'PENDING')] })).toEqual({
      status: 'OPEN',
      payout: 0,
    });
  });

  it('redondea el pago hacia abajo', () => {
    expect(betOutcome({ stake: 7, selections: [sel(133, 'WON')] }).payout).toBe(9);
  });

  it('rechaza una apuesta sin selecciones', () => {
    expect(() => betOutcome({ stake: 1000, selections: [] })).toThrow();
  });
});

describe('betOutcome · combinadas (T042)', () => {
  // Combinada 1.50 × 2.00 × 1.80 = 5.40 con 10.00 apostados.
  const combo = (
    a: Parameters<typeof sel>[1],
    b: Parameters<typeof sel>[1],
    c: Parameters<typeof sel>[1],
  ) => betOutcome({ stake: 1000, selections: [sel(150, a), sel(200, b), sel(180, c)] });

  it('todas ganan: paga monto × producto de cuotas', () => {
    expect(combo('WON', 'WON', 'WON')).toEqual({ status: 'WON', payout: 5400 });
  });

  it('una perdida pierde la combinada aunque queden pendientes', () => {
    expect(combo('LOST', 'PENDING', 'PENDING')).toEqual({ status: 'LOST', payout: 0 });
    expect(combo('WON', 'PENDING', 'LOST')).toEqual({ status: 'LOST', payout: 0 });
  });

  it('con pendientes y sin pérdidas sigue abierta', () => {
    expect(combo('WON', 'PENDING', 'WON')).toEqual({ status: 'OPEN', payout: 0 });
    expect(combo('VOID', 'PENDING', 'WON')).toEqual({ status: 'OPEN', payout: 0 });
  });

  it('una selección anulada cuenta con cuota 1.00', () => {
    // 1.50 × 1.00 × 1.80 = 2.70
    expect(combo('WON', 'VOID', 'WON')).toEqual({ status: 'WON', payout: 2700 });
  });

  it('una anulada y una perdida: perdida', () => {
    expect(combo('VOID', 'LOST', 'WON')).toEqual({ status: 'LOST', payout: 0 });
  });

  it('todas anuladas: reembolsa el monto', () => {
    expect(combo('VOID', 'VOID', 'VOID')).toEqual({ status: 'VOID', payout: 1000 });
  });

  it('todas anuladas menos una ganada: paga como simple', () => {
    expect(combo('VOID', 'WON', 'VOID')).toEqual({ status: 'WON', payout: 2000 });
  });
});
