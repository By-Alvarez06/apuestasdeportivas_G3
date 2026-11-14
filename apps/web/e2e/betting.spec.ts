import type { Server } from 'node:http';
import { type APIRequestContext, expect, type Page, request, test } from '@playwright/test';
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

/** Registra, verifica, inicia sesión y deposita 25.00 con el Payphone simulado. */
async function newBettorWith25(page: Page): Promise<void> {
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
}

test('el apostador ve su apuesta ganada y su saldo nuevo sin recargar', async ({ page }) => {
  await newBettorWith25(page);

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

test('arma una combinada: suma partidos, reemplaza el del mismo partido y la confirma', async ({
  page,
}) => {
  await newBettorWith25(page);
  await page.goto('/apuestas');

  await page.getByRole('button', { name: /Orense\s*2\.00/ }).click();
  await page.getByRole('button', { name: /Macará\s*1\.80/ }).click();
  const slip = page.getByRole('complementary', { name: 'Tu boleto' });
  await expect(slip.getByText('Combinada de 2')).toBeVisible();
  await expect(slip.getByText('Cuota total')).toContainText('3.60');

  // Otra cuota del mismo partido reemplaza a la anterior.
  await page.getByRole('button', { name: /Delfín\s*3\.60/ }).click();
  await expect(page.getByText(/Cambiamos Orense por Delfín/)).toBeVisible();
  await expect(slip.getByText('Cuota total')).toContainText('6.48');

  await slip.getByRole('button', { name: 'Confirmar apuesta de $10.00' }).click();
  await expect(
    page.getByText(/Apuesta aceptada: \$10\.00 a cuota 6\.48\. Si gana cobras \$64\.80/),
  ).toBeVisible();

  await page.goto('/mis-apuestas');
  await expect(page.getByText('Combinada de 2')).toBeVisible();
});

test('una apuesta sobre un partido suspendido se ve en espera con su plazo', async ({ page }) => {
  await newBettorWith25(page);
  await page.goto('/apuestas');
  await page.getByRole('button', { name: /Macará\s*1\.80/ }).click();
  await page.getByRole('button', { name: 'Confirmar apuesta de $10.00' }).click();
  await expect(page.getByText(/Apuesta aceptada/)).toBeVisible();

  const suspended = await operator.post('/api/dev/catalog/events', {
    data: {
      type: 'MATCH_STATUS_CHANGED',
      sourceEventId: `e2e-susp-${Date.now()}`,
      matchId: 'm5',
      status: 'SUSPENDED',
      scheduledStart: new Date(Date.now() + 27 * 3_600_000).toISOString(),
    },
  });
  expect(suspended.status()).toBe(202);

  await expect(async () => {
    await page.goto('/mis-apuestas');
    await expect(page.getByText(/Partido suspendido: si no se juega antes del/)).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 10_000 });
  await expect(page.getByText(/te devolvemos el monto/)).toBeVisible();

  // Reanudado: deja de estar en espera.
  await operator.post('/api/dev/catalog/events', {
    data: {
      type: 'MATCH_STATUS_CHANGED',
      sourceEventId: `e2e-resume-${Date.now()}`,
      matchId: 'm5',
      status: 'SCHEDULED',
      scheduledStart: new Date(Date.now() + 27 * 3_600_000).toISOString(),
    },
  });
});

test('canjea una apuesta gratis y la usa sin tocar su saldo', async ({ page }) => {
  const code = `GRATIS${Date.now() % 100_000_000}`;
  const created = await operator.post('/api/operator/coupons', {
    data: {
      code,
      type: 'FREE_BET',
      amount: '5.00',
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
      totalLimit: 10,
    },
  });
  expect(created.status()).toBe(201);

  await newBettorWith25(page);
  await page.goto('/promociones');
  await page.getByLabel('Código de promoción').fill(code.toLowerCase());
  await page.getByRole('button', { name: 'Canjear código' }).click();
  await expect(page.getByText(/Tu apuesta gratis ya está disponible/)).toBeVisible();
  await expect(page.getByText('Apuesta gratis de $5.00')).toBeVisible();

  await page.goto('/apuestas');
  await page.getByRole('button', { name: /Orense\s*2\.00/ }).click();
  const slip = page.getByRole('complementary', { name: 'Tu boleto' });
  await slip.getByLabel(/Apuesta gratis \$5\.00/).check();
  await expect(slip.getByText('Si gana, recibes en tu bono')).toBeVisible();
  await expect(slip.getByText('$5.00', { exact: true }).last()).toBeVisible();
  await slip.getByRole('button', { name: 'Confirmar apuesta gratis de $5.00' }).click();
  await expect(page.getByText(/Apuesta aceptada: \$5\.00 a cuota 2\.00/)).toBeVisible();
  // No se descontó nada del saldo.
  await expect(page.getByRole('link', { name: /Saldo disponible/ })).toHaveText(/\$25\.00/);
});
