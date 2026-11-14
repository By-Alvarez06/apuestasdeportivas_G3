import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { BettingSettingsService } from '../src/betting/settings.service';
import type { PrismaClient } from '../src/generated/prisma/client';
import { LedgerTransactionType, Role } from '../src/generated/prisma/enums';
import { BonusService } from '../src/promotions/bonus.service';
import {
  balances,
  catalogOf,
  fund,
  placeBet,
  processed,
  publish,
  result1x2,
  setSetting,
  single,
} from './bets.helpers';
import { createCoupon, creditedDeposit, redeem } from './promotions.helpers';
import { createTestApp, createTestPrisma, drainQueues, resetDatabase, signedInUser } from './setup';

describe('US5 · Bono de depósito y rollover (T054)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let operator: { id: string; cookie: string };
  let user: { id: string; cookie: string };
  let bonuses: BonusService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
    bonuses = app.get(BonusService);
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
    user = await signedInUser(app, prisma);
    await createCoupon(app, operator.cookie, {
      code: 'BIENVENIDA',
      type: 'DEPOSIT_BONUS',
      percent: 50,
      maxBonus: '20.00',
    }).expect(201);
  });

  /** Canjea el bono, deposita y deja que el proceso lo conceda. */
  async function grantedBonus(depositCents = 3000) {
    await redeem(app, user.cookie, 'BIENVENIDA').expect(201);
    await creditedDeposit(prisma, user.id, depositCents);
    await fund(app, user.id, depositCents);
    await bonuses.grantDepositBonuses();
    return prisma.bonus.findFirstOrThrow({ where: { userId: user.id } });
  }

  const settle = async (event: ReturnType<typeof result1x2>) => {
    await publish(app, event);
    await processed(prisma, event.sourceEventId);
  };

  const bonusBet = (selectionId: string, odds: string, stake: string) =>
    placeBet(app, user.cookie, { ...single(selectionId, odds, stake), source: 'BONUS' }).expect(
      201,
    );

  it('escenario 2: 50 % de un depósito de 30.00 concede 15.00 de bono con rollover', async () => {
    const res = await redeem(app, user.cookie, 'BIENVENIDA').expect(201);
    expect(res.body).toMatchObject({ type: 'DEPOSIT_BONUS', status: 'AWAITING_DEPOSIT' });

    // Sin depósito posterior, no hay bono.
    await bonuses.grantDepositBonuses();
    expect(await prisma.bonus.count()).toBe(0);

    await creditedDeposit(prisma, user.id, 3000);
    await bonuses.grantDepositBonuses();
    await bonuses.grantDepositBonuses();

    expect(await prisma.bonus.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({
      amount: 1500,
      wagerRequired: 7500,
      wagerProgress: 0,
      status: 'ACTIVE',
    });
    expect((await balances(app, user.id)).bonus).toBe(1500);
    expect(
      await prisma.couponRedemption.findFirstOrThrow({ where: { userId: user.id } }),
    ).toMatchObject({ status: 'GRANTED' });
    expect(await prisma.auditLog.count({ where: { action: 'bonus.granted' } })).toBe(1);

    const promos = await request(app.getHttpServer())
      .get('/promotions')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(promos.body.bonus).toMatchObject({
      amount: '15.00',
      wagerRequired: '75.00',
      wagerProgress: '0.00',
      status: 'ACTIVE',
    });
  });

  it('respeta el tope del bono', async () => {
    const bonus = await grantedBonus(10_000);
    expect(bonus.amount).toBe(2000);
  });

  it('no concede otro bono mientras haya uno activo', async () => {
    await grantedBonus();
    await createCoupon(app, operator.cookie, {
      code: 'RECARGA',
      type: 'DEPOSIT_BONUS',
      percent: 10,
      maxBonus: '5.00',
    }).expect(201);
    const res = await redeem(app, user.cookie, 'RECARGA').expect(409);
    expect(res.body.error.code).toBe('BONUS_ACTIVE');
  });

  it('escenario 7: al cumplir el rollover el bono restante pasa a saldo real', async () => {
    await setSetting(app, 'bonus.rolloverMultiplier', 1); // 15.00 a apostar
    await grantedBonus();

    await bonusBet('m1-1x2-home', '2.10', '10.00');
    await settle(result1x2('m1', 'home')); // gana 21.00 al bono
    await bonusBet('m4-1x2-home', '2.00', '5.00');
    await settle(result1x2('m4', 'away')); // pierde

    expect(await prisma.bonus.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({
      wagerProgress: 1500,
      status: 'ACTIVE',
    });
    const before = await balances(app, user.id);
    expect(before.bonus).toBe(1500 - 1000 + 2100 - 500);

    await bonuses.closeBonuses();
    expect(await prisma.bonus.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({
      status: 'CONVERTED',
    });
    expect(await balances(app, user.id)).toMatchObject({
      real: before.real + before.bonus,
      bonus: 0,
    });
    expect(
      await prisma.ledgerTransaction.count({
        where: { type: LedgerTransactionType.BONUS_CONVERSION },
      }),
    ).toBe(1);
    await bonuses.closeBonuses();
    expect(
      await prisma.ledgerTransaction.count({
        where: { type: LedgerTransactionType.BONUS_CONVERSION },
      }),
    ).toBe(1);
  });

  it('no cuentan para el rollover las cuotas bajas, las anuladas ni las apuestas con saldo real', async () => {
    await grantedBonus();
    catalogOf(app).setOdds('m5-1x2-home', 140);
    await bonusBet('m5-1x2-home', '1.40', '2.00');
    await settle(result1x2('m5', 'home'));
    await bonusBet('m1-1x2-home', '2.10', '2.00');
    await publish(app, {
      type: 'MATCH_STATUS_CHANGED',
      sourceEventId: 'cancelado',
      matchId: 'm1',
      status: 'CANCELLED',
      scheduledStart: new Date().toISOString(),
    });
    await processed(prisma, 'cancelado');
    await placeBet(app, user.cookie, single('m4-1x2-home', '2.00', '5.00')).expect(201);
    await settle(result1x2('m4', 'home'));

    expect(
      (await prisma.bonus.findFirstOrThrow({ where: { userId: user.id } })).wagerProgress,
    ).toBe(0);
  });

  it('la conversión espera a que no queden apuestas de bono abiertas', async () => {
    await setSetting(app, 'bonus.rolloverMultiplier', 1);
    await grantedBonus();
    await bonusBet('m1-1x2-home', '2.10', '15.00');
    await settle(result1x2('m1', 'home'));
    await bonusBet('m4-1x2-home', '2.00', '5.00'); // sigue abierta

    await bonuses.closeBonuses();
    expect((await prisma.bonus.findFirstOrThrow({ where: { userId: user.id } })).status).toBe(
      'ACTIVE',
    );

    await settle(result1x2('m4', 'home'));
    await bonuses.closeBonuses();
    expect((await prisma.bonus.findFirstOrThrow({ where: { userId: user.id } })).status).toBe(
      'CONVERTED',
    );
    expect((await balances(app, user.id)).bonus).toBe(0);
  });

  it('vencido el plazo sin cumplir el rollover, el bono restante caduca', async () => {
    const bonus = await grantedBonus();
    await prisma.bonus.update({
      where: { id: bonus.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await bonuses.closeBonuses();

    expect(await prisma.bonus.findUniqueOrThrow({ where: { id: bonus.id } })).toMatchObject({
      status: 'EXPIRED',
    });
    expect((await balances(app, user.id)).bonus).toBe(0);
    expect(
      await prisma.ledgerTransaction.count({ where: { type: LedgerTransactionType.BONUS_EXPIRY } }),
    ).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'bonus.expired' } })).toBe(1);
  });
});
