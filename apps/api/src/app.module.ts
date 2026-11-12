import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AccessModule } from './common/auth/access.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    // El .env vive en la raíz del monorepo; las variables ya definidas en el entorno tienen prioridad.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    // shortcut: contador en memoria, vale para una sola instancia; con varias, guardarlo en Redis.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        { ttl: 60_000, limit: Number(config.get('THROTTLE_LIMIT', 20)) },
      ],
    }),
    PrismaModule,
    AuditModule,
    MailModule,
    AccessModule,
    AuthModule,
    WalletModule,
    HealthModule,
  ],
})
export class AppModule {}
