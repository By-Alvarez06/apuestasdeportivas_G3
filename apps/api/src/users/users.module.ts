import { Module } from '@nestjs/common';
import { UsersAdminController } from './users-admin.controller';
import { UsersAdminService } from './users-admin.service';

@Module({
  controllers: [UsersAdminController],
  providers: [UsersAdminService],
  // Spec 4: la resolución de alertas de fraude suspende cuentas con este servicio.
  exports: [UsersAdminService],
})
export class UsersModule {}
