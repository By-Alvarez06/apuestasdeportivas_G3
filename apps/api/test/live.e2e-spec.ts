import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { io, type Socket } from 'socket.io-client';
import { BettingSettingsService } from '../src/betting/settings.service';
import type { PrismaClient } from '../src/generated/prisma/client';
import {
  type BetView,
  catalogOf,
  fund,
  placeBet,
  processed,
  publish,
  result1x2,
  single,
  waitFor,
} from './bets.helpers';
import { createTestApp, createTestPrisma, drainQueues, resetDatabase, signedInUser } from './setup';

interface Received {
  bets: { bet: BetView; version: number }[];
  wallets: { real: string; bonus: string; held: string }[];
}

describe('US2 · Avisos en tiempo real por usuario (T034, FR-017)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
    await app.listen(0);
    url = `http://localhost:${(app.getHttpServer().address() as AddressInfo).port}/live`;
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
  });

  afterEach(() => {
    for (const s of sockets.splice(0)) s.disconnect();
  });

  /** Conecta con la cookie dada y junta lo que llega. Resuelve al conectar o con el error. */
  function connect(cookie?: string) {
    const socket = io(url, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: cookie ? { cookie } : {},
    });
    sockets.push(socket);
    const received: Received = { bets: [], wallets: [] };
    socket.on('bet.updated', (payload: { bet: BetView; version: number }) =>
      received.bets.push(payload),
    );
    socket.on('wallet.updated', (payload: Received['wallets'][number]) =>
      received.wallets.push(payload),
    );
    const ready = new Promise<{ ok: true } | { ok: false; code: unknown }>((resolve) => {
      socket.on('connect', () => resolve({ ok: true }));
      socket.on('connect_error', (err: Error & { data?: { code?: unknown } }) =>
        resolve({ ok: false, code: err.data?.code }),
      );
    });
    return { socket, received, ready };
  }

  it('rechaza conexiones sin sesión', async () => {
    expect(await connect().ready).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    expect(await connect('access_token=falso').ready).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
  });

  it('rechaza una sesión revocada', async () => {
    const user = await signedInUser(app, prisma);
    await prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { revokedAt: new Date() },
    });
    expect(await connect(user.cookie).ready).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
  });

  it('el dueño ve su apuesta liquidada y su saldo nuevo, en todas sus pestañas; nadie más', async () => {
    const owner = await signedInUser(app, prisma);
    const stranger = await signedInUser(app, prisma);
    await fund(app, owner.id, 5000);
    const bet = (await placeBet(app, owner.cookie, single('m1-1x2-home', '2.10', '10.00')))
      .body as BetView;

    const tabA = connect(owner.cookie);
    const tabB = connect(owner.cookie);
    const other = connect(stranger.cookie);
    for (const c of [tabA, tabB, other]) expect(await c.ready).toEqual({ ok: true });

    const event = result1x2('m1', 'home');
    await publish(app, event);
    await processed(prisma, event.sourceEventId);

    for (const tab of [tabA, tabB]) {
      await waitFor(() => Promise.resolve(tab.received.wallets.length > 0), { timeoutMs: 5000 });
      expect(tab.received.bets).toEqual([
        {
          bet: expect.objectContaining({ id: bet.id, status: 'WON', payout: '21.00' }),
          version: 1,
        },
      ]);
      expect(tab.received.wallets.at(-1)).toEqual({ real: '61.00', bonus: '0.00', held: '0.00' });
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(other.received).toEqual({ bets: [], wallets: [] });
  });
});
