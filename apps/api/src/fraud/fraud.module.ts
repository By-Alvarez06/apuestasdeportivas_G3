import { Module } from '@nestjs/common';
import { BettingModule } from '../betting/betting.module';
import { CatalogModule } from '../catalog/catalog.module';
import { UsersModule } from '../users/users.module';
import { FraudAdminController } from './fraud-admin.controller';
import { FraudProcessor } from './fraud.processor';
import { FraudService } from './fraud.service';

/**
 * Detección de fraude (spec 4, US6). Apuestas, cupones y liquidación encolan revisiones en
 * fraud-checks (queueFraudCheck) sin depender de este módulo.
 */
@Module({
  imports: [BettingModule, CatalogModule, UsersModule],
  controllers: [FraudAdminController],
  providers: [FraudService, FraudProcessor],
  exports: [FraudService],
})
export class FraudModule {}
