import type { NextFunction, Request, Response } from 'express';
import { type ApiErrorBody, ErrorCode } from '@apuestas/shared';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defensa CSRF junto a las cookies SameSite=Lax: una petición que cambia estado y trae `Origin`
 * debe venir de la web. Sin `Origin` (clientes servidor a servidor) se deja pasar; los navegadores
 * siempre lo envían en POST/PUT/PATCH/DELETE.
 */
export function originCheck(allowedOrigin: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.get('origin');
    if (SAFE_METHODS.has(req.method) || !origin || origin === allowedOrigin) return next();
    const body: ApiErrorBody = {
      error: { code: ErrorCode.FORBIDDEN, message: 'Origen de la petición no permitido.' },
    };
    res.status(403).json(body);
  };
}
