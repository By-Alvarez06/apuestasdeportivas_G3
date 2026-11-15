import type { NestExpressApplication } from '@nestjs/platform-express';
import { BettingSettingsService } from '../src/betting/settings.service';
import type { PrismaClient } from '../src/generated/prisma/client';
import { SettlementProcessor } from '../src/settlement/settlement.processor';
import { SettlementService } from '../src/settlement/settlement.service';
import {
  balances,
  catalogOf,
  fund,
  placeBet,
  processed,
  publish,
  result1x2,
  single,
} from './bets.helpers';
import { createTestApp, createTestPrisma, drainQueues, resetDatabase, signedInUser } from './setup';

describe('US2 · Ningún resultado se pierde ni se paga dos veces (T033, SC-007)', () => {
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
    await drainQueues();
    await resetDatabase(prisma);
    app.get(BettingSettingsService).clearCache();
    catalogOf(app).reset();
    user = await signedInUser(app, prisma);
    await fund(app, user.id, 5000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('los resultados publicados con el worker detenido se liquidan al volver', async () => {
    await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '10.00')).expect(201);
    await placeBet(app, user.cookie, single('m4-1x2-away', '3.60', '10.00')).expect(201);

    const worker = app.get(SettlementProcessor).worker;
    await worker.pause();
    try {
      await publish(app, result1x2('m1', 'home', 'caida-1'));
      await publish(app, result1x2('m4', 'away', 'caida-2'));
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await prisma.matchEvent.count()).toBe(0);
      expect(await prisma.bet.count({ where: { status: 'OPEN' } })).toBe(2);
    } finally {
      worker.resume();
    }

    await processed(prisma, 'caida-1');
    await processed(prisma, 'caida-2');
    expect(await prisma.bet.count({ where: { status: 'WON' } })).toBe(2);
    // 50.00 − 20.00 apostados + 21.00 + 36.00
    expect((await balances(app, user.id)).real).toBe(8700);
  });

  it('un fallo transitorio se reintenta y paga una sola vez', async () => {
    await placeBet(app, user.cookie, single('m1-1x2-home', '2.10', '10.00')).expect(201);
    const settlement = app.get(SettlementService);
    const original = settlement.applyMarketResult.bind(settlement);
    const spy = jest
      .spyOn(settlement, 'applyMarketResult')
      .mockImplementationOnce(() => Promise.reject(new Error('base de datos no disponible')))
      .mockImplementation(original);

    await publish(app, result1x2('m1', 'home', 'reintento-1'));
    await processed(prisma, 'reintento-1');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(await prisma.betSettlement.count()).toBe(1);
    expect((await balances(app, user.id)).real).toBe(6100);
  });
});
