import { Injectable, Logger } from '@nestjs/common';
import { fromCents } from '@apuestas/shared';
import type { BetView } from '../betting/bets.dto';
import { WalletService } from '../wallet/wallet.service';
import { LiveGateway } from './live.gateway';

/**
 * Avisos al apostador después de que sus cambios quedaron confirmados en la base
 * (contracts/realtime.md). Son avisos: si uno se pierde, el cliente recarga al reconectar.
 */
@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);

  constructor(
    private readonly gateway: LiveGateway,
    private readonly wallet: WalletService,
  ) {}

  /** Una apuesta cambió de estado: avisa la apuesta y, una vez por usuario, su saldo nuevo. */
  async betsChanged(changes: readonly { userId: string; bet: BetView; version: number }[]) {
    for (const { userId, bet, version } of changes)
      this.gateway.emitToUser(userId, 'bet.updated', { bet, version });
    for (const userId of new Set(changes.map((c) => c.userId))) await this.walletChanged(userId);
  }

  /** Avance, conversión o caducidad del bono (contracts/realtime.md § bonus.updated). */
  bonusChanged(userId: string, bonus: unknown): void {
    this.gateway.emitToUser(userId, 'bonus.updated', bonus);
  }

  async walletChanged(userId: string): Promise<void> {
    try {
      const { real, bonus, held } = await this.wallet.getBalances(userId);
      this.gateway.emitToUser(userId, 'wallet.updated', {
        real: fromCents(real),
        bonus: fromCents(bonus),
        held: fromCents(held),
      });
    } catch (error) {
      // Un aviso fallido no deshace nada: el cliente verá el saldo al recargar.
      this.logger.warn(`No se pudo avisar el saldo de ${userId}: ${String(error)}`);
    }
  }
}
