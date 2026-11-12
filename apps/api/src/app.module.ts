import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module';
import { AccessModule } from './common/auth/access.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    // El .env vive en la raíz del monorepo; las variables ya definidas en el entorno tienen prioridad.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    PrismaModule,
    AuditModule,
    AccessModule,
    HealthModule,
  ],
})
export class AppModule {}
