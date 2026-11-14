import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { BettingSettingsService } from '../src/betting/settings.service';
import type { PrismaClient } from '../src/generated/prisma/client';
import { Role } from '../src/generated/prisma/enums';
import { catalogOf, fund, placeBet, single } from './bets.helpers';
import {
  createTestApp,
  createTestPrisma,
  drainQueues,
  resetDatabase,
  signedInUser,
  WEB_ORIGIN,
} from './setup';

interface SettingView {
  key: string;
  value: number;
  default: number;
  min: number;
  max: number;
  description: string;
}

describe('US1 · Ajustes de apuestas para operadores (T026, FR-039)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let operator: { id: string; cookie: string };
  let bettor: { id: string; cookie: string };

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
    operator = await signedInUser(app, prisma, { role: Role.OPERATOR });
    bettor = await signedInUser(app, prisma);
  });

  const put = (key: string, value: unknown, cookie = operator.cookie) =>
    request(app.getHttpServer())
      .put(`/operator/settings/${key}`)
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .send({ value });

  it('operadores y administradores ven todos los ajustes con su rango', async () => {
    const admin = await signedInUser(app, prisma, { role: Role.ADMIN });
    for (const cookie of [operator.cookie, admin.cookie]) {
      const res = await request(app.getHttpServer())
        .get('/operator/settings')
        .set('Cookie', cookie)
        .expect(200);
      const maxStake = (res.body as SettingView[]).find((s) => s.key === 'limits.maxStake');
      expect(maxStake).toEqual({
        key: 'limits.maxStake',
        value: 50_000,
        default: 50_000,
        min: 1,
        max: 10_000_000,
        description: expect.any(String),
      });
    }
  });

  it('un apostador no puede ver ni cambiar ajustes', async () => {
    await request(app.getHttpServer())
      .get('/operator/settings')
      .set('Cookie', bettor.cookie)
      .expect(403);
    await put('limits.maxStake', 1, bettor.cookie).expect(403);
    expect(await prisma.bettingSetting.count()).toBe(0);
  });

  it('el cambio se audita con valor anterior y nuevo y aplica a la siguiente apuesta', async () => {
    await fund(app, bettor.id, 5000);
    await placeBet(app, bettor.cookie, single('m1-1x2-home', '2.10', '20.00')).expect(201);

    const res = await put('limits.maxStake', 1000).expect(200);
    expect(res.body).toEqual({ key: 'limits.maxStake', value: 1000 });

    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'settings.changed' } });
    expect(log).toMatchObject({
      actorId: operator.id,
      targetId: 'limits.maxStake',
      metadata: { previous: 50_000, value: 1000 },
    });

    const rejected = await placeBet(
      app,
      bettor.cookie,
      single('m1-1x2-home', '2.10', '20.00'),
    ).expect(422);
    expect(rejected.body.error).toMatchObject({
      code: 'STAKE_OUT_OF_LIMITS',
      details: { max: '10.00' },
    });
  });

  it('valida la clave y el valor', async () => {
    await put('limits.inventado', 10).expect(400);
    await put('limits.maxStake', '1000').expect(400);
    await put('limits.maxStake', 0).expect(400);
    await put('limits.minStake', 60_000).expect(400);
    expect(await prisma.bettingSetting.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'settings.changed' } })).toBe(0);
  });
});
