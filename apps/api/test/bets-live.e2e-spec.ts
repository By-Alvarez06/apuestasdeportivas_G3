import type { NestExpressApplication } from '@nestjs/platform-express';
import { BettingSettingsService } from '../src/betting/settings.service';
import type { PrismaClient } from '../src/generated/prisma/client';
import {
  balances,
  type BetView,
  catalogOf,
  fund,
  placeBet,
  setSetting,
  single,
} from './bets.helpers';
import { createTestApp, createTestPrisma, drainQueues, resetDatabase, signedInUser } from './setup';

const DELAY_MS = 300;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('US1 · Apuestas en vivo con retardo de aceptación (T022, FR-007)', () => {
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
    await setSetting(app, 'live.delayMs', DELAY_MS);
    user = await signedInUser(app, prisma);
    await fund(app, user.id, 5000);
  });

  // m2 está en vivo y su mercado m2-1x2 está habilitado para apuestas en vivo.
  const liveBet = () => placeBet(app, user.cookie, single('m2-1x2-home', '1.75', '10.00'));

  it('acepta la apuesta en vivo después del retardo', async () => {
    const started = Date.now();
    const res = await liveBet().expect(201);
    expect(Date.now() - started).toBeGreaterThanOrEqual(DELAY_MS);
    expect((res.body as BetView).live).toBe(true);
    expect((await balances(app, user.id)).real).toBe(4000);
  });

  it('si la cuota cambia durante el retardo, rechaza sin mover dinero', async () => {
    const pending = liveBet();
    await sleep(DELAY_MS / 3);
    catalogOf(app).setOdds('m2-1x2-home', 160);

    const res = await pending.expect(409);
    expect(res.body.error).toMatchObject({
      code: 'ODDS_CHANGED',
      details: { quotes: [{ selectionId: 'm2-1x2-home', odds: '1.60' }] },
    });
    expect(await prisma.bet.count()).toBe(0);
    expect((await balances(app, user.id)).real).toBe(5000);
  });

  it('si el mercado se suspende durante el retardo, rechaza sin mover dinero', async () => {
    const pending = liveBet();
    await sleep(DELAY_MS / 3);
    catalogOf(app).setMarketStatus('m2-1x2', 'SUSPENDED');

    const res = await pending.expect(409);
    expect(res.body.error.code).toBe('MARKET_CLOSED');
    expect(await prisma.bet.count()).toBe(0);
    expect((await balances(app, user.id)).real).toBe(5000);
  });

  it('no acepta apuestas en vivo en mercados no habilitados para ello', async () => {
    // m3 ya empezó y su mercado no está habilitado en vivo.
    const res = await placeBet(app, user.cookie, single('m3-1x2-home', '1.90', '10.00')).expect(
      409,
    );
    expect(res.body.error.code).toBe('MATCH_STARTED');
  });
});
