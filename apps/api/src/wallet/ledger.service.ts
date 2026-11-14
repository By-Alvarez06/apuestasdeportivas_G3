import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { LedgerAccountType, type LedgerTransactionType } from '../generated/prisma/enums';

export interface Posting {
  accountId: string;
  /** Centavos con signo: negativo sale de la cuenta, positivo entra. */
  amount: number;
}

export interface LedgerEntry {
  type: LedgerTransactionType;
  idempotencyKey: string;
  reference: { type: string; id: string };
  reason?: string;
  createdById?: string;
  postings: Posting[];
}

export type Tx = Prisma.TransactionClient;

/** Escritura y lectura del libro de doble entrada. No valida saldos: eso lo hace WalletService bajo bloqueo. */
@Injectable()
export class LedgerService {
  /** Crea el asiento. La suma de líneas debe ser 0 (también lo exige un trigger de la base). */
  async post(entry: LedgerEntry, tx: Tx): Promise<string> {
    if (entry.postings.length < 2) throw new Error('Un asiento necesita al menos dos líneas');
    for (const { amount } of entry.postings)
      if (!Number.isSafeInteger(amount) || amount === 0)
        throw new Error(`Línea inválida: ${amount}`);
    if (entry.postings.reduce((sum, p) => sum + p.amount, 0) !== 0)
      throw new Error('Asiento descuadrado');

    const created = await tx.ledgerTransaction.create({
      data: {
        type: entry.type,
        idempotencyKey: entry.idempotencyKey,
        referenceType: entry.reference.type,
        referenceId: entry.reference.id,
        reason: entry.reason,
        createdById: entry.createdById,
        postings: { create: entry.postings },
      },
      select: { id: true },
    });
    return created.id;
  }

  async balanceOf(accountId: string, tx: Tx): Promise<number> {
    const { _sum } = await tx.ledgerPosting.aggregate({
      where: { accountId },
      _sum: { amount: true },
    });
    return _sum.amount ?? 0;
  }

  async userAccountId(userId: string, type: LedgerAccountType, tx: Tx): Promise<string> {
    const account = await tx.ledgerAccount.findUnique({
      where: { userId_type: { userId, type } },
      select: { id: true },
    });
    if (!account) throw new Error(`El usuario ${userId} no tiene cuenta ${type}`);
    return account.id;
  }

  async systemAccountId(
    type:
      | typeof LedgerAccountType.HOUSE
      | typeof LedgerAccountType.GATEWAY
      | typeof LedgerAccountType.PAYOUT,
    tx: Tx,
  ): Promise<string> {
    const account = await tx.ledgerAccount.findFirstOrThrow({
      where: { type, userId: null },
      select: { id: true },
    });
    return account.id;
  }
}
