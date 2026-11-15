import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client';
import { Role, UserStatus } from '../src/generated/prisma/enums';
import { createTestApp, createTestPrisma, resetDatabase, signedInUser } from './setup';

describe('Informes operativos (spec 3)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => resetDatabase(prisma));

  it('solo permite que operadores y administradores soliciten informes', async () => {
    const query = '?from=2026-11-14T00%3A00%3A00.000Z&to=2026-11-15T00%3A00%3A00.000Z';
    await request(app.getHttpServer()).get(`/operator/reports/dashboard${query}`).expect(401);

    const bettor = await signedInUser(app, prisma, {
      role: Role.BETTOR,
      status: UserStatus.ACTIVE,
    });
    await request(app.getHttpServer())
      .get(`/operator/reports/dashboard${query}`)
      .set('Cookie', bettor.cookie)
      .expect(403);

    const operator = await signedInUser(app, prisma, {
      role: Role.OPERATOR,
      status: UserStatus.ACTIVE,
    });
    await request(app.getHttpServer())
      .get(`/operator/reports/dashboard${query}`)
      .set('Cookie', operator.cookie)
      .expect(503);
  });
});
