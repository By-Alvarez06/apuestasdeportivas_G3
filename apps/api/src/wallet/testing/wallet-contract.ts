import {
  IdempotencyConflictError,
  InsufficientFundsError,
  type MoneyOp,
  type WalletPort,
} from '../wallet.port';

export interface WalletHarness {
  wallet: WalletPort;
  /** Crea un usuario con billetera vacía y devuelve su id. */
  newUser(): Promise<string>;
}

/**
 * Suite de contrato de WalletPort (T032). La corren la implementación real y el doble en memoria;
 * la spec 4 puede correrla contra cualquier otra implementación.
 */
export function describeWalletContract(name: string, setup: () => Promise<WalletHarness>): void {
  describe(`Contrato de WalletPort · ${name}`, () => {
    let wallet: WalletPort;
    let userId: string;
    let seq = 0;

    beforeEach(async () => {
      const harness = await setup();
      wallet = harness.wallet;
      userId = await harness.newUser();
    });

    const op = (amount: number, extra: Partial<MoneyOp> = {}): MoneyOp => ({
      userId,
      amount,
      balance: 'REAL',
      idempotencyKey: `contrato:${++seq}:${Date.now()}`,
      reference: { type: 'test', id: String(seq) },
      ...extra,
    });

    it('una billetera nueva tiene saldo 0', async () => {
      expect(await wallet.getBalances(userId)).toEqual({ real: 0, bonus: 0, held: 0 });
    });

    it('acredita y debita', async () => {
      await wallet.credit(op(5000));
      await wallet.debit(op(1250));
      expect(await wallet.getBalances(userId)).toEqual({ real: 3750, bonus: 0, held: 0 });
    });

    it('rechaza un débito sin saldo y no cambia nada', async () => {
      await wallet.credit(op(1000));
      await expect(wallet.debit(op(1500))).rejects.toBeInstanceOf(InsufficientFundsError);
      expect((await wallet.getBalances(userId)).real).toBe(1000);
    });

    it('repetir la misma clave devuelve el mismo asiento sin segundo efecto', async () => {
      const credit = op(700);
      const first = await wallet.credit(credit);
      const second = await wallet.credit(credit);
      expect(second).toBe(first);
      expect((await wallet.getBalances(userId)).real).toBe(700);
    });

    it('la misma clave con otro monto es un conflicto', async () => {
      const credit = op(700);
      await wallet.credit(credit);
      await expect(wallet.credit({ ...credit, amount: 800 })).rejects.toBeInstanceOf(
        IdempotencyConflictError,
      );
    });

    it('saldo real y de bono están separados', async () => {
      await wallet.credit(op(1000, { balance: 'BONUS' }));
      await expect(wallet.debit(op(500))).rejects.toBeInstanceOf(InsufficientFundsError);
      await wallet.debit(op(400, { balance: 'BONUS' }));
      expect(await wallet.getBalances(userId)).toEqual({ real: 0, bonus: 600, held: 0 });
    });

    it('retiene y libera saldo real', async () => {
      await wallet.credit(op(2000));
      await wallet.hold(op(1500));
      expect(await wallet.getBalances(userId)).toEqual({ real: 500, bonus: 0, held: 1500 });
      await expect(wallet.debit(op(600))).rejects.toBeInstanceOf(InsufficientFundsError);
      await expect(wallet.hold(op(600))).rejects.toBeInstanceOf(InsufficientFundsError);
      await wallet.release(op(1500));
      expect(await wallet.getBalances(userId)).toEqual({ real: 2000, bonus: 0, held: 0 });
    });

    it('no libera más de lo retenido', async () => {
      await wallet.credit(op(1000));
      await wallet.hold(op(300));
      await expect(wallet.release(op(400))).rejects.toBeInstanceOf(InsufficientFundsError);
    });

    it.each([0, -100, 1.5])('rechaza montos inválidos: %p', async (amount) => {
      await expect(wallet.credit(op(amount))).rejects.toThrow();
    });
  });
}
