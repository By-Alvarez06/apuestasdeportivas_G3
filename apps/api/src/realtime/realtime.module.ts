import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { LiveGateway } from './live.gateway';
import { NotifierService } from './notifier.service';

/** Gateway Socket.IO `/live` y avisos al apostador (research R9). */
@Module({
  imports: [WalletModule],
  providers: [LiveGateway, NotifierService],
  exports: [NotifierService],
})
export class RealtimeModule {}
