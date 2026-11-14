import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@apuestas/shared';
import { DomainError } from '../common/errors/domain-error';
import type { Prisma } from '../generated/prisma/client';
import type { LedgerTransactionType } from '../generated/prisma/enums';

/** Saldo sobre el que opera una llamada: real (retirable) o de bonificación. */
export type Balance = 'REAL' | 'BONUS';

export interface MoneyOp {
  userId: string;
  /** Centavos, entero > 0. */
  amount: number;
  balance: Balance;
  /** Única por efecto, p. ej. `bet:${betId}:debit`. Repetirla no repite el efecto. */
  idempotencyKey: string;
  /** Origen del movimiento, p. ej. `{ type: 'bet', id: betId }`. */
  reference: { type: string; id: string };
  /** Tipo de asiento; por defecto BET_DEBIT / BET_CREDIT / BONUS_CREDIT según la operación. */
  type?: LedgerTransactionType;
  /** Para unirse a la transacción del llamador: "crear apuesta + debitar" queda atómico. */
  tx?: Prisma.TransactionClient;
}

export type HoldOp = Omit<MoneyOp, 'balance' | 'type'>;

export interface Balances {
  real: number;
  bonus: number;
  held: number;
}

/**
 * Contrato de contracts/wallet-service.md: la única forma de mover dinero de un usuario.
 * Lo implementan WalletService (PostgreSQL) y el doble en memoria para la spec 4.
 */
export interface WalletPort {
  getBalances(userId: string): Promise<Balances>;
  /** Valida saldo y debita contra la casa. Lanza InsufficientFundsError. */
  debit(op: MoneyOp): Promise<string>;
  /** Acredita desde la casa (ganancias, reembolsos, bonos). */
  credit(op: MoneyOp): Promise<string>;
  /** Mueve saldo real a retenido. Lanza InsufficientFundsError. */
  hold(op: HoldOp): Promise<string>;
  /** Devuelve saldo retenido a real. */
  release(op: HoldOp): Promise<string>;
}

export class InsufficientFundsError extends DomainError {
  constructor() {
    super(
      ErrorCode.INSUFFICIENT_FUNDS,
      'No tienes saldo suficiente para esta operación.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor() {
    super(
      ErrorCode.IDEMPOTENCY_CONFLICT,
      'Esta operación ya se registró con otros datos. Recarga la página e inténtalo de nuevo.',
      HttpStatus.CONFLICT,
    );
  }
}

export class WalletNotFoundError extends DomainError {
  constructor() {
    super(ErrorCode.NOT_FOUND, 'No encontramos la billetera.', HttpStatus.NOT_FOUND);
  }
}
