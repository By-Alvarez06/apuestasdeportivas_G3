import { createHash } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client';
import { WEB_ORIGIN } from './setup';

const DAY = 24 * 3_600_000;

export interface CouponBody {
  code: string;
  type: 'DEPOSIT_BONUS' | 'FREE_BET' | 'ODDS_BOOST';
  /** DEPOSIT_BONUS y ODDS_BOOST: porcentaje entero. */
  percent?: number;
  /** FREE_BET: monto de la apuesta gratis, "5.00". */
  amount?: string;
  /** DEPOSIT_BONUS: tope del bono, "20.00". */
  maxBonus?: string;
  /** ODDS_BOOST: tope del aumento de cuota, "0.50". */
  maxBoost?: string;
  startsAt?: string;
  endsAt?: string;
  totalLimit?: number;
}

export function couponBody(body: CouponBody) {
  return {
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + 7 * DAY).toISOString(),
    totalLimit: 100,
    ...body,
  };
}

/** POST /operator/coupons con un operador. */
export function createCoupon(
  app: NestExpressApplication,
  operatorCookie: string,
  body: CouponBody,
) {
  return request(app.getHttpServer())
    .post('/operator/coupons')
    .set('Cookie', operatorCookie)
    .set('Origin', WEB_ORIGIN)
    .send(couponBody(body));
}

/** POST /coupons/redeem. `cookie` puede incluir `device_id=…` para simular el mismo navegador. */
export function redeem(app: NestExpressApplication, cookie: string, code: string) {
  return request(app.getHttpServer())
    .post('/coupons/redeem')
    .set('Cookie', cookie)
    .set('Origin', WEB_ORIGIN)
    .send({ code });
}

/** Un depósito acreditado por la pasarela, con su titular (lo que guarda la spec 2). */
export function creditedDeposit(
  prisma: PrismaClient,
  userId: string,
  amount: number,
  payer = { document: '0912345678', phone: '0991234567' },
) {
  return prisma.deposit.create({
    data: {
      userId,
      amount,
      reference: `DEP-${crypto.randomUUID()}`,
      status: 'CREDITED',
      payerDocument: payer.document,
      payerPhone: payer.phone,
    },
  });
}

export const payerKeyOf = (document: string, phone: string) =>
  createHash('sha256').update(`${document}|${phone}`).digest('hex');
