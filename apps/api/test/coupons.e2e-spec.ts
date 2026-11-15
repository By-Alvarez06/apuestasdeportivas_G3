import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { BettingSettingsService } from '../src/betting/settings.service';
import type { PrismaClient } from '../src/generated/prisma/client';
import { Role } from '../src/generated/prisma/enums';
import { catalogOf } from './bets.helpers';
import { createCoupon, creditedDeposit, redeem } from './promotions.helpers';
import {
  createTestApp,
  createTestPrisma,
  drainQueues,
  resetDatabase,
  signedInUser,
  WEB_ORIGIN,
} from './setup';

const DAY = 24 * 3_600_000;

describe('US5 · Cupones: creación, canje y anti-abuso (T053)', () => {
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
    await drainQueues();
    await resetDatabase(prisma);
    app.get(BettingSettingsService).clearCache();
    catalogOf(app).reset();
    operator = await signedInUser(app, prisma, { role: Role.OPERATOR });
    bettor = await signedInUser(app, prisma);
  });

  const freeBet = (code = 'GRATIS5') =>
    createCoupon(app, operator.cookie, { code, type: 'FREE_BET', amount: '5.00' });

  /** Cupón insertado directo (vigencias en el pasado o cupos agotados que la API no deja crear). */
  const rawCoupon = (data: {
    code: string;
    startsAt: Date;
    endsAt: Date;
    totalLimit?: number;
    redeemed?: number;
  }) =>
    prisma.coupon.create({
      data: {
        type: 'FREE_BET',
        value: 500,
        totalLimit: 10,
        createdById: operator.id,
        ...data,
      },
    });

  describe('gestión del operador', () => {
    it('crea un cupón, lo normaliza a mayúsculas y lo audita', async () => {
      const res = await createCoupon(app, operator.cookie, {
        code: 'bienvenida50',
        type: 'DEPOSIT_BONUS',
        percent: 50,
        maxBonus: '20.00',
      }).expect(201);
      expect(res.body).toMatchObject({
        code: 'BIENVENIDA50',
        type: 'DEPOSIT_BONUS',
        percent: 50,
        maxBonus: '20.00',
        totalLimit: 100,
        perUserLimit: 1,
        redeemed: 0,
        status: 'ACTIVE',
      });
      expect(
        await prisma.auditLog.count({ where: { action: 'coupon.created', actorId: operator.id } }),
      ).toBe(1);
    });

    it('un apostador no puede crear, listar ni pausar cupones', async () => {
      await createCoupon(app, bettor.cookie, {
        code: 'NOPE01',
        type: 'FREE_BET',
        amount: '5.00',
      }).expect(403);
      await request(app.getHttpServer())
        .get('/operator/coupons')
        .set('Cookie', bettor.cookie)
        .expect(403);
    });

    it('valida el cupón según su tipo', async () => {
      const bad = [
        { code: 'AB', type: 'FREE_BET', amount: '5.00' },
        { code: 'SIN-GUION', type: 'FREE_BET', amount: '5.00' },
        { code: 'BONO01', type: 'DEPOSIT_BONUS', percent: 50 },
        { code: 'BONO02', type: 'DEPOSIT_BONUS', percent: 150, maxBonus: '20.00' },
        { code: 'GRATIS1', type: 'FREE_BET' },
        { code: 'BOOST1', type: 'ODDS_BOOST', percent: 0 },
        {
          code: 'FECHAS1',
          type: 'FREE_BET',
          amount: '5.00',
          startsAt: new Date(Date.now() + DAY).toISOString(),
          endsAt: new Date().toISOString(),
        },
      ] as const;
      for (const body of bad) await createCoupon(app, operator.cookie, body).expect(400);
      expect(await prisma.coupon.count()).toBe(0);
    });

    it('no permite códigos repetidos ni editar un cupón', async () => {
      const { body } = await freeBet().expect(201);
      await freeBet().expect(409);
      for (const method of ['put', 'patch'] as const) {
        const agent = request(app.getHttpServer());
        await agent[method](`/operator/coupons/${body.id}`)
          .set('Cookie', operator.cookie)
          .set('Origin', WEB_ORIGIN)
          .send({ amount: '50.00' })
          .expect(404);
      }
    });

    it('pausa y reanuda, con auditoría', async () => {
      const { body } = await freeBet().expect(201);
      const post = (path: string) =>
        request(app.getHttpServer())
          .post(path)
          .set('Cookie', operator.cookie)
          .set('Origin', WEB_ORIGIN);

      await post(`/operator/coupons/${body.id}/pause`).expect(200);
      const paused = await redeem(app, bettor.cookie, 'GRATIS5').expect(422);
      expect(paused.body.error).toMatchObject({
        code: 'COUPON_INVALID',
        details: { reason: 'PAUSED' },
      });

      await post(`/operator/coupons/${body.id}/resume`).expect(200);
      await redeem(app, bettor.cookie, 'GRATIS5').expect(201);

      const actions = await prisma.auditLog.findMany({
        where: { action: { in: ['coupon.paused', 'coupon.resumed'] } },
      });
      expect(actions).toHaveLength(2);

      const list = await request(app.getHttpServer())
        .get('/operator/coupons')
        .set('Cookie', operator.cookie)
        .expect(200);
      expect(list.body[0]).toMatchObject({ code: 'GRATIS5', redeemed: 1, status: 'ACTIVE' });
    });
  });

  describe('canje', () => {
    it('canjea una apuesta gratis y la deja disponible', async () => {
      await freeBet().expect(201);
      const res = await redeem(app, bettor.cookie, 'gratis5').expect(201);
      expect(res.body).toMatchObject({
        type: 'FREE_BET',
        status: 'AVAILABLE',
        freeBet: { id: expect.any(String), amount: '5.00', expiresAt: expect.any(String) },
      });
      expect(await prisma.auditLog.count({ where: { action: 'coupon.redeemed' } })).toBe(1);
    });

    it('explica por qué un código no sirve: inexistente, vencido, aún no vigente, agotado', async () => {
      await rawCoupon({
        code: 'VENCIDO1',
        startsAt: new Date(Date.now() - 2 * DAY),
        endsAt: new Date(Date.now() - DAY),
      });
      await rawCoupon({
        code: 'FUTURO1',
        startsAt: new Date(Date.now() + DAY),
        endsAt: new Date(Date.now() + 2 * DAY),
      });
      await rawCoupon({
        code: 'AGOTADO1',
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + DAY),
        totalLimit: 1,
        redeemed: 1,
      });

      for (const [code, reason] of [
        ['NOEXISTE', 'NOT_FOUND'],
        ['VENCIDO1', 'EXPIRED'],
        ['FUTURO1', 'NOT_STARTED'],
        ['AGOTADO1', 'EXHAUSTED'],
      ] as const) {
        const res = await redeem(app, bettor.cookie, code).expect(422);
        expect(res.body.error).toMatchObject({ code: 'COUPON_INVALID', details: { reason } });
      }
    });

    it('el mismo usuario no lo canjea dos veces y el intento se audita', async () => {
      await freeBet().expect(201);
      await redeem(app, bettor.cookie, 'GRATIS5').expect(201);
      const again = await redeem(app, bettor.cookie, 'GRATIS5').expect(409);
      expect(again.body.error.code).toBe('COUPON_ALREADY_USED');
      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'coupon.redeem.rejected' },
      });
      expect(log).toMatchObject({
        actorId: bettor.id,
        metadata: expect.objectContaining({ reason: 'USER' }),
      });
    });

    it('otra cuenta desde el mismo navegador no lo puede canjear', async () => {
      await freeBet().expect(201);
      const device = 'device_id=0b8f4c3e-2a8f-4a8e-9d43-5f2c3a1b7e90';
      await redeem(app, `${bettor.cookie}; ${device}`, 'GRATIS5').expect(201);
      const other = await signedInUser(app, prisma);
      const res = await redeem(app, `${other.cookie}; ${device}`, 'GRATIS5').expect(409);
      expect(res.body.error.code).toBe('COUPON_ALREADY_USED');
    });

    it('otra cuenta con el mismo titular de pago no lo puede canjear', async () => {
      await freeBet().expect(201);
      const other = await signedInUser(app, prisma);
      await creditedDeposit(prisma, bettor.id, 2000);
      await creditedDeposit(prisma, other.id, 2000);
      await redeem(app, bettor.cookie, 'GRATIS5').expect(201);
      const res = await redeem(app, other.cookie, 'GRATIS5').expect(409);
      expect(res.body.error.code).toBe('COUPON_ALREADY_USED');
      expect(
        await prisma.auditLog.count({
          where: {
            action: 'coupon.redeem.rejected',
            metadata: { path: ['reason'], equals: 'PAYER' },
          },
        }),
      ).toBe(1);
    });

    it('con 150 canjes simultáneos y cupo de 100 acepta exactamente 100 (SC-008)', async () => {
      await createCoupon(app, operator.cookie, {
        code: 'CIENTO',
        type: 'FREE_BET',
        amount: '1.00',
        totalLimit: 100,
      }).expect(201);
      const users = await Promise.all(Array.from({ length: 150 }, () => signedInUser(app, prisma)));

      const responses = await Promise.all(users.map((u) => redeem(app, u.cookie, 'CIENTO')));

      expect(responses.filter((r) => r.status === 201)).toHaveLength(100);
      const rejected = responses.filter((r) => r.status !== 201);
      expect(rejected).toHaveLength(50);
      for (const r of rejected)
        expect(r.body.error).toMatchObject({
          code: 'COUPON_INVALID',
          details: { reason: 'EXHAUSTED' },
        });
      expect(await prisma.coupon.findUniqueOrThrow({ where: { code: 'CIENTO' } })).toMatchObject({
        redeemed: 100,
      });
      expect(await prisma.couponRedemption.count()).toBe(100);
    });

    it('un operador no canjea cupones', async () => {
      await freeBet().expect(201);
      await redeem(app, operator.cookie, 'GRATIS5').expect(403);
    });
  });
});
