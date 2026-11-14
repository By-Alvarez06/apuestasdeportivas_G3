import type { NestExpressApplication } from '@nestjs/platform-express';
import { authenticator } from 'otplib';
import request from 'supertest';
import { WEB_ORIGIN } from './setup';

/** Activa 2FA por la API como lo haría el usuario y devuelve el secreto y los códigos de recuperación. */
export async function enableTwoFactor(
  app: NestExpressApplication,
  cookie: string,
): Promise<{ secret: string; recoveryCodes: string[] }> {
  const setup = await request(app.getHttpServer())
    .post('/auth/2fa/setup')
    .set('Origin', WEB_ORIGIN)
    .set('Cookie', cookie)
    .expect(201);
  const secret = new URL(setup.body.otpauthUrl).searchParams.get('secret') as string;
  const enable = await request(app.getHttpServer())
    .post('/auth/2fa/enable')
    .set('Origin', WEB_ORIGIN)
    .set('Cookie', cookie)
    .send({ code: authenticator.generate(secret) })
    .expect(201);
  return { secret, recoveryCodes: enable.body.recoveryCodes };
}

export const totp = (secret: string) => authenticator.generate(secret);
