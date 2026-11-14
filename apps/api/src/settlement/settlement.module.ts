import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { WalletModule } from '../wallet/wallet.module';
import { SettlementProcessor } from './settlement.processor';
import { SettlementService } from './settlement.service';

/** Liquidación de apuestas a partir de la cola match-events (spec 4, US2). */
@Module({
  imports: [WalletModule, RealtimeModule],
  providers: [SettlementService, SettlementProcessor],
  exports: [SettlementService],
})
export class SettlementModule {}
