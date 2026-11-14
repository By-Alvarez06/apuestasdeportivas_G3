import { InMemoryWalletService } from './in-memory-wallet.service';
import { describeWalletContract } from './wallet-contract';

// El doble para la spec 4 cumple el mismo contrato que la billetera real (T038).
describeWalletContract('en memoria', async () => {
  const wallet = new InMemoryWalletService();
  let n = 0;
  return { wallet, newUser: async () => wallet.createWallet(`usuario-${++n}`) };
});
