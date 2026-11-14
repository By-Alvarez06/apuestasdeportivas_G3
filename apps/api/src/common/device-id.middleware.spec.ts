import type { Response } from 'express';
import { DEVICE_COOKIE, deviceId, type RequestWithDevice } from './device-id.middleware';

describe('deviceId middleware', () => {
  const run = (cookie: unknown, secure = false) => {
    const req = { cookies: { [DEVICE_COOKIE]: cookie } } as unknown as RequestWithDevice;
    const res = { cookie: jest.fn() };
    const next = jest.fn();
    deviceId(secure)(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
    return { req, res };
  };

  it('reutiliza una cookie válida sin volver a ponerla', () => {
    const id = '0b8f4c3e-2a8f-4a8e-9d43-5f2c3a1b7e90';
    const { req, res } = run(id);
    expect(req.deviceId).toBe(id);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'inventada', '1234', 42])(
    'genera un id nuevo si la cookie es %p',
    (cookie) => {
      const { req, res } = run(cookie);
      expect(req.deviceId).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.cookie).toHaveBeenCalledWith(
        DEVICE_COOKIE,
        req.deviceId,
        expect.objectContaining({ httpOnly: true, sameSite: 'lax', secure: false, path: '/' }),
      );
    },
  );

  it('marca la cookie como Secure en producción', () => {
    const { res } = run(undefined, true);
    expect(res.cookie).toHaveBeenCalledWith(
      DEVICE_COOKIE,
      expect.any(String),
      expect.objectContaining({ secure: true }),
    );
  });
});
