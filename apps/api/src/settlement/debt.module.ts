import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { DebtService } from './debt.service';

/**
 * Saldo adeudado tras re-liquidaciones. Módulo aparte para que apuestas, liquidación y retiros
 * (spec 2) lo usen sin depender entre sí.
 */
@Module({
  imports: [WalletModule],
  providers: [DebtService],
  exports: [DebtService],
})
export class DebtModule {}
