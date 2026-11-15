import { Module } from '@nestjs/common';
import { BettingModule } from '../betting/betting.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WalletModule } from '../wallet/wallet.module';
import { DebtModule } from './debt.module';
import { HoldsService } from './holds.service';
import { SettlementProcessor } from './settlement.processor';
import { SettlementService } from './settlement.service';

/**
 * Liquidación a partir de la cola match-events (US2), suspensiones y aplazamientos con su plazo,
 * y re-liquidación por corrección con saldo adeudado (US4).
 */
@Module({
  imports: [WalletModule, RealtimeModule, DebtModule, BettingModule, PromotionsModule],
  providers: [SettlementService, HoldsService, SettlementProcessor],
  exports: [SettlementService, HoldsService],
})
export class SettlementModule {}
