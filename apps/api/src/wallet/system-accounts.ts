import type { PrismaClient } from '../generated/prisma/client';
import { LedgerAccountType } from '../generated/prisma/enums';

export const SYSTEM_ACCOUNT_TYPES = [
  LedgerAccountType.HOUSE,
  LedgerAccountType.GATEWAY,
  LedgerAccountType.PAYOUT,
] as const;

/** Crea las cuentas contables del sistema si faltan. Idempotente. */
export async function ensureSystemAccounts(prisma: PrismaClient): Promise<void> {
  for (const type of SYSTEM_ACCOUNT_TYPES) {
    const exists = await prisma.ledgerAccount.findFirst({ where: { type, userId: null } });
    if (!exists) await prisma.ledgerAccount.create({ data: { type } });
  }
}
