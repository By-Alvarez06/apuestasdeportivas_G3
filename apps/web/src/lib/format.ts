/** "1234.50" → "$1,234.50"; "-0.50" → "−$0.50" (signo menos tipográfico). */
export function usd(amount: string, { signed = false } = {}): string {
  const negative = amount.startsWith('-');
  const [units = '0', cents = '00'] = amount.replace('-', '').split('.');
  const grouped = units.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = negative ? '−' : signed ? '+' : '';
  return `${sign}$${grouped}.${cents}`;
}

export const MOVEMENT_LABEL: Record<string, string> = {
  DEPOSIT: 'Depósito',
  WITHDRAWAL_HOLD: 'Retiro solicitado',
  WITHDRAWAL_RELEASE: 'Retiro devuelto',
  WITHDRAWAL_PAYOUT: 'Retiro pagado',
  ADJUSTMENT: 'Corrección',
  BET_DEBIT: 'Apuesta',
  BET_CREDIT: 'Premio',
  BONUS_CREDIT: 'Bono',
};

export const POCKET_LABEL: Record<string, string> = {
  REAL: 'Saldo',
  BONUS: 'Bono',
  HELD: 'Retenido',
};

export function dateTime(iso: string): string {
  return new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}
