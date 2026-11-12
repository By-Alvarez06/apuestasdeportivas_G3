import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditService } from '../audit/audit.service';
import { unauthenticated } from '../common/errors/domain-error';
import type { RequestMeta } from '../common/request-meta';
import { UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface Session {
  accessToken: string;
  refreshToken: string;
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Sesiones de FR-004: JWT de acceso corto con `sid` (la familia de la sesión) y refresh opaco de un
 * solo uso. Revocar la familia invalida al instante el acceso, porque AuthGuard comprueba `sid`.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async issueSession(
    userId: string,
    meta: RequestMeta,
    familyId: string = randomUUID(),
  ): Promise<Session> {
    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        ...meta,
      },
    });
    const accessToken = await this.jwt.signAsync({ sub: userId, sid: familyId });
    return { accessToken, refreshToken };
  }

  /** Cambia un refresh por una sesión nueva de la misma familia. Reusar uno ya usado cierra todas las sesiones. */
  async rotate(refreshToken: string, meta: RequestMeta): Promise<Session> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: { select: { status: true } } },
    });
    if (!row || row.revokedAt || row.expiresAt <= new Date()) throw unauthenticated();

    // updateMany con usedAt null: si dos peticiones rotan a la vez, solo una gana.
    const { count } = row.usedAt
      ? { count: 0 }
      : await this.prisma.refreshToken.updateMany({
          where: { id: row.id, usedAt: null },
          data: { usedAt: new Date() },
        });
    if (count === 0) {
      await this.revokeAllForUser(row.userId);
      await this.audit.record({
        actorId: row.userId,
        action: 'auth.refresh.reuse',
        metadata: { familyId: row.familyId },
        ...meta,
      });
      throw unauthenticated('Tu sesión se cerró por seguridad. Inicia sesión de nuevo.');
    }
    if (row.user.status === UserStatus.SUSPENDED) throw unauthenticated();
    return this.issueSession(row.userId, meta, row.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
