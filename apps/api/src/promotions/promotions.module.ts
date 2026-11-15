import { Module } from '@nestjs/common';
import { BettingModule } from '../betting/betting.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WalletModule } from '../wallet/wallet.module';
import { BonusService } from './bonus.service';
import { CouponsService } from './coupons.service';
import { OperatorCouponsController, PromotionsController } from './promotions.controller';

/** Cupones, apuestas gratis, aumentos de cuota y bonos con rollover (spec 4, US5). */
@Module({
  imports: [WalletModule, RealtimeModule, BettingModule],
  controllers: [OperatorCouponsController, PromotionsController],
  providers: [CouponsService, BonusService],
  exports: [BonusService, CouponsService],
})
export class PromotionsModule {}
