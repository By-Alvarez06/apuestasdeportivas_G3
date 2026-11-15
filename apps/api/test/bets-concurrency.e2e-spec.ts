import type { NestExpressApplication } from '@nestjs/platform-express';
import { BettingSettingsService } from '../src/betting/settings.service';
import type { PrismaClient } from '../src/generated/prisma/client';
import { LedgerTransactionType } from '../src/generated/prisma/enums';
import { balances, type BetView, catalogOf, fund, placeBet, single } from './bets.helpers';
import { createTestApp, createTestPrisma, drainQueues, resetDatabase, signedInUser } from './setup';

describe('US1 · Concurrencia e idempotencia de apuestas (T021, SC-002)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let user: { id: string; cookie: string };

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await drainQueues();
    app.get(BettingSettingsService).clearCache();
    catalogOf(app).reset();
    user = await signedInUser(app, prisma);
  });

  const debits = () =>
    prisma.ledgerTransaction.count({ where: { type: LedgerTransactionType.BET_DEBIT } });

  it('20 apuestas simultáneas de 10.00 sobre 100.00: se aceptan exactamente 10 y el saldo queda en 0', async () => {
    await fund(app, user.id, 10_000);

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '10.00')),
      ),
    );

    expect(responses.filter((r) => r.status === 201)).toHaveLength(10);
    const rejected = responses.filter((r) => r.status !== 201);
    expect(rejected).toHaveLength(10);
    for (const r of rejected) expect(r.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect((await balances(app, user.id)).real).toBe(0);
    expect(await prisma.bet.count()).toBe(10);
    expect(await debits()).toBe(10);
  });

  it('100 apuestas simultáneas dejan el saldo exacto y nunca negativo', async () => {
    await fund(app, user.id, 5000);

    const responses = await Promise.all(
      Array.from({ length: 100 }, () =>
        placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '1.00')),
      ),
    );

    const accepted = responses.filter((r) => r.status === 201).length;
    expect(accepted).toBe(50);
    const { real } = await balances(app, user.id);
    expect(real).toBe(0);
    expect(real).toBeGreaterThanOrEqual(0);
    expect(await prisma.bet.count()).toBe(accepted);
  });

  it('repetir la misma solicitud devuelve la misma apuesta con un solo descuento', async () => {
    await fund(app, user.id, 5000);
    const body = single('m1-1x2-home', '2.10', '10.00');

    const first = await placeBet(app, user.cookie, body, 'misma-clave-001').expect(201);
    const again = await placeBet(app, user.cookie, body, 'misma-clave-001').expect(200);

    expect((again.body as BetView).id).toBe((first.body as BetView).id);
    expect(await prisma.bet.count()).toBe(1);
    expect(await debits()).toBe(1);
    expect((await balances(app, user.id)).real).toBe(4000);
  });

  it('la misma solicitud enviada al mismo tiempo crea una sola apuesta', async () => {
    await fund(app, user.id, 5000);
    const body = single('m1-1x2-home', '2.10', '10.00');

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => placeBet(app, user.cookie, body, 'simultanea-0001')),
    );

    for (const r of responses) expect([200, 201]).toContain(r.status);
    expect(new Set(responses.map((r) => (r.body as BetView).id)).size).toBe(1);
    expect(await debits()).toBe(1);
    expect((await balances(app, user.id)).real).toBe(4000);
  });

  it('la misma clave con otros datos es un conflicto', async () => {
    await fund(app, user.id, 5000);
    await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '10.00'), 'clave-002').expect(
      201,
    );
    const res = await placeBet(
      app,
      user.cookie,
      single('m1-1x2-home', '2.10', '20.00'),
      'clave-002',
    ).expect(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await debits()).toBe(1);
  });

  it('dos usuarios pueden usar la misma clave sin chocar', async () => {
    const other = await signedInUser(app, prisma);
    await fund(app, user.id, 5000);
    await fund(app, other.id, 5000);
    const body = single('m1-1x2-home', '2.10', '10.00');
    await placeBet(app, user.cookie, body, 'compartida-01').expect(201);
    await placeBet(app, other.cookie, body, 'compartida-01').expect(201);
    expect(await prisma.bet.count()).toBe(2);
  });
});
