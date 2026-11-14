import { getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { SimulatedCatalog } from '../src/catalog/simulated/simulated-catalog';
import type { PrismaClient } from '../src/generated/prisma/client';
import { Role } from '../src/generated/prisma/enums';
import { QUEUES } from '../src/queues/queue-names';
import {
  createTestApp,
  createTestPrisma,
  drainQueues,
  resetDatabase,
  signedInUser,
  WEB_ORIGIN,
} from './setup';

interface ApiMatch {
  matchId: string;
  startsAt: string;
  markets: { marketId: string; selections: { selectionId: string; odds: string }[] }[];
}

describe('Catálogo de partidos simulado (T015)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let queue: Queue;
  let bettor: { cookie: string };
  let operator: { cookie: string };

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
    queue = app.get<Queue>(getQueueToken(QUEUES.MATCH_EVENTS));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await drainQueues();
    app.get(SimulatedCatalog).reset();
    bettor = await signedInUser(app, prisma);
    operator = await signedInUser(app, prisma, { role: Role.OPERATOR });
  });

  const http = () => request(app.getHttpServer());
  const post = (path: string, cookie: string, body: object) =>
    http().post(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN).send(body);

  const homeOdds = async (cookie: string) => {
    const res = await http().get('/catalog/matches').set('Cookie', cookie).expect(200);
    const m1 = (res.body as ApiMatch[]).find((m) => m.matchId === 'm1')!;
    return m1.markets[0]!.selections.find((s) => s.selectionId === 'm1-1x2-home')!.odds;
  };

  describe('GET /catalog/matches', () => {
    it('lo pueden ver apostadores, operadores y administradores, con cuotas como texto', async () => {
      const admin = await signedInUser(app, prisma, { role: Role.ADMIN });
      for (const user of [bettor, operator, admin])
        expect(await homeOdds(user.cookie)).toBe('2.10');
    });

    it('exige sesión', async () => {
      await http().get('/catalog/matches').expect(401);
    });

    it('no lista partidos sin mercados abiertos', async () => {
      const res = await http().get('/catalog/matches').set('Cookie', bettor.cookie).expect(200);
      const ids = (res.body as ApiMatch[]).map((m) => m.matchId);
      expect(ids).toEqual(expect.arrayContaining(['m1', 'm2', 'm4', 'm5']));
      expect(new Date((res.body as ApiMatch[])[0]!.startsAt).toString()).not.toBe('Invalid Date');
    });
  });

  describe('/dev/catalog', () => {
    it('un apostador no puede usarlo', async () => {
      await post('/dev/catalog/odds', bettor.cookie, {
        selectionId: 'm1-1x2-home',
        odds: '1.95',
      }).expect(403);
      await post('/dev/catalog/reset', bettor.cookie, {}).expect(403);
    });

    it('el operador cambia cuotas y estados de mercado', async () => {
      await post('/dev/catalog/odds', operator.cookie, {
        selectionId: 'm1-1x2-home',
        odds: '1.95',
      }).expect(204);
      expect(await homeOdds(bettor.cookie)).toBe('1.95');

      await post('/dev/catalog/markets/m1-1x2/status', operator.cookie, {
        status: 'SUSPENDED',
      }).expect(204);
      const [quote] = await app.get(SimulatedCatalog).getQuotes(['m1-1x2-home']);
      expect(quote!.marketStatus).toBe('SUSPENDED');
    });

    it('valida cuotas e ids', async () => {
      await post('/dev/catalog/odds', operator.cookie, {
        selectionId: 'm1-1x2-home',
        odds: '1.00',
      }).expect(400);
      await post('/dev/catalog/odds', operator.cookie, {
        selectionId: 'nada',
        odds: '2.00',
      }).expect(404);
    });

    it('publica eventos en la cola match-events con jobId estable', async () => {
      const event = {
        type: 'MARKET_RESULTED',
        sourceEventId: 'fuente:1',
        matchId: 'm1',
        marketId: 'm1-1x2',
        results: { 'm1-1x2-home': 'WON', 'm1-1x2-draw': 'LOST', 'm1-1x2-away': 'LOST' },
      };
      const res = await post('/dev/catalog/events', operator.cookie, event).expect(202);
      expect(res.body).toEqual({ jobId: 'fuente%3A1' });
      await post('/dev/catalog/events', operator.cookie, event).expect(202);

      const job = await queue.getJob('fuente%3A1');
      expect(job?.data).toMatchObject({ ...event, occurredAt: expect.any(String) });
      expect(await queue.getJobCountByTypes('waiting', 'active', 'completed', 'failed')).toBe(1);

      const [quote] = await app.get(SimulatedCatalog).getQuotes(['m1-1x2-home']);
      expect(quote!.marketStatus).toBe('RESULTED');
    });

    it('rechaza eventos incompletos', async () => {
      await post('/dev/catalog/events', operator.cookie, {
        type: 'MARKET_RESULTED',
        sourceEventId: 'x',
        matchId: 'm1',
        marketId: 'm1-1x2',
        results: {},
      }).expect(400);
      await post('/dev/catalog/events', operator.cookie, {
        type: 'MATCH_STATUS_CHANGED',
        sourceEventId: 'y',
        matchId: 'm1',
      }).expect(400);
    });

    it('no existe en producción', async () => {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await post('/dev/catalog/reset', operator.cookie, {}).expect(404);
      } finally {
        process.env.NODE_ENV = previous;
      }
    });
  });
});
