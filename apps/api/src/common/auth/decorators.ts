import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '../../generated/prisma/enums';

/** Usuario autenticado que AuthGuard deja en la petición. */
export interface AuthUser {
  id: string;
  role: Role;
}

export type AuthenticatedRequest = Request & { user?: AuthUser };

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Ruta sin sesión. Todo lo demás exige sesión y un rol de @Roles (denegado por defecto). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Roles que pueden usar la ruta. Una ruta no pública sin @Roles responde 403. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user as AuthUser,
);
