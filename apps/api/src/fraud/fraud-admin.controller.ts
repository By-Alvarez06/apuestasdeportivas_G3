import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@apuestas/shared';
import { AuditService } from '../audit/audit.service';
import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators';
import { DomainError, notFound } from '../common/errors/domain-error';
import { Meta, type RequestMeta } from '../common/request-meta';
import type { FraudAlert } from '../generated/prisma/client';
import { AlertStatus, FraudRule, Role, UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { UsersAdminService } from '../users/users-admin.service';

export class AlertsQuery {
  @IsOptional()
  @IsEnum(AlertStatus)
  status?: AlertStatus;

  @IsOptional()
  @IsEnum(FraudRule)
  rule?: FraudRule;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class ResolveAlertDto {
  @IsIn([AlertStatus.DISMISSED, AlertStatus.CONFIRMED])
  decision!: 'DISMISSED' | 'CONFIRMED';

  /** Motivo de la decisión: queda en la alerta y en la auditoría (FR-036). */
  @IsString()
  @Length(3, 500)
  reason!: string;

  /** Con CONFIRMED: suspende las cuentas implicadas (con el servicio de usuarios de la spec 2). */
  @IsOptional()
  @IsBoolean()
  suspendUsers?: boolean;
}

const view = (a: FraudAlert) => ({
  id: a.id,
  rule: a.rule,
  severity: a.severity,
  status: a.status,
  userIds: a.userIds,
  evidence: a.evidence,
  resolution: a.resolution,
  resolvedById: a.resolvedById,
  createdAt: a.createdAt.toISOString(),
  resolvedAt: a.resolvedAt?.toISOString() ?? null,
});

/** contracts/http-api.md § Fraude: solo administradores (FR-036). */
@Roles(Role.ADMIN)
@Controller('admin/fraud-alerts')
export class FraudAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly users: UsersAdminService,
  ) {}

  @Get()
  async list(@Query() q: AlertsQuery) {
    const where = { status: q.status, rule: q.rule };
    const [total, rows] = await Promise.all([
      this.prisma.fraudAlert.count({ where }),
      this.prisma.fraudAlert.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { items: rows.map(view), page: q.page, pageSize: q.pageSize, total };
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const alert = await this.prisma.fraudAlert.findUnique({ where: { id } });
    if (!alert) throw notFound('No encontramos esa alerta.');
    const users = await this.prisma.user.findMany({
      where: { id: { in: alert.userIds } },
      select: { id: true, email: true, status: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...view(alert),
      users: users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
    };
  }

  @Post(':id/resolve')
  @HttpCode(200)
  async resolve(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveAlertDto,
    @Meta() meta: RequestMeta,
  ) {
    const resolved = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "FraudAlert" WHERE id = ${id}::uuid FOR UPDATE`;
      const alert = await tx.fraudAlert.findUnique({ where: { id } });
      if (!alert) throw notFound('No encontramos esa alerta.');
      if (alert.status !== AlertStatus.OPEN)
        throw new DomainError(
          ErrorCode.CONFLICT,
          'Esta alerta ya fue resuelta.',
          HttpStatus.CONFLICT,
        );
      const updated = await tx.fraudAlert.update({
        where: { id },
        data: {
          status: dto.decision,
          resolution: dto.reason,
          resolvedById: admin.id,
          resolvedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          actorId: admin.id,
          action: 'fraud.alert.resolved',
          targetType: 'fraud_alert',
          targetId: id,
          metadata: {
            rule: alert.rule,
            decision: dto.decision,
            reason: dto.reason,
            suspendUsers: Boolean(dto.suspendUsers),
            userIds: alert.userIds,
          },
          ...meta,
        },
        tx,
      );
      return updated;
    });

    // La suspensión la hace la spec 2: revoca sesiones y queda auditada por usuario.
    if (dto.decision === AlertStatus.CONFIRMED && dto.suspendUsers) {
      const targets = await this.prisma.user.findMany({
        where: {
          id: { in: resolved.userIds },
          role: Role.BETTOR,
          status: { not: UserStatus.SUSPENDED },
        },
        select: { id: true },
      });
      for (const { id: userId } of targets)
        await this.users.changeStatus(admin.id, userId, UserStatus.SUSPENDED, meta);
    }
    return view(resolved);
  }
}
