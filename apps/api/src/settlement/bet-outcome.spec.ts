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
