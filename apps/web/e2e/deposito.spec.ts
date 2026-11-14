import type { Server } from 'node:http';
import { expect, test } from '@playwright/test';
import { linkFromLastMail } from './mailpit';
import { startPayphoneMock } from './payphone-mock';

// US3 de punta a punta con Payphone simulado (T049): depositar → pagar → volver → saldo acreditado.
let payphone: Server;

test.beforeAll(async () => {
  payphone = await startPayphoneMock();
});

test.afterAll(() => {
  payphone.close();
});

test('un apostador deposita 25.00 y el saldo sube una sola vez', async ({ page }) => {
  const email = `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

  // Payphone (simulado) devuelve al navegador a la API, que confirma y redirige al estado del depósito.
  await expect(page).toHaveURL(/\/billetera\/depositos\/[0-9a-f-]+$/);
  await expect(page.getByText('Depósito acreditado. Ya está en tu saldo.')).toBeVisible();

  // Volver a cargar la URL de retorno no acredita dos veces.
  await page.reload();
  await page.goto('/billetera');
  await expect(page.getByText('$25.00').first()).toBeVisible();
  const wallet = await (await page.request.get('/api/wallet')).json();
  expect(wallet.real).toBe('25.00');
});
