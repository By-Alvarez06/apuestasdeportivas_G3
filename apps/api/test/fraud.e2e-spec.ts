import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { BettingSettingsService } from '../src/betting/settings.service';
import { FraudService } from '../src/fraud/fraud.service';
import type { PrismaClient } from '../src/generated/prisma/client';
import { Role } from '../src/generated/prisma/enums';
import {
  catalogOf,
  correction1x2,
  fund,
  placeBet,
  processed,
  publish,
  result1x2,
  single,
  waitFor,
} from './bets.helpers';
import { createCoupon, creditedDeposit, redeem } from './promotions.helpers';
import {
  createTestApp,
  createTestPrisma,
  drainQueues,
  resetDatabase,
  signedInUser,
  WEB_ORIGIN,
} from './setup';

const DEVICE = 'device_id=7d1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b';

describe('US6 · Detección de fraude y alertas (T063, SC-009)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fraud: FraudService;
  let admin: { id: string; cookie: string };

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
    fraud = app.get(FraudService);
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
    admin = await signedInUser(app, prisma, { role: Role.ADMIN });
  });

  const bettor = async (cents = 10_000) => {
    const u = await signedInUser(app, prisma);
    await fund(app, u.id, cents);
    return u;
  };

  const alertsOf = (rule: string) => prisma.fraudAlert.findMany({ where: { rule: rule as never } });
  const waitAlert = (rule: string) =>
    waitFor(async () => (await alertsOf(rule)).length > 0 && (await alertsOf(rule)));

  describe('reglas', () => {
    it('cuentas múltiples en el mismo dispositivo: alerta alta deduplicada', async () => {
      const users = await Promise.all([bettor(), bettor(), bettor()]);
      for (const u of users)
        await placeBet(app, `${u.cookie}; ${DEVICE}`, single('m1-1x2-home', '2.10', '1.00')).expect(
          201,
        );
      const [alert] = await waitAlert('MULTI_ACCOUNT');
      expect(alert).toMatchObject({
        severity: 'HIGH',
        subjectKey: 'device:7d1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b',
        status: 'OPEN',
      });
      expect([...alert!.userIds].sort()).toEqual(users.map((u) => u.id).sort());

      // Más actividad del mismo dispositivo no abre otra alerta.
      await placeBet(app, `${users[0]!.cookie}; ${DEVICE}`, single('m4-1x2-home', '2.00', '1.00'));
      await fraud.sweep();
      expect(await alertsOf('MULTI_ACCOUNT')).toHaveLength(1);
      // Cada alerta creada se audita una vez (aquí también hay apuestas espejo: misma selección).
      expect(await prisma.auditLog.count({ where: { action: 'fraud.alert.created' } })).toBe(
        await prisma.fraudAlert.count(),
      );
      expect(await alertsOf('MIRROR_BETS')).toHaveLength(1);
    });

    it('cuentas múltiples con el mismo titular de pago', async () => {
      const users = await Promise.all([bettor(), bettor(), bettor()]);
      for (const u of users) await creditedDeposit(prisma, u.id, 2000);
      await fraud.sweep();
      const [alert] = await alertsOf('MULTI_ACCOUNT');
      expect(alert).toMatchObject({
        severity: 'HIGH',
        subjectKey: expect.stringMatching(/^payer:/),
      });
    });

    it('monto anómalo frente al historial del usuario', async () => {
      const u = await bettor(20_000);
      for (let i = 0; i < 4; i++)
        await placeBet(app, u.cookie, single('m1-1x2-home', '2.10', '1.00')).expect(201);
      await placeBet(app, u.cookie, single('m4-1x2-home', '2.00', '60.00')).expect(201);
      const [alert] = await waitAlert('ANOMALOUS_STAKE');
      expect(alert).toMatchObject({
        severity: 'MEDIUM',
        userIds: [u.id],
        evidence: expect.objectContaining({ stake: 6000, average: 100 }),
      });
    });

    it('apuestas espejo entre cuentas del mismo dispositivo', async () => {
      const [a, b] = await Promise.all([bettor(), bettor()]);
      await placeBet(app, `${a.cookie}; ${DEVICE}`, single('m5-1x2-away', '4.20', '2.00')).expect(
        201,
      );
      await placeBet(app, `${b.cookie}; ${DEVICE}`, single('m5-1x2-away', '4.20', '2.00')).expect(
        201,
      );
      const [alert] = await waitAlert('MIRROR_BETS');
      expect(alert).toMatchObject({ severity: 'HIGH' });
      expect([...alert!.userIds].sort()).toEqual([a.id, b.id].sort());
    });

    it('apuestas seguidas de caídas fuertes de cuota', async () => {
      const u = await bettor();
      const picks = [
        ['m1-1x2-home', '2.10', 150],
        ['m4-1x2-away', '3.60', 250],
        ['m5-1x2-draw', '2.90', 200],
      ] as const;
      for (const [id, odds] of picks)
        await placeBet(app, u.cookie, single(id, odds, '2.00')).expect(201);
      for (const [id, , dropped] of picks) catalogOf(app).setOdds(id, dropped);
      await fraud.sweep();
      const [alert] = await alertsOf('ODDS_DROP_PATTERN');
      expect(alert).toMatchObject({
        userIds: [u.id],
        evidence: expect.objectContaining({ bets: 3 }),
      });
    });

    it('retiro tras un depósito sin apuestas en medio', async () => {
      const u = await bettor();
      const deposit = await creditedDeposit(prisma, u.id, 5000);
      const withdrawal = await prisma.withdrawal.create({
        data: {
          userId: u.id,
          amount: 5000,
          destinationDocument: '0912345678',
          destinationPhone: '0991234567',
          status: 'PENDING_APPROVAL',
        },
      });
      await fraud.sweep();
      const [alert] = await alertsOf('WITHDRAWAL_NO_ACTIVITY');
      expect(alert).toMatchObject({
        severity: 'MEDIUM',
        userIds: [u.id],
        evidence: { withdrawalId: withdrawal.id, depositId: deposit.id },
      });
    });

    it('deuda creada por una re-liquidación', async () => {
      const u = await bettor(1000);
      await placeBet(app, u.cookie, single('m1-1x2-home', '2.10', '10.00')).expect(201);
      const won = result1x2('m1', 'home');
      await publish(app, won);
      await processed(prisma, won.sourceEventId);
      await placeBet(app, u.cookie, single('m4-1x2-home', '2.00', '20.00')).expect(201);
      const fix = correction1x2('m1', 'draw');
      await publish(app, fix);
      await processed(prisma, fix.sourceEventId);

      const [alert] = await waitAlert('RESETTLEMENT_DEBT');
      expect(alert).toMatchObject({
        severity: 'HIGH',
        userIds: [u.id],
        evidence: expect.objectContaining({ amount: 2000 }),
      });
    });

    it('la actividad normal no genera alertas', async () => {
      const [a, b] = await Promise.all([bettor(), bettor()]);
      await creditedDeposit(prisma, a.id, 2000, { document: '0911111111', phone: '0990000001' });
      await creditedDeposit(prisma, b.id, 2000, { document: '0922222222', phone: '0990000002' });
      for (const u of [a, b])
        for (const [id, odds, stake] of [
          ['m1-1x2-home', '2.10', '5.00'],
          ['m4-1x2-draw', '3.00', '3.00'],
          ['m5-1x2-home', '1.80', '6.00'],
          ['m1-goals-over', '1.85', '4.00'],
        ] as const)
          await placeBet(app, u.cookie, single(id, odds, stake)).expect(201);
      await placeBet(app, a.cookie, single('m4-1x2-home', '2.00', '8.00')).expect(201);
      await fraud.sweep();
      // Dejar terminar las revisiones encoladas.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(await prisma.fraudAlert.count()).toBe(0);
    });
  });

  describe('efectos y administración', () => {
    it('con una alerta alta abierta no se canjean cupones', async () => {
      const users = await Promise.all([bettor(), bettor(), bettor()]);
      for (const u of users)
        await placeBet(app, `${u.cookie}; ${DEVICE}`, single('m1-1x2-home', '2.10', '1.00')).expect(
          201,
        );
      await waitAlert('MULTI_ACCOUNT');
      const operator = await signedInUser(app, prisma, { role: Role.OPERATOR });
      await createCoupon(app, operator.cookie, {
        code: 'GRATIS9',
        type: 'FREE_BET',
        amount: '1.00',
      }).expect(201);
      const res = await redeem(app, users[0]!.cookie, 'GRATIS9').expect(423);
      expect(res.body.error.code).toBe('COUPON_BLOCKED');
    });

    it('solo el administrador ve y resuelve alertas; resolver exige motivo y puede suspender', async () => {
      const users = await Promise.all([bettor(), bettor(), bettor()]);
      for (const u of users) await creditedDeposit(prisma, u.id, 2000);
      await fraud.sweep();
      const operator = await signedInUser(app, prisma, { role: Role.OPERATOR });
      for (const cookie of [users[0]!.cookie, operator.cookie])
        await request(app.getHttpServer())
          .get('/admin/fraud-alerts')
          .set('Cookie', cookie)
          .expect(403);

      const list = await request(app.getHttpServer())
        .get('/admin/fraud-alerts?status=OPEN&rule=MULTI_ACCOUNT')
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(list.body).toMatchObject({ total: 1, page: 1 });
      const id = list.body.items[0].id as string;

      const detail = await request(app.getHttpServer())
        .get(`/admin/fraud-alerts/${id}`)
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(detail.body.users).toHaveLength(3);
      expect(detail.body.users[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          email: expect.any(String),
          status: 'ACTIVE',
        }),
      );

      const resolve = (body: object) =>
        request(app.getHttpServer())
          .post(`/admin/fraud-alerts/${id}/resolve`)
          .set('Cookie', admin.cookie)
          .set('Origin', WEB_ORIGIN)
          .send(body);
      await resolve({ decision: 'CONFIRMED' }).expect(400);
      await resolve({
        decision: 'CONFIRMED',
        reason: 'Tres cuentas con el mismo titular',
        suspendUsers: true,
      }).expect(200);

      expect(await prisma.fraudAlert.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'CONFIRMED',
        resolvedById: admin.id,
        resolution: 'Tres cuentas con el mismo titular',
      });
      const statuses = await prisma.user.findMany({
        where: { id: { in: users.map((u) => u.id) } },
        select: { status: true },
      });
      expect(statuses.every((s) => s.status === 'SUSPENDED')).toBe(true);
      expect(
        await prisma.auditLog.count({
          where: { action: 'fraud.alert.resolved', actorId: admin.id },
        }),
      ).toBe(1);

      // Ya resuelta: no se resuelve otra vez.
      await resolve({ decision: 'DISMISSED', reason: 'otra vez' }).expect(409);
    });

    it('descartar una alerta no suspende a nadie', async () => {
      const u = await bettor();
      await creditedDeposit(prisma, u.id, 5000);
      await prisma.withdrawal.create({
        data: {
          userId: u.id,
          amount: 5000,
          destinationDocument: '0912345678',
          destinationPhone: '0991234567',
          status: 'PENDING_APPROVAL',
        },
      });
      await fraud.sweep();
      const [alert] = await alertsOf('WITHDRAWAL_NO_ACTIVITY');
      await request(app.getHttpServer())
        .post(`/admin/fraud-alerts/${alert!.id}/resolve`)
        .set('Cookie', admin.cookie)
        .set('Origin', WEB_ORIGIN)
        .send({ decision: 'DISMISSED', reason: 'Cliente conocido' })
        .expect(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe('ACTIVE');
    });
  });
});
