import { APP_VERSION } from '@apuestas/shared';

describe('Shared package integration', () => {
  it('should export APP_VERSION', () => {
    expect(APP_VERSION).toBe('0.1.0');
  });
});
