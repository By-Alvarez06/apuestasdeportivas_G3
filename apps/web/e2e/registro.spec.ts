import { expect, test } from '@playwright/test';
import { linkFromLastMail } from './mailpit';

// US1 de punta a punta: registro → correo → activación → inicio de sesión (T031).
test('una persona se registra, activa su correo e inicia sesión', async ({ page }) => {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'clave-e2e-segura-71';

  await page.goto('/registro');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByLabel('Fecha de nacimiento').fill('1994-08-20');
  // El botón se habilita cuando Turnstile (clave de prueba) entrega su token.
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();

  const link = new URL(await linkFromLastMail(email));
  await page.goto(`${link.pathname}${link.search}`);
  await expect(page.getByRole('heading', { name: 'Cuenta activada' })).toBeVisible();

  await page.getByRole('link', { name: 'Iniciar sesión' }).click();
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/billetera$/);

  const me = await page.request.get('/api/auth/me');
  expect(me.status()).toBe(200);
  expect(await me.json()).toMatchObject({ email, status: 'ACTIVE' });
});

test('una contraseña incorrecta muestra un error claro', async ({ page }) => {
  await page.goto('/ingresar');
  await page.getByLabel('Correo').fill(`nadie-${Date.now()}@example.com`);
  await page.getByLabel('Contraseña').fill('no-es-la-clave-1');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('form').getByRole('alert')).toHaveText(
    'Correo o contraseña incorrectos.',
  );
});
