import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { BettingSettingsService, type SettingKey } from '../src/betting/settings.service';
import { SimulatedCatalog } from '../src/catalog/simulated/simulated-catalog';
import { LedgerAccountType, LedgerTransactionType } from '../src/generated/prisma/enums';
import { WalletService } from '../src/wallet/wallet.service';
import { WEB_ORIGIN } from './setup';

export interface BetBody {
  selections: { selectionId: string; odds: string }[];
  stake: string;
  source?: 'REAL' | 'BONUS' | 'FREE_BET';
}

export interface BetView {
  id: string;
  type: 'SINGLE' | 'COMBO';
  status: string;
  stake: string;
  source: string;
  totalOdds: string;
  potentialPayout: string;
  payout: string;
  live: boolean;
  acceptedAt: string;
  settledAt: string | null;
  selections: {
    id: string;
    selectionId: string;
    matchLabel: string;
    marketLabel: string;
    selectionLabel: string;
    odds: string;
    status: string;
    startsAt: string;
  }[];
}

let seq = 0;

/** Carga saldo real o de bono a un usuario como si viniera de un depósito o un bono. */
export async function fund(
  app: NestExpressApplication,
  userId: string,
  cents: number,
  balance: 'REAL' | 'BONUS' = 'REAL',
): Promise<void> {
  const key = `test-fund:${++seq}:${crypto.randomUUID()}`;
  await app.get(WalletService).transfer({
    userId,
    amount: cents,
    from: LedgerAccountType.GATEWAY,
    to: balance === 'REAL' ? LedgerAccountType.USER_REAL : LedgerAccountType.USER_BONUS,
    type: balance === 'REAL' ? LedgerTransactionType.DEPOSIT : LedgerTransactionType.BONUS_CREDIT,
    idempotencyKey: key,
    reference: { type: 'test', id: key },
  });
}

export const balances = (app: NestExpressApplication, userId: string) =>
  app.get(WalletService).getBalances(userId);

/** POST /bets con su Idempotency-Key (una nueva salvo que se indique). */
export function placeBet(
  app: NestExpressApplication,
  cookie: string,
  body: BetBody,
  key = `bet-${crypto.randomUUID()}`,
) {
  return request(app.getHttpServer())
    .post('/bets')
    .set('Cookie', cookie)
    .set('Origin', WEB_ORIGIN)
    .set('Idempotency-Key', key)
    .send({ source: 'REAL', ...body });
}

/** Apuesta simple a una selección del catálogo simulado. */
export const single = (selectionId: string, odds: string, stake: string): BetBody => ({
  selections: [{ selectionId, odds }],
  stake,
});

export async function setSetting(
  app: NestExpressApplication,
  key: SettingKey,
  value: number,
): Promise<void> {
  await app.get(BettingSettingsService).set(key, value, crypto.randomUUID(), {
    ip: '127.0.0.1',
    userAgent: 'jest',
  });
}

export const catalogOf = (app: NestExpressApplication) => app.get(SimulatedCatalog);
