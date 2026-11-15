import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AuthenticatedRequest, IS_PUBLIC } from './decorators';
import { SessionVerifier } from './session-verifier';

export const ACCESS_COOKIE = 'access_token';

/** Verifica la cookie de acceso. Consulta el usuario en cada petición para que una suspensión o un cambio de rol apliquen al instante. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionVerifier,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    req.user = await this.sessions.verify(req.cookies?.[ACCESS_COOKIE]);
    return true;
  }
}
