import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { unauthenticated } from '../errors/domain-error';
import type { AuthUser } from './decorators';

/**
 * Verifica un token de acceso: firma y vigencia, sesión viva y usuario no suspendido. Consulta el
 * usuario cada vez para que una suspensión o un cambio de rol apliquen al instante. Lo usan el
 * AuthGuard HTTP y el gateway de tiempo real.
 */
@Injectable()
export class SessionVerifier {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /** Lanza DomainError UNAUTHENTICATED si el token no es válido. */
  async verify(token: unknown): Promise<AuthUser> {
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

    return { id: user.id, role: user.role, sessionId: sid };
  }
}
