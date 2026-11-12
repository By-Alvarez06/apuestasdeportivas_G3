import { Module } from '@nestjs/common';
import { AdjustmentsController } from './adjustments.controller';
import { LedgerService } from './ledger.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

/** Exporta WalletService: la única puerta para mover dinero (contracts/wallet-service.md). */
@Module({
  controllers: [WalletController, AdjustmentsController],
  providers: [WalletService, LedgerService],
  exports: [WalletService],
})
export class WalletModule {}
