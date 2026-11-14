import { oddsToString, parseOdds } from '@apuestas/shared';
import { applyBoost, displayTotalOdds, potentialPayout, totalOddsX, VOID_ODDS } from './odds';

// shared no tiene runner de pruebas propio; parseOdds/oddsToString se prueban aquí, donde se usan.
describe('parseOdds / oddsToString', () => {
  it.each([
    ['2.10', 210],
    ['1.01', 101],
    ['2', 200],
    ['1.5', 150],
    ['9999.99', 999999],
  ])('parseOdds(%s) = %d', (input, hundredths) => {
    expect(parseOdds(input)).toBe(hundredths);
    expect(oddsToString(hundredths)).toBe(
      input.includes('.') ? input.padEnd(input.indexOf('.') + 3, '0') : `${input}.00`,
    );
  });

  it.each(['1.00', '1', '0.5', '-2', '2.105', '2,10', '02.10', '', 'abc', '10000'])(
    'rechaza %p',
    (input) => {
      expect(() => parseOdds(input)).toThrow(RangeError);
    },
  );
});

describe('cálculo de cuotas y pagos', () => {
  it('apuesta simple: 10.00 a 2.10 paga 21.00', () => {
    expect(potentialPayout(1000, [210])).toBe(2100);
    expect(displayTotalOdds([210])).toBe(210);
  });

  it('combinada 1.50 × 2.00 × 1.80 = 5.40: 10.00 paga 54.00', () => {
    expect(totalOddsX([150, 200, 180])).toBe(5_400_000n);
    expect(displayTotalOdds([150, 200, 180])).toBe(540);
    expect(potentialPayout(1000, [150, 200, 180])).toBe(5400);
  });

  it('una selección anulada cuenta como 1.00', () => {
    expect(VOID_ODDS).toBe(100);
    expect(potentialPayout(1000, [150, VOID_ODDS, 180])).toBe(2700);
  });

  it('todas anuladas devuelve el monto', () => {
    expect(potentialPayout(1000, [VOID_ODDS, VOID_ODDS])).toBe(1000);
  });

  it('redondea hacia abajo al centavo: nunca paga de más', () => {
    // 0.07 × 1.33 = 0.0931 → 0.09
    expect(potentialPayout(7, [133])).toBe(9);
    // 3.33 × 1.11 × 1.11 = 4.102893 → 4.10
    expect(potentialPayout(333, [111, 111])).toBe(410);
  });

  it('la cuota total que se muestra se trunca, el pago usa el producto exacto', () => {
    // 1.33 × 1.33 = 1.7689 → se muestra 1.76
    expect(displayTotalOdds([133, 133])).toBe(176);
    // 100.00 × 1.7689 = 176.89 (no 176.00)
    expect(potentialPayout(10_000, [133, 133])).toBe(17_689);
  });

  it('es exacto con combinadas largas sin perder precisión', () => {
    const tenSelections = Array<number>(10).fill(999_999);
    expect(() => potentialPayout(50, tenSelections)).toThrow(RangeError);
    expect(potentialPayout(100, Array<number>(10).fill(200))).toBe(102_400);
  });

  it('rechaza montos y cuotas inválidos', () => {
    expect(() => potentialPayout(0, [210])).toThrow(RangeError);
    expect(() => potentialPayout(1.5, [210])).toThrow(RangeError);
    expect(() => potentialPayout(100, [])).toThrow(RangeError);
    expect(() => potentialPayout(100, [99])).toThrow(RangeError);
    expect(() => potentialPayout(100, [210.5])).toThrow(RangeError);
  });

  describe('aumento de cuota', () => {
    it('10 % sobre 2.00 = 2.20', () => {
      expect(applyBoost(200, 10)).toBe(220);
    });

    it('redondea el aumento hacia abajo', () => {
      // 1.55 × 10 % = 0.155 → +0.15
      expect(applyBoost(155, 10)).toBe(170);
    });

    it('respeta el tope del aumento', () => {
      // 5.00 × 20 % = +1.00, tope +0.50 → 5.50
      expect(applyBoost(500, 20, 50)).toBe(550);
      expect(applyBoost(200, 10, 50)).toBe(220);
    });

    it('rechaza porcentajes inválidos', () => {
      expect(() => applyBoost(200, 0)).toThrow(RangeError);
      expect(() => applyBoost(200, 101)).toThrow(RangeError);
    });
  });
});
