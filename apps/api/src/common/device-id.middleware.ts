import { randomUUID } from 'node:crypto';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const DEVICE_COOKIE = 'device_id';

const TWO_YEARS_MS = 2 * 365 * 24 * 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RequestWithDevice = Request & { deviceId?: string };

/**
 * Identificador estable del navegador (research R10) para limitar cupones por dispositivo y detectar
 * cuentas múltiples. Si la petición no trae una cookie `device_id` válida, se genera una nueva.
 * Es httpOnly: el cliente no la puede leer ni falsificar desde JavaScript.
 */
export function deviceId(secure: boolean) {
  return (req: RequestWithDevice, res: Response, next: NextFunction): void => {
    const current: unknown = req.cookies?.[DEVICE_COOKIE];
    if (typeof current === 'string' && UUID.test(current)) {
      req.deviceId = current.toLowerCase();
    } else {
      req.deviceId = randomUUID();
      res.cookie(DEVICE_COOKIE, req.deviceId, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        maxAge: TWO_YEARS_MS,
      });
    }
    next();
  };
}

/** Id de dispositivo de la petición (lo pone el middleware `deviceId`). */
export const DeviceId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const id = ctx.switchToHttp().getRequest<RequestWithDevice>().deviceId;
  if (!id) throw new Error('Falta el middleware deviceId');
  return id;
});
