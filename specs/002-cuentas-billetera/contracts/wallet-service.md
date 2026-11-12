# Contrato interno: WalletService

Servicio de Nest que exporta el módulo `WalletModule` de `apps/api` para otras specs (apuestas,
liquidación y cupones de la spec 4). Es la **única** forma de mover dinero; ningún otro módulo escribe
en las tablas del libro contable (FR-018).

```ts
type Cents = number;                       // entero, > 0
type Balance = 'REAL' | 'BONUS';

interface MoneyOp {
  userId: string;
  amount: Cents;
  balance: Balance;
  idempotencyKey: string;                  // p. ej. `bet:${betId}:debit`
  reference: { type: string; id: string }; // origen, p. ej. { type: 'bet', id: betId }
  tx?: Prisma.TransactionClient;           // para unirse a la transacción del llamador
}

interface WalletService {
  getBalances(userId: string): Promise<{ real: Cents; bonus: Cents; held: Cents }>;

  /** Bloquea la billetera, valida saldo y debita. Lanza InsufficientFundsError. */
  debit(op: MoneyOp): Promise<LedgerTransactionId>;

  /** Acredita desde HOUSE (ganancias, reembolsos, bonos). */
  credit(op: MoneyOp): Promise<LedgerTransactionId>;

  /** Mueve saldo real a retenido. Lanza InsufficientFundsError. */
  hold(op: Omit<MoneyOp, 'balance'>): Promise<LedgerTransactionId>;

  /** Devuelve saldo retenido a real. */
  release(op: Omit<MoneyOp, 'balance'>): Promise<LedgerTransactionId>;
}
```

## Garantías

- Cada llamada bloquea la fila `Wallet` del usuario (`FOR UPDATE`) dentro de la transacción; si se
  pasa `tx`, se une a la del llamador, de modo que "crear apuesta + debitar" es atómico (constitución
  II).
- Repetir una llamada con el mismo `idempotencyKey` devuelve el mismo `LedgerTransactionId` sin un
  segundo efecto. La misma clave con otro monto lanza `IdempotencyConflictError`.
- El saldo nunca queda negativo.
- `debit` y `credit` sobre `REAL` contrapartidan en `HOUSE`; sobre `BONUS`, también en `HOUSE`.

## Errores

`InsufficientFundsError`, `IdempotencyConflictError`, `WalletNotFoundError`.

## Mientras la spec 2 no esté integrada

La spec 4 puede implementar contra un doble en memoria con esta misma interfaz; la suite de pruebas
de contrato de `WalletService` se exporta para correrla contra el doble y contra la implementación
real.
