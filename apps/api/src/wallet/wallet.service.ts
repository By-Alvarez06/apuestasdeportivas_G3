import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { LedgerAccountType, LedgerTransactionType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService, type Tx } from './ledger.service';
import {
  type Balance,
  type Balances,
  type HoldOp,
  IdempotencyConflictError,
  InsufficientFundsError,
  type MoneyOp,
  type WalletPort,
  WalletNotFoundError,
} from './wallet.port';

type UserAccount =
  | typeof LedgerAccountType.USER_REAL
  | typeof LedgerAccountType.USER_BONUS
  | typeof LedgerAccountType.USER_HELD;
type SystemAccount =
  | typeof LedgerAccountType.HOUSE
  | typeof LedgerAccountType.GATEWAY
  | typeof LedgerAccountType.PAYOUT;

/** Movimiento entre una cuenta del usuario y otra (suya o del sistema). */
export interface Transfer {
  userId: string;
  amount: number;
  from: UserAccount | SystemAccount;
  to: UserAccount | SystemAccount;
  type: LedgerTransactionType;
  idempotencyKey: string;
  reference: { type: string; id: string };
  reason?: string;
  createdById?: string;
  tx?: Tx;
}

const ACCOUNT_OF: Record<Balance, UserAccount> = {
  REAL: LedgerAccountType.USER_REAL,
  BONUS: LedgerAccountType.USER_BONUS,
};

const USER_ACCOUNTS = new Set<string>([
  LedgerAccountType.USER_REAL,
  LedgerAccountType.USER_BONUS,
  LedgerAccountType.USER_HELD,
]);

/**
 * Billetera sobre el libro contable (constitución II). Cada operación bloquea la fila Wallet del
 * usuario con FOR UPDATE, valida saldo y escribe el asiento en la misma transacción.
 */
@Injectable()
export class WalletService implements WalletPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async getBalances(userId: string): Promise<Balances> {
    const rows = await this.prisma.$queryRaw<{ type: string; balance: bigint | null }[]>`
      SELECT a.type::text AS type, SUM(p.amount) AS balance
      FROM "LedgerAccount" a
      LEFT JOIN "LedgerPosting" p ON p."accountId" = a.id
      WHERE a."userId" = ${userId}::uuid
      GROUP BY a.type`;
    if (rows.length === 0) throw new WalletNotFoundError();
    const of = (type: UserAccount) => Number(rows.find((r) => r.type === type)?.balance ?? 0);
    return {
      real: of(LedgerAccountType.USER_REAL),
      bonus: of(LedgerAccountType.USER_BONUS),
      held: of(LedgerAccountType.USER_HELD),
    };
  }

  debit(op: MoneyOp): Promise<string> {
    return this.transfer({
      ...op,
      from: ACCOUNT_OF[op.balance],
      to: LedgerAccountType.HOUSE,
      type: op.type ?? LedgerTransactionType.BET_DEBIT,
    });
  }

  credit(op: MoneyOp): Promise<string> {
    const defaultType =
      op.balance === 'BONUS'
        ? LedgerTransactionType.BONUS_CREDIT
        : LedgerTransactionType.BET_CREDIT;
    return this.transfer({
      ...op,
      from: LedgerAccountType.HOUSE,
      to: ACCOUNT_OF[op.balance],
      type: op.type ?? defaultType,
    });
  }

  hold(op: HoldOp): Promise<string> {
    return this.transfer({
      ...op,
      from: LedgerAccountType.USER_REAL,
      to: LedgerAccountType.USER_HELD,
      type: LedgerTransactionType.WITHDRAWAL_HOLD,
    });
  }

  release(op: HoldOp): Promise<string> {
    return this.transfer({
      ...op,
      from: LedgerAccountType.USER_HELD,
      to: LedgerAccountType.USER_REAL,
      type: LedgerTransactionType.WITHDRAWAL_RELEASE,
    });
  }

  /**
   * Movimiento genérico que usan depósitos, retiros y correcciones. Si sale de una cuenta del
   * usuario, exige saldo suficiente. Idempotente por `idempotencyKey`.
   */
  async transfer(t: Transfer): Promise<string> {
    if (!Number.isSafeInteger(t.amount) || t.amount <= 0)
      throw new Error(`Monto inválido: ${t.amount}`);
    try {
      return t.tx
        ? await this.transferIn(t, t.tx)
        : await this.prisma.$transaction((tx) => this.transferIn(t, tx));
    } catch (error) {
      // Carrera entre dos transacciones distintas con la misma clave: la perdedora devuelve la ganadora.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && !t.tx)
        return this.prisma.$transaction((tx) => this.existing(t, tx)) as Promise<string>;
      throw error;
    }
  }

  private async transferIn(t: Transfer, tx: Tx): Promise<string> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Wallet" WHERE "userId" = ${t.userId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new WalletNotFoundError();

    const previous = await this.existing(t, tx);
    if (previous) return previous;

    const [fromId, toId] = await Promise.all([
      this.accountId(t.userId, t.from, tx),
      this.accountId(t.userId, t.to, tx),
    ]);
    if (USER_ACCOUNTS.has(t.from) && (await this.ledger.balanceOf(fromId, tx)) < t.amount)
      throw new InsufficientFundsError();

    return this.ledger.post(
      {
        type: t.type,
        idempotencyKey: t.idempotencyKey,
        reference: t.reference,
        reason: t.reason,
        createdById: t.createdById,
        postings: [
          { accountId: fromId, amount: -t.amount },
          { accountId: toId, amount: t.amount },
        ],
      },
      tx,
    );
  }

  /** Asiento ya registrado con esta clave; si sus datos no coinciden, es un conflicto. */
  private async existing(t: Transfer, tx: Tx): Promise<string | null> {
    const found = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey: t.idempotencyKey },
      include: { postings: { include: { account: { select: { type: true, userId: true } } } } },
    });
    if (!found) return null;
    const credit = found.postings.find((p) => p.amount > 0);
    const debit = found.postings.find((p) => p.amount < 0);
    const same =
      found.type === t.type &&
      credit?.amount === t.amount &&
      credit.account.type === t.to &&
      debit?.account.type === t.from &&
      [credit.account.userId, debit.account.userId].includes(t.userId);
    if (!same) throw new IdempotencyConflictError();
    return found.id;
  }

  private accountId(userId: string, type: UserAccount | SystemAccount, tx: Tx): Promise<string> {
    return USER_ACCOUNTS.has(type)
      ? this.ledger.userAccountId(userId, type, tx)
      : this.ledger.systemAccountId(type as SystemAccount, tx);
  }
}
