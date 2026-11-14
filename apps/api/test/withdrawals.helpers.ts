import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { payphoneOf, WEB_ORIGIN } from './setup';

/** Titular que devuelve el Payphone simulado en cada depósito. */
export const PAYER = { destinationDocument: '1104567890', destinationPhone: '593987654321' };

let seq = 0;

/** Deposita por el flujo real (intención → Payphone simulado → confirmación) y devuelve el id. */
export async function depositThroughPayphone(
  app: NestExpressApplication,
  cookie: string,
  amount: string,
): Promise<string> {
  const created = await request(app.getHttpServer())
    .post('/deposits')
    .set('Origin', WEB_ORIGIN)
    .set('Cookie', cookie)
    .set('Idempotency-Key', `helper-deposit-${++seq}-${Date.now()}`)
    .send({ amount })
    .expect(201);
  const reference = new URL(created.body.paymentUrl).pathname.split('/').pop() as string;
  const payphone = payphoneOf(app);
  await request(app.getHttpServer())
    .get(`/payments/payphone/return?id=${payphone.pay(reference)}&clientTransactionId=${reference}`)
    .expect(302);
  return created.body.id;
}
