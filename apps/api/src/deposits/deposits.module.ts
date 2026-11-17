import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WalletModule } from '../wallet/wallet.module';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';
import { HttpPayphoneClient, PayphoneClient } from './payphone.client';
import { SimulatedPayphoneClient } from './simulated-payphone.client';

function paymentClient(config: ConfigService): PayphoneClient {
  const provider = config.get<string>('PAYMENT_PROVIDER', 'payphone');
  if (provider === 'simulated') {
    if (config.get<string>('NODE_ENV') === 'production') {
      throw new Error('El proveedor de pagos simulado no está permitido en producción.');
    }
    return new SimulatedPayphoneClient();
  }
  if (provider === 'payphone') return new HttpPayphoneClient(config);
  throw new Error(`PAYMENT_PROVIDER=${provider} no es válido; usa payphone o simulated.`);
}

@Module({
  imports: [WalletModule],
  controllers: [DepositsController],
  providers: [
    DepositsService,
    { provide: PayphoneClient, inject: [ConfigService], useFactory: paymentClient },
  ],
})
export class DepositsModule {}
