import { safeReturn } from '@/lib/safe-return';

describe('safeReturn', () => {
  const origin = 'http://localhost:3000';

  it.each([
    ['/billetera', '/billetera'],
    ['/admin/usuarios?page=2#x', '/admin/usuarios?page=2#x'],
    ['billetera', '/billetera'],
  ])('acepta la ruta interna %p', (value, expected) => {
    expect(safeReturn(value, origin)).toBe(expected);
  });

  it.each([
    '/\\example.org',
    '//example.org',
    '\\\\example.org',
    'https://example.org/billetera',
    'javascript:alert(1)',
    '/\t/example.org',
  ])('rechaza el destino externo %p', (value) => {
    expect(safeReturn(value, origin)).toBeNull();
  });

  it('sin valor devuelve null', () => {
    expect(safeReturn(null, origin)).toBeNull();
  });
});
