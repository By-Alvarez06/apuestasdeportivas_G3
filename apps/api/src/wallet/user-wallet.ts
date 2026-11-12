import { LedgerAccountType } from '../generated/prisma/enums';

/** Billetera y cuentas contables de un apostador nuevo, para anidar en `user.create`. */
export const newUserWallet = () => ({
  wallet: { create: {} },
  accounts: {
    create: [
      { type: LedgerAccountType.USER_REAL },
      { type: LedgerAccountType.USER_BONUS },
      { type: LedgerAccountType.USER_HELD },
    ],
  },
});
