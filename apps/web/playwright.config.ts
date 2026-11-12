import { defineConfig, devices } from '@playwright/test';

// E2E contra la pila completa local: API (3001), web y Mailpit (8025). Si ya están corriendo se reutilizan.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const webPort = new URL(baseURL).port || '3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] } },
    { name: 'movil', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @apuestas/api dev',
      url: 'http://localhost:3001/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `pnpm exec next dev --port ${webPort}`,
      url: baseURL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
