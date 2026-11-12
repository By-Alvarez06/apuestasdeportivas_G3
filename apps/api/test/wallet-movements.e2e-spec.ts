import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { fromCents, toCents } from '@apuestas/shared';
import type { PrismaClient } from '../src/generated/prisma/client';
import { Role } from '../src/generated/prisma/enums';
import { WalletService } from '../src/wallet/wallet.service';
import { createTestApp, createTestPrisma, resetDatabase, signedInUser } from './setup';

interface Movement {
  id: string;
  type: string;
  account: 'REAL' | 'BONUS' | 'HELD';
  amount: string;
  reference: { type: string; id: string };
  createdAt: string;
}

describe('US2 · Saldos y movimientos (T034, SC-005)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let wallet: WalletService;
  let user: { id: string; cookie: string };

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
    wallet = app.get(WalletService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    user = await signedInUser(app, prisma);
  });

  const get = (path: string, cookie = user.cookie) =>
    request(app.getHttpServer()).get(path).set('Cookie', cookie);

  let seq = 0;
  const key = () => `mov:${++seq}`;
  const ref = { type: 'test', id: '1' };

  it('una billetera nueva muestra 0.00 en todo', async () => {
    const res = await get('/wallet').expect(200);
    expect(res.body).toEqual({ real: '0.00', bonus: '0.00', held: '0.00', currency: 'USD' });
  });

  it('el saldo se reconstruye exacto a partir de los movimientos', async () => {
    const base = { userId: user.id, reference: ref };
    await wallet.credit({ ...base, amount: 10_000, balance: 'REAL', idempotencyKey: key() });
    await wallet.debit({ ...base, amount: 2_345, balance: 'REAL', idempotencyKey: key() });
    await wallet.credit({ ...base, amount: 500, balance: 'BONUS', idempotencyKey: key() });
    await wallet.hold({ ...base, amount: 1_000, idempotencyKey: key() });

    const balances = (await get('/wallet').expect(200)).body;
    expect(balances).toEqual({ real: '66.55', bonus: '5.00', held: '10.00', currency: 'USD' });

    const { items, total } = (await get('/wallet/movements?pageSize=100').expect(200)).body as {
      items: Movement[];
      total: number;
    };
    expect(total).toBe(5); // la retención mueve real → retenido: dos líneas del usuario
    const sum = (account: Movement['account']) =>
      items
        .filter((m) => m.account === account)
        .reduce(
          (acc, m) => acc + Math.sign(Number(m.amount)) * toCents(m.amount.replace('-', '')),
          0,
        );
    expect(fromCents(sum('REAL'))).toBe(balances.real);
    expect(fromCents(sum('BONUS'))).toBe(balances.bonus);
    expect(fromCents(sum('HELD'))).toBe(balances.held);
  });

  it('pagina del más reciente al más antiguo y filtra por tipo', async () => {
    for (let i = 1; i <= 5; i++)
      await wallet.credit({
        userId: user.id,
        amount: i * 100,
        balance: 'REAL',
        idempotencyKey: key(),
        reference: { type: 'test', id: String(i) },
      });
    await wallet.debit({
      userId: user.id,
      amount: 50,
      balance: 'REAL',
      idempotencyKey: key(),
      reference: ref,
    });

    const page1 = (await get('/wallet/movements?page=1&pageSize=2').expect(200)).body;
    expect(page1).toMatchObject({ page: 1, pageSize: 2, total: 6 });
    expect(page1.items.map((m: Movement) => m.amount)).toEqual(['-0.50', '5.00']);

    const page3 = (await get('/wallet/movements?page=3&pageSize=2').expect(200)).body;
    expect(page3.items.map((m: Movement) => m.amount)).toEqual(['2.00', '1.00']);

    const debits = (await get('/wallet/movements?type=BET_DEBIT').expect(200)).body;
    expect(debits.total).toBe(1);
  });

  it('filtra por rango de fechas', async () => {
    await wallet.credit({
      userId: user.id,
      amount: 100,
      balance: 'REAL',
      idempotencyKey: key(),
      reference: ref,
    });
    const future = new Date(Date.now() + 60_000).toISOString();
    expect((await get(`/wallet/movements?from=${future}`).expect(200)).body.total).toBe(0);
    expect((await get(`/wallet/movements?to=${future}`).expect(200)).body.total).toBe(1);
  });

  it('valida los parámetros de consulta', async () => {
    await get('/wallet/movements?pageSize=1000').expect(400);
    await get('/wallet/movements?type=INVENTADO').expect(400);
    await get('/wallet/movements?from=ayer').expect(400);
  });

  it('cada usuario solo ve su billetera', async () => {
    const other = await signedInUser(app, prisma);
    await wallet.credit({
      userId: other.id,
      amount: 999,
      balance: 'REAL',
      idempotencyKey: key(),
      reference: ref,
    });
    expect((await get('/wallet').expect(200)).body.real).toBe('0.00');
    expect((await get('/wallet/movements').expect(200)).body.total).toBe(0);
  });

  it('solo los apostadores tienen billetera', async () => {
    const admin = await signedInUser(app, prisma, { role: Role.ADMIN });
    await get('/wallet', admin.cookie).expect(403);
    await request(app.getHttpServer()).get('/wallet').expect(401);
  });
});
