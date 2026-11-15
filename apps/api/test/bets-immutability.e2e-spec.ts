import type { PrismaClient } from '../src/generated/prisma/client';
import {
  AlertStatus,
  BetStatus,
  BetType,
  BonusStatus,
  FraudRule,
  FraudSeverity,
  MatchEventType,
  StakeSource,
} from '../src/generated/prisma/enums';
import { newUserWallet } from '../src/wallet/user-wallet';
import { createTestPrisma, resetDatabase } from './setup';

describe('Integridad de apuestas, liquidaciones, bonos y alertas (T008)', () => {
  let prisma: PrismaClient;
  let userId: string;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const user = await prisma.user.create({
      data: {
        email: `apostador-${crypto.randomUUID()}@test.local`,
        passwordHash: 'x',
        birthDate: new Date('1990-01-01'),
        ...newUserWallet(),
      },
    });
    userId = user.id;
  });

  function createBet(overrides: { stake?: number; odds?: number } = {}) {
    return prisma.bet.create({
      data: {
        userId,
        requestKey: crypto.randomUUID(),
        type: BetType.SINGLE,
        stake: overrides.stake ?? 1000,
        source: StakeSource.REAL,
        totalOddsX: '210',
        potentialPayout: 2100,
        ip: '127.0.0.1',
        selections: {
          create: {
            selectionId: 's1',
            marketId: 'mk1',
            matchId: 'm1',
            odds: overrides.odds ?? 210,
            matchLabel: 'A vs B',
            marketLabel: 'Resultado final',
            selectionLabel: 'A',
            startsAt: new Date(Date.now() + 3_600_000),
          },
        },
      },
      include: { selections: true },
    });
  }

  it('permite cambiar el estado de una apuesta pero no su monto ni su cuota', async () => {
    const bet = await createBet();
    await prisma.bet.update({
      where: { id: bet.id },
      data: { status: BetStatus.WON, payout: 2100, settledVersion: 1, settledAt: new Date() },
    });

    await expect(prisma.bet.update({ where: { id: bet.id }, data: { stake: 1 } })).rejects.toThrow(
      /no se modifican/,
    );
    await expect(
      prisma.bet.update({ where: { id: bet.id }, data: { potentialPayout: 999_999 } }),
    ).rejects.toThrow(/no se modifican/);
    await expect(
      prisma.betSelection.update({ where: { id: bet.selections[0]!.id }, data: { odds: 500 } }),
    ).rejects.toThrow(/no se modifican/);
  });

  it('no deja borrar apuestas ni selecciones', async () => {
    const bet = await createBet();
    await expect(prisma.betSelection.deleteMany({ where: { betId: bet.id } })).rejects.toThrow(
      /solo agregar/,
    );
    await expect(prisma.bet.delete({ where: { id: bet.id } })).rejects.toThrow(/solo agregar/);
  });

  it('rechaza montos y cuotas inválidos', async () => {
    await expect(createBet({ stake: 0 })).rejects.toThrow();
    await expect(createBet({ odds: 100 })).rejects.toThrow();
  });

  it('no deja editar ni borrar liquidaciones', async () => {
    const bet = await createBet();
    const event = await prisma.matchEvent.create({
      data: {
        sourceEventId: 'ev-1',
        type: MatchEventType.MARKET_RESULTED,
        matchId: 'm1',
        marketId: 'mk1',
        payload: {},
      },
    });
    const settlement = await prisma.betSettlement.create({
      data: {
        betId: bet.id,
        version: 1,
        outcome: BetStatus.WON,
        payout: 2100,
        matchEventId: event.id,
      },
    });

    await expect(
      prisma.betSettlement.update({ where: { id: settlement.id }, data: { payout: 1 } }),
    ).rejects.toThrow(/solo agregar/);
    await expect(prisma.betSettlement.delete({ where: { id: settlement.id } })).rejects.toThrow(
      /solo agregar/,
    );
  });

  it('en un evento de resultado solo cambia processedAt', async () => {
    const event = await prisma.matchEvent.create({
      data: {
        sourceEventId: 'ev-2',
        type: MatchEventType.RESULT_CORRECTED,
        matchId: 'm1',
        payload: {},
      },
    });
    await prisma.matchEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });

    await expect(
      prisma.matchEvent.update({ where: { id: event.id }, data: { payload: { otro: true } } }),
    ).rejects.toThrow(/solo processedAt/);
    await expect(prisma.matchEvent.delete({ where: { id: event.id } })).rejects.toThrow(
      /solo agregar/,
    );
  });

  it('rechaza un segundo bono activo para el mismo usuario', async () => {
    const bonus = {
      userId,
      amount: 1500,
      wagerRequired: 7500,
      expiresAt: new Date(Date.now() + 86_400_000),
    };
    await prisma.bonus.create({ data: bonus });
    await expect(prisma.bonus.create({ data: bonus })).rejects.toThrow();

    // Uno cerrado no impide otro activo.
    await prisma.bonus.updateMany({ where: { userId }, data: { status: BonusStatus.CONVERTED } });
    await expect(prisma.bonus.create({ data: bonus })).resolves.toBeDefined();
  });

  it('rechaza una segunda alerta abierta para la misma regla y sujeto', async () => {
    const alert = {
      rule: FraudRule.MULTI_ACCOUNT,
      severity: FraudSeverity.HIGH,
      subjectKey: 'device:abc',
      userIds: [userId],
      evidence: {},
    };
    const first = await prisma.fraudAlert.create({ data: alert });
    await expect(prisma.fraudAlert.create({ data: alert })).rejects.toThrow();

    await prisma.fraudAlert.update({
      where: { id: first.id },
      data: { status: AlertStatus.DISMISSED, resolvedAt: new Date() },
    });
    await expect(prisma.fraudAlert.create({ data: alert })).resolves.toBeDefined();
    await expect(prisma.fraudAlert.delete({ where: { id: first.id } })).rejects.toThrow(
      /solo agregar/,
    );
  });
});
