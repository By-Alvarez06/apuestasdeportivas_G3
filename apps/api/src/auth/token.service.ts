import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditService } from '../audit/audit.service';
import { unauthenticated } from '../common/errors/domain-error';
import type { RequestMeta } from '../common/request-meta';
import { UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { Tx } from '../wallet/ledger.service';

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
    tx: Tx = this.prisma,
  ): Promise<Session> {
    const refreshToken = randomBytes(32).toString('base64url');
    await tx.refreshToken.create({
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

  /**
   * Cambia un refresh por una sesión nueva de la misma familia. Reusar uno ya usado cierra todas las
   * sesiones. Consumir el token y crear su sucesor ocurren bajo el bloqueo de sesiones del usuario,
   * así ninguna revocación simultánea deja vivo un sucesor.
   */
  async rotate(refreshToken: string, meta: RequestMeta): Promise<Session> {
    const found = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      select: { userId: true },
    });
    if (!found) throw unauthenticated();

    const result = await this.prisma.$transaction(async (tx) => {
      await lockUserSessions(tx, found.userId);
      const row = await tx.refreshToken.findUniqueOrThrow({
        where: { tokenHash: sha256(refreshToken) },
        include: { user: { select: { status: true } } },
      });
      if (row.revokedAt || row.expiresAt <= new Date()) return { kind: 'invalid' as const };
      if (row.usedAt) {
        await revokeAll(tx, row.userId);
        await this.audit.record(
          {
            actorId: row.userId,
            action: 'auth.refresh.reuse',
            metadata: { familyId: row.familyId },
            ...meta,
          },
          tx,
        );
        return { kind: 'reused' as const };
      }
      if (row.user.status === UserStatus.SUSPENDED) return { kind: 'invalid' as const };
      await tx.refreshToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
      return {
        kind: 'ok' as const,
        session: await this.issueSession(row.userId, meta, row.familyId, tx),
      };
    });

    if (result.kind === 'reused')
      throw unauthenticated('Tu sesión se cerró por seguridad. Inicia sesión de nuevo.');
    if (result.kind === 'invalid') throw unauthenticated();
    return result.session;
  }

  async revokeFamily(userId: string, familyId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockUserSessions(tx, userId);
      await tx.refreshToken.updateMany({
        where: { userId, familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockUserSessions(tx, userId);
      await revokeAll(tx, userId);
    });
  }
}

/** Serializa rotaciones y revocaciones de un mismo usuario (bloqueo consultivo hasta el fin de la transacción). */
export async function lockUserSessions(tx: Tx, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sessions:${userId}`}))`;
}

/** Revoca todas las sesiones del usuario dentro de `tx`; el llamador debe tener lockUserSessions. */
export async function revokeAll(tx: Tx, userId: string): Promise<void> {
  await tx.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
