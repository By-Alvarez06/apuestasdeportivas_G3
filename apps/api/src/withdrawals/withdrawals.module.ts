import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DebtModule } from '../settlement/debt.module';
import { WalletModule } from '../wallet/wallet.module';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';

@Module({
  imports: [WalletModule, AuthModule, DebtModule],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService],
})
export class WithdrawalsModule {}
