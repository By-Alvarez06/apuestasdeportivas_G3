import type { NestExpressApplication } from '@nestjs/platform-express';
import { BettingSettingsService } from '../src/betting/settings.service';
import type { PrismaClient } from '../src/generated/prisma/client';
import { Role } from '../src/generated/prisma/enums';
import {
  balances,
  type BetBody,
  type BetView,
  catalogOf,
  fund,
  placeBet,
  processed,
  publish,
  result1x2,
  single,
  statusEvent,
} from './bets.helpers';
import { createCoupon, redeem } from './promotions.helpers';
import { createTestApp, createTestPrisma, drainQueues, resetDatabase, signedInUser } from './setup';

describe('US5 · Apuestas gratis y aumentos de cuota (T055)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let operator: { id: string; cookie: string };
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
    const catalog = catalogOf(app);
    catalog.reset();
    catalog.setOdds('m1-1x2-away', 300);
    catalog.setOdds('m4-1x2-home', 200);
    operator = await signedInUser(app, prisma, { role: Role.OPERATOR });
    user = await signedInUser(app, prisma);
    await fund(app, user.id, 5000);
  });

  const send = async (event: Parameters<typeof publish>[1] & { sourceEventId: string }) => {
    await publish(app, event);
    await processed(prisma, event.sourceEventId);
  };

  async function freeBetId(amount = '5.00') {
    await createCoupon(app, operator.cookie, { code: 'GRATIS', type: 'FREE_BET', amount }).expect(
      201,
    );
    const res = await redeem(app, user.cookie, 'GRATIS').expect(201);
    return res.body.freeBet.id as string;
  }

  async function boostId(percent: number, maxBoost?: string) {
    await createCoupon(app, operator.cookie, {
      code: 'CUOTAMAS',
      type: 'ODDS_BOOST',
      percent,
      maxBoost,
    }).expect(201);
    const res = await redeem(app, user.cookie, 'CUOTAMAS').expect(201);
    return res.body.redemptionId as string;
  }

  const withFreeBet = (id: string, body: BetBody = single('m1-1x2-away', '3.00', '5.00')) =>
    placeBet(app, user.cookie, { ...body, source: 'FREE_BET', freeBetId: id } as BetBody);

  describe('apuesta gratis', () => {
    it('escenario 3: no descuenta saldo y, si gana, acredita la ganancia neta al bono con rollover', async () => {
      const id = await freeBetId();
      const bet = (await withFreeBet(id).expect(201)).body as BetView;
      expect(bet).toMatchObject({ source: 'FREE_BET', stake: '5.00', potentialPayout: '15.00' });
      expect(await balances(app, user.id)).toMatchObject({ real: 5000, bonus: 0 });

      await send(result1x2('m1', 'away'));
      expect(await prisma.bet.findUniqueOrThrow({ where: { id: bet.id } })).toMatchObject({
        status: 'WON',
        payout: 1000,
      });
      expect(await balances(app, user.id)).toMatchObject({ real: 5000, bonus: 1000 });
      expect(await prisma.bonus.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({
        amount: 1000,
        wagerRequired: 5000,
        status: 'ACTIVE',
      });
    });

    it('si pierde no hay movimiento de dinero', async () => {
      const id = await freeBetId();
      await withFreeBet(id).expect(201);
      await send(result1x2('m1', 'home'));
      expect(await balances(app, user.id)).toMatchObject({ real: 5000, bonus: 0 });
    });

    it('sirve una sola vez', async () => {
      const id = await freeBetId();
      await withFreeBet(id).expect(201);
      const again = await withFreeBet(id, single('m4-1x2-home', '2.00', '5.00')).expect(422);
      expect(again.body.error).toMatchObject({
        code: 'COUPON_INVALID',
        details: { reason: 'USED' },
      });
    });

    it('el monto debe ser el de la apuesta gratis y no se usa la de otro usuario', async () => {
      const id = await freeBetId();
      await withFreeBet(id, single('m1-1x2-away', '3.00', '4.00')).expect(400);
      const other = await signedInUser(app, prisma);
      const res = await placeBet(app, other.cookie, {
        ...single('m1-1x2-away', '3.00', '5.00'),
        source: 'FREE_BET',
        freeBetId: id,
      } as BetBody).expect(422);
      expect(res.body.error.details.reason).toBe('NOT_FOUND');
    });

    it('si la apuesta se anula, la apuesta gratis vuelve a estar disponible', async () => {
      const id = await freeBetId();
      await withFreeBet(id).expect(201);
      await send(await statusEvent(app, 'm1', 'CANCELLED'));
      expect(await balances(app, user.id)).toMatchObject({ real: 5000, bonus: 0 });
      expect((await prisma.freeBet.findUniqueOrThrow({ where: { id } })).usedAt).toBeNull();
      await withFreeBet(id, single('m4-1x2-home', '2.00', '5.00')).expect(201);
    });
  });

  describe('aumento de cuota', () => {
    it('escenario 4: 10 % sobre 2.00 congela 2.20', async () => {
      const id = await boostId(10);
      const res = await placeBet(app, user.cookie, {
        ...single('m4-1x2-home', '2.00', '10.00'),
        boostRedemptionId: id,
      } as BetBody).expect(201);
      expect(res.body).toMatchObject({ totalOdds: '2.20', potentialPayout: '22.00' });
      expect((res.body as BetView).selections[0]!.odds).toBe('2.20');

      await send(result1x2('m4', 'home'));
      expect((await balances(app, user.id)).real).toBe(4000 + 2200);
    });

    it('respeta el tope del aumento', async () => {
      catalogOf(app).setOdds('m1-1x2-away', 500);
      const id = await boostId(20, '0.50');
      const res = await placeBet(app, user.cookie, {
        ...single('m1-1x2-away', '5.00', '10.00'),
        boostRedemptionId: id,
      } as BetBody).expect(201);
      expect(res.body.totalOdds).toBe('5.50');
    });

    it('sirve una sola vez y solo en apuestas simples', async () => {
      const id = await boostId(10);
      const combo = await placeBet(app, user.cookie, {
        selections: [
          { selectionId: 'm4-1x2-home', odds: '2.00' },
          { selectionId: 'm1-1x2-away', odds: '3.00' },
        ],
        stake: '5.00',
        boostRedemptionId: id,
      } as BetBody).expect(400);
      expect(combo.body.error.message).toMatch(/simple/);

      await placeBet(app, user.cookie, {
        ...single('m4-1x2-home', '2.00', '5.00'),
        boostRedemptionId: id,
      } as BetBody).expect(201);
      const again = await placeBet(app, user.cookie, {
        ...single('m1-1x2-away', '3.00', '5.00'),
        boostRedemptionId: id,
      } as BetBody).expect(422);
      expect(again.body.error.details.reason).toBe('USED');
    });
  });
});
