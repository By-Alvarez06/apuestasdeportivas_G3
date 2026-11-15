import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BettingModule } from './betting/betting.module';
import { CatalogModule } from './catalog/catalog.module';
import { AccessModule } from './common/auth/access.module';
import { DepositsModule } from './deposits/deposits.module';
import { FraudModule } from './fraud/fraud.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { MatchesModule } from './matches/matches.module';
import { PrismaModule } from './prisma/prisma.module';
import { PromotionsModule } from './promotions/promotions.module';
import { QueuesModule } from './queues/queues.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SettlementModule } from './settlement/settlement.module';
import { ReportsModule } from './reports/reports.module';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';

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
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    MailModule,
    AccessModule,
    AuthModule,
    WalletModule,
    DepositsModule,
    WithdrawalsModule,
    UsersModule,
    MatchesModule,
    ReportsModule,
    // Spec 4
    QueuesModule,
    CatalogModule,
    BettingModule,
    RealtimeModule,
    SettlementModule,
    PromotionsModule,
    FraudModule,
    HealthModule,
  ],
})
export class AppModule {}
