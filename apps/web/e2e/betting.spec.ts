import type { Server } from 'node:http';
import { type APIRequestContext, expect, request, test } from '@playwright/test';
import { linkFromLastMail } from './mailpit';
import { startPayphoneMock } from './payphone-mock';

// US1 + US2 de punta a punta (T041): depositar → apostar → el resultado llega en vivo, sin recargar,
// en menos de 5 s (SC-004). El resultado lo publica un operador con el catálogo simulado.
try {
  process.loadEnvFile('../../.env');
} catch {
  // en CI las variables vienen del entorno
}

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
let payphone: Server;
let operator: APIRequestContext;

test.beforeAll(async () => {
  payphone = await startPayphoneMock();
  // El administrador del seed actúa como operador del catálogo simulado.
  operator = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const login = await operator.post('/api/auth/login', {
    data: {
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
      captchaToken: 'XXXX.DUMMY.TOKEN.XXXX',
    },
  });
  expect(login.status(), 'el administrador del seed debe poder iniciar sesión').toBe(204);
  expect((await operator.post('/api/dev/catalog/reset')).status()).toBe(204);
});

test.afterAll(async () => {
  payphone.close();
  await operator.dispose();
});

test('el apostador ve su apuesta ganada y su saldo nuevo sin recargar', async ({ page }) => {
  const email = `bet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'clave-e2e-segura-72';

  await page.goto('/registro');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByLabel('Fecha de nacimiento').fill('1990-02-02');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();
  const link = new URL(await linkFromLastMail(email));
  await page.goto(`${link.pathname}${link.search}`);
  await expect(page.getByRole('heading', { name: 'Cuenta activada' })).toBeVisible();

  await page.goto('/ingresar');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/billetera$/);

  await page.getByRole('link', { name: 'Depositar' }).click();
  await page.getByLabel('Monto en USD').fill('25');
  await page.getByRole('button', { name: 'Depositar $25.00' }).click();
  await expect(page.getByText('Depósito acreditado. Ya está en tu saldo.')).toBeVisible();

  // Apostar 10.00 a Barcelona SC (2.10).
  await page.goto('/apuestas');
  await page.getByRole('button', { name: /Barcelona SC\s*2\.10/ }).click();
  await page.getByRole('button', { name: 'Confirmar apuesta de $10.00' }).click();
  await expect(page.getByText(/Apuesta aceptada: \$10\.00 a cuota 2\.10/)).toBeVisible();

  await page.goto('/mis-apuestas');
  await expect(page.getByText('Resultado final — Barcelona SC vs Emelec')).toBeVisible();
  const balance = page.getByRole('link', { name: /Saldo disponible/ });
  await expect(balance).toHaveText(/\$15\.00/);

  // El operador publica el resultado; la página no se recarga.
  const sent = Date.now();
  const published = await operator.post('/api/dev/catalog/events', {
    data: {
      type: 'MARKET_RESULTED',
      sourceEventId: `e2e-${sent}`,
      matchId: 'm1',
      marketId: 'm1-1x2',
      results: { 'm1-1x2-home': 'WON', 'm1-1x2-draw': 'LOST', 'm1-1x2-away': 'LOST' },
    },
  });
  expect(published.status()).toBe(202);

  await expect(page.getByText('Tu apuesta a Barcelona SC ganó: cobraste $21.00.')).toBeVisible({
    timeout: 5000,
  });
  await expect(balance).toHaveText(/\$36\.00/, { timeout: 5000 });
  const latencyMs = Date.now() - sent;
  test
    .info()
    .annotations.push({ type: 'latencia resultado → pantalla', description: `${latencyMs} ms` });
  expect(latencyMs).toBeLessThan(5000);
});
