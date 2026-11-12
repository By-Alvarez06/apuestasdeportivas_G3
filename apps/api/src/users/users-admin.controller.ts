import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators';
import { Meta, type RequestMeta } from '../common/request-meta';
import { Role, UserStatus } from '../generated/prisma/enums';
import { UsersAdminService } from './users-admin.service';

export class UsersQuery {
  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

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

export class RoleDto {
  @IsEnum(Role, { message: 'El rol debe ser BETTOR, OPERATOR o ADMIN.' })
  role!: Role;
}

export class StatusDto {
  @IsIn([UserStatus.ACTIVE, UserStatus.SUSPENDED], {
    message: 'El estado debe ser ACTIVE o SUSPENDED.',
  })
  status!: typeof UserStatus.ACTIVE | typeof UserStatus.SUSPENDED;
}

@Roles(Role.ADMIN)
@Controller('admin/users')
export class UsersAdminController {
  constructor(private readonly users: UsersAdminService) {}

  @Get()
  list(@Query() query: UsersQuery) {
    return this.users.list(query);
  }

  @Patch(':id/role')
  changeRole(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RoleDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.users.changeRole(admin.id, id, dto.role, meta);
  }

  @Patch(':id/status')
  changeStatus(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StatusDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.users.changeStatus(admin.id, id, dto.status, meta);
  }
}
