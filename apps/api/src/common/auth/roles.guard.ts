import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '../../generated/prisma/enums';
import { AuditService } from '../../audit/audit.service';
import { forbidden } from '../errors/domain-error';
import { requestMetaOf } from '../request-meta';
import { type AuthenticatedRequest, IS_PUBLIC, ROLES } from './decorators';

/** Acceso denegado por defecto (constitución I): sin @Roles o con otro rol, 403 y auditoría. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets) ?? [];
    if (req.user && roles.includes(req.user.role)) return true;

    await this.audit.record({
      actorId: req.user?.id ?? null,
      action: 'access.denied',
      metadata: { method: req.method, path: req.path, role: req.user?.role ?? null },
      ...requestMetaOf(req),
    });
    throw forbidden();
  }
}
