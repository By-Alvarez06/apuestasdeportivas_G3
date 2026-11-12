import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';
import { HttpPayphoneClient, PayphoneClient } from './payphone.client';

@Module({
  imports: [WalletModule],
  controllers: [DepositsController],
  providers: [DepositsService, { provide: PayphoneClient, useClass: HttpPayphoneClient }],
})
export class DepositsModule {}
