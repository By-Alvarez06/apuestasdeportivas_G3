import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@apuestas/shared';
import { AuditService } from '../audit/audit.service';
import { DomainError, notFound } from '../common/errors/domain-error';
import type { RequestMeta } from '../common/request-meta';
import { LedgerAccountType, Role, UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { Tx } from '../wallet/ledger.service';
import { lockUserSessions, revokeAll } from '../auth/token.service';

export interface UserFilters {
  email?: string;
  role?: Role;
  status?: UserStatus;
  page: number;
  pageSize: number;
}

const conflict = (message: string) =>
  new DomainError(ErrorCode.CONFLICT, message, HttpStatus.CONFLICT);

/** Gestión de roles y suspensiones (FR-009, FR-010). Siempre queda al menos un administrador activo. */
@Injectable()
export class UsersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(f: UserFilters) {
    const where = {
      email: f.email ? { contains: f.email.toLowerCase() } : undefined,
      role: f.role,
      status: f.status,
    };
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          totpEnabledAt: true,
          createdAt: true,
        },
      }),
    ]);
    const items = rows.map(({ totpEnabledAt, createdAt, ...u }) => ({
      ...u,
      twoFactorEnabled: totpEnabledAt !== null,
      createdAt: createdAt.toISOString(),
    }));
    return { items, total, page: f.page, pageSize: f.pageSize };
  }

  async changeRole(adminId: string, userId: string, role: Role, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const user = await this.lockUser(userId, tx);
      if (user.role === Role.ADMIN && role !== Role.ADMIN)
        await this.assertAnotherAdmin(userId, tx);
      await tx.user.update({ where: { id: userId }, data: { role } });
      // Un apostador necesita billetera; quien nunca lo fue no la tiene.
      if (role === Role.BETTOR) await this.ensureWallet(userId, tx);
      await this.audit.record(
        {
          actorId: adminId,
          action: 'user.role.changed',
          targetType: 'user',
          targetId: userId,
          metadata: { from: user.role, to: role },
          ...meta,
        },
        tx,
      );
      return { id: userId, role };
    });
  }

  async changeStatus(adminId: string, userId: string, status: UserStatus, meta: RequestMeta) {
    if (adminId === userId) throw conflict('No puedes cambiar el estado de tu propia cuenta.');
    return this.prisma.$transaction(async (tx) => {
      const user = await this.lockUser(userId, tx);
      if (user.role === Role.ADMIN && status === UserStatus.SUSPENDED)
        await this.assertAnotherAdmin(userId, tx);
      await tx.user.update({ where: { id: userId }, data: { status } });
      // Suspender cierra todas sus sesiones al instante (AuthGuard comprueba la sesión en cada petición).
      if (status === UserStatus.SUSPENDED) {
        await lockUserSessions(tx, userId);
        await revokeAll(tx, userId);
      }
      await this.audit.record(
        {
          actorId: adminId,
          action: 'user.status.changed',
          targetType: 'user',
          targetId: userId,
          metadata: { from: user.status, to: status },
          ...meta,
        },
        tx,
      );
      return { id: userId, status };
    });
  }

  private async lockUser(userId: string, tx: Tx) {
    // Primero todos los administradores, en orden fijo: dos cambios simultáneos sobre administradores
    // distintos se esperan y el segundo ya cuenta con el resultado del primero.
    await tx.$queryRaw`SELECT id FROM "User" WHERE role = 'ADMIN' ORDER BY id FOR UPDATE`;
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
    if (!row) throw notFound('No encontramos ese usuario.');
    return tx.user.findUniqueOrThrow({ where: { id: userId } });
  }

  private async assertAnotherAdmin(userId: string, tx: Tx): Promise<void> {
    const others = await tx.user.count({
      where: { role: Role.ADMIN, status: UserStatus.ACTIVE, id: { not: userId } },
    });
    if (others === 0) throw conflict('Debe quedar al menos un administrador activo.');
  }

  private async ensureWallet(userId: string, tx: Tx): Promise<void> {
    await tx.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
    await tx.ledgerAccount.createMany({
      data: [
        LedgerAccountType.USER_REAL,
        LedgerAccountType.USER_BONUS,
        LedgerAccountType.USER_HELD,
      ].map((type) => ({ userId, type })),
      skipDuplicates: true,
    });
  }
}
