import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { unauthenticated } from '../errors/domain-error';
import { type AuthenticatedRequest, IS_PUBLIC } from './decorators';

export const ACCESS_COOKIE = 'access_token';

/** Verifica la cookie de acceso. Consulta el usuario en cada petición para que una suspensión o un cambio de rol apliquen al instante. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const token: unknown = req.cookies?.[ACCESS_COOKIE];
    if (typeof token !== 'string' || !token) throw unauthenticated();

    let claims: { sub?: unknown; sid?: unknown };
    try {
      claims = await this.jwt.verifyAsync(token);
    } catch {
      throw unauthenticated('Tu sesión expiró. Inicia sesión de nuevo.');
    }
    const { sub, sid } = claims;
    if (typeof sub !== 'string' || typeof sid !== 'string') throw unauthenticated();

    const [user, session] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: sub },
        select: { id: true, role: true, status: true },
      }),
      // La sesión sigue viva si su familia tiene algún refresh sin revocar ni vencer.
      this.prisma.refreshToken.findFirst({
        where: { userId: sub, familyId: sid, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      }),
    ]);
    if (!user || !session || user.status === UserStatus.SUSPENDED) throw unauthenticated();

    req.user = { id: user.id, role: user.role, sessionId: sid };
    return true;
  }
}
