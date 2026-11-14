import { fromCents, toCents } from '@apuestas/shared';

// shared no tiene runner de pruebas propio; sus helpers de dinero se prueban aquí, donde se usan.
describe('toCents / fromCents', () => {
  it.each([
    ['1', 100],
    ['0.5', 50],
    ['0.05', 5],
    ['20.00', 2000],
    ['1000', 100000],
    ['0.10', 10],
  ])('toCents(%s) = %d', (input, cents) => {
    expect(toCents(input)).toBe(cents);
  });

  it.each(['0', '0.00', '-1', '1.234', '1,00', '01', '.5', '1.', 'abc', '', ' 1', '1e3'])(
    'rechaza %p',
    (input) => {
      expect(() => toCents(input)).toThrow(RangeError);
    },
  );

  it('rechaza montos fuera de rango seguro', () => {
    expect(() => toCents('99999999999999999')).toThrow(RangeError);
  });

  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [1234, '12.34'],
    [-5, '-0.05'],
    [-1234, '-12.34'],
  ])('fromCents(%d) = %s', (cents, text) => {
    expect(fromCents(cents)).toBe(text);
  });

  it('ida y vuelta sin pérdida', () => {
    for (const cents of [1, 99, 100, 101, 123456]) expect(toCents(fromCents(cents))).toBe(cents);
  });

  it('rechaza centavos no enteros', () => {
    expect(() => fromCents(1.5)).toThrow(RangeError);
  });
});
