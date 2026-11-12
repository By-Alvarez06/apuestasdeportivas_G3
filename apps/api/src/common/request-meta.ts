import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** IP y dispositivo de la petición, para la auditoría (FR-011). */
export interface RequestMeta {
  ip: string;
  userAgent: string;
}

export function requestMetaOf(req: Request): RequestMeta {
  return { ip: req.ip ?? 'unknown', userAgent: req.get('user-agent') ?? 'unknown' };
}

export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta =>
  requestMetaOf(ctx.switchToHttp().getRequest<Request>()),
);
