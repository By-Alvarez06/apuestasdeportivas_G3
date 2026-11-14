import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { DebtModule } from '../settlement/debt.module';
import { WalletModule } from '../wallet/wallet.module';
import { BetsController } from './bets.controller';
import { OperatorBettingController } from './operator.controller';
import { BetsService } from './bets.service';
import { BettingSettingsService } from './settings.service';

/** Aceptación de apuestas y ajustes de límites (spec 4, US1). */
@Module({
  imports: [WalletModule, CatalogModule, DebtModule],
  controllers: [BetsController, OperatorBettingController],
  providers: [BetsService, BettingSettingsService],
  exports: [BetsService, BettingSettingsService],
})
export class BettingModule {}
