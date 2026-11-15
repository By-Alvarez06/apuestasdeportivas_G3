import { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '../src/generated/prisma/client';
import {
  DailyBudgetExceededError,
  DailyBudgetUnavailableError,
  FootballBudgetService,
} from '../src/matches/football-budget';
import { createTestPrisma, resetDatabase } from './setup';

describe('Presupuesto diario de API-Football', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => resetDatabase(prisma));

  it('reserva las peticiones de forma atómica incluso con varios workers concurrentes', async () => {
    const budget = new FootballBudgetService(
      prisma,
      new ConfigService({
        API_FOOTBALL_KEY: 'test-key',
        API_FOOTBALL_DAILY_BUDGET: '7',
      }),
    );

    const attempts = await Promise.allSettled(Array.from({ length: 20 }, () => budget.reserve()));
    const reserved = attempts.filter((result) => result.status === 'fulfilled');
    const rejected = attempts.filter(
      (result) => result.status === 'rejected' && result.reason instanceof DailyBudgetExceededError,
    );
    const status = await budget.status();

    expect(reserved).toHaveLength(7);
    expect(rejected).toHaveLength(13);
    expect(status).toMatchObject({ enabled: false, reason: 'exhausted', limit: 7, consumed: 7 });
    expect(status.resetsAt).toMatch(/T00:00:00\.000Z$/);
  });

  it('no reserva peticiones si falta presupuesto o clave', async () => {
    const missingBudget = new FootballBudgetService(
      prisma,
      new ConfigService({ API_FOOTBALL_KEY: 'test-key' }),
    );
    await expect(missingBudget.reserve()).rejects.toThrow(DailyBudgetUnavailableError);

    const configuredKey = process.env.API_FOOTBALL_KEY;
    delete process.env.API_FOOTBALL_KEY;
    try {
      const missingKey = new FootballBudgetService(
        prisma,
        new ConfigService({ API_FOOTBALL_DAILY_BUDGET: '10' }),
      );
      await expect(missingKey.reserve()).rejects.toThrow(DailyBudgetUnavailableError);
    } finally {
      if (configuredKey) process.env.API_FOOTBALL_KEY = configuredKey;
    }
    expect(await prisma.apiRequestBudget.count()).toBe(0);
  });

  it('un presupuesto reducido durante el día no permite superar el límite menor', async () => {
    const original = new FootballBudgetService(
      prisma,
      new ConfigService({
        API_FOOTBALL_KEY: 'test-key',
        API_FOOTBALL_DAILY_BUDGET: '9',
      }),
    );
    await original.reserve();
    await original.reserve();

    const reduced = new FootballBudgetService(
      prisma,
      new ConfigService({
        API_FOOTBALL_KEY: 'test-key',
        API_FOOTBALL_DAILY_BUDGET: '3',
      }),
    );
    await reduced.reserve();
    await expect(reduced.reserve()).rejects.toThrow(DailyBudgetExceededError);
    expect(await reduced.status()).toMatchObject({ limit: 3, consumed: 3, remaining: 0 });
  });
});
