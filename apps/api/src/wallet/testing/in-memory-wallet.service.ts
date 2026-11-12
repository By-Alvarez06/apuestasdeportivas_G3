import {
  type Balances,
  type HoldOp,
  IdempotencyConflictError,
  InsufficientFundsError,
  type MoneyOp,
  type WalletPort,
  WalletNotFoundError,
} from '../wallet.port';

type Pocket = keyof Balances;

/**
 * Doble en memoria de WalletPort para que la spec 4 trabaje sin la billetera real (T038).
 * Cumple la misma suite de contrato; no simula concurrencia entre procesos.
 */
export class InMemoryWalletService implements WalletPort {
  private readonly wallets = new Map<string, Balances>();
  private readonly applied = new Map<string, { id: string; fingerprint: string }>();
  private seq = 0;

  createWallet(userId: string): string {
    this.wallets.set(userId, { real: 0, bonus: 0, held: 0 });
    return userId;
  }

  async getBalances(userId: string): Promise<Balances> {
    return { ...this.wallet(userId) };
  }

  async debit(op: MoneyOp): Promise<string> {
    return this.move(op, 'debit', op.balance === 'REAL' ? 'real' : 'bonus', null);
  }

  async credit(op: MoneyOp): Promise<string> {
    return this.move(op, 'credit', null, op.balance === 'REAL' ? 'real' : 'bonus');
  }

  async hold(op: HoldOp): Promise<string> {
    return this.move(op, 'hold', 'real', 'held');
  }

  async release(op: HoldOp): Promise<string> {
    return this.move(op, 'release', 'held', 'real');
  }

  private wallet(userId: string): Balances {
    const wallet = this.wallets.get(userId);
    if (!wallet) throw new WalletNotFoundError();
    return wallet;
  }

  /** Sin await entre comprobar y aplicar: es atómico dentro del event loop. */
  private move(
    op: Omit<MoneyOp, 'balance'> & { balance?: MoneyOp['balance'] },
    kind: string,
    from: Pocket | null,
    to: Pocket | null,
  ): string {
    if (!Number.isSafeInteger(op.amount) || op.amount <= 0)
      throw new Error(`Monto inválido: ${op.amount}`);
    const wallet = this.wallet(op.userId);
    const fingerprint = `${kind}:${op.userId}:${op.amount}:${from}:${to}`;
    const previous = this.applied.get(op.idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new IdempotencyConflictError();
      return previous.id;
    }
    if (from && wallet[from] < op.amount) throw new InsufficientFundsError();
    if (from) wallet[from] -= op.amount;
    if (to) wallet[to] += op.amount;
    const id = `mem-${++this.seq}`;
    this.applied.set(op.idempotencyKey, { id, fingerprint });
    return id;
  }
}
